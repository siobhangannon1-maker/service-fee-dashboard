import { NextResponse } from "next/server";

import { ApiAuthorizationError, requireActiveApiUser } from "@/lib/auth";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { isConfirmedPraktikaUpload } from "@/lib/report-writing/praktika-upload-result";
import {
  continuationChildId,
  continuationIntentId,
  validWorkflowAuthorization,
} from "@/lib/report-writing/workflow-continuation-token";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIO_READ_TYPES = [
  "periodontal_chart_patient_perio_exam_ids",
  "periodontal_chart_perio_exams",
] as const;

type Eligibility =
  | { eligible: true; intentId: string; readIds: string[] }
  | { eligible: false; reason: string };

async function access() {
  try {
    const { user } = await requireActiveApiUser([
      "admin", "super_admin", "practice_manager", "typist",
    ]);
    return { actorId: user.id, denied: null };
  } catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 403;
    return {
      actorId: null,
      denied: NextResponse.json({
        success: false,
        eligible: false,
        reason: status === 401 ? "unauthenticated" : "unauthorized",
        error: status === 401 ? "Authentication required." : "An active authorized Typist account is required.",
      }, { status }),
    };
  }
}

function validIconResult(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  const value = response as Record<string, unknown>;
  return !value.error && value.success !== false && value.empty !== true;
}

async function eligibility(draftId: string): Promise<Eligibility> {
  if (!UUID.test(draftId)) return { eligible: false, reason: "invalid_state" };
  const intentId = continuationIntentId(draftId);

  const [{ data: draft, error: draftError }, { data: intent, error: intentError }] = await Promise.all([
    db.from("report_drafts").select(
      "id,status,deleted_at,provider_id,uploaded_to_praktika,workflow_status,workflow_praktika_upload_status,workflow_icon_update_status,workflow_mediref_status,workflow_periodontal_chart_status,periodontal_chart_attachment_error",
    ).eq("id", draftId).maybeSingle(),
    db.from("praktika_helper_jobs").select("*").eq("id", intentId)
      .eq("job_type", "complete_report_workflow").maybeSingle(),
  ]);

  if (draftError || intentError) throw new Error("lookup_unavailable");
  if (!draft || !intent || draft.deleted_at) return { eligible: false, reason: "invalid_state" };
  if (!["approved", "uploaded_to_praktika"].includes(draft.status || "")) return { eligible: false, reason: "invalid_state" };

  if (!intent.app_user_id || intent.request?.reportDraftId !== draftId ||
      intent.request?.actorUserId !== intent.app_user_id ||
      intent.request?.options?.actor?.actorUserId !== intent.app_user_id ||
      !validWorkflowAuthorization(draftId, intent.app_user_id, intent.request?.options,
        process.env.SUPABASE_SERVICE_ROLE_KEY || "")) {
    return { eligible: false, reason: "invalid_state" };
  }

  // Keep historical/manual replacement workflows on their dedicated recovery paths.
  if (intent.response?.retryUploadId) return { eligible: false, reason: "special_recovery_required" };

  if (intent.status !== "waiting" || intent.response?.stage !== "mediref" ||
      intent.response?.issue !== "periodontal_unavailable") {
    return { eligible: false, reason: "workflow_not_resumable" };
  }

  if (!draft.uploaded_to_praktika ||
      draft.workflow_praktika_upload_status !== "completed" ||
      !["completed", "skipped"].includes(draft.workflow_icon_update_status || "") ||
      draft.workflow_mediref_status !== "waiting_for_periodontal" ||
      draft.workflow_status !== "running") {
    return { eligible: false, reason: "workflow_not_resumable" };
  }

  const [
    { data: provider, error: providerError },
    { data: upload, error: uploadError },
    { data: icon, error: iconError },
    { data: reads, error: readsError },
    { data: medirefJobs, error: medirefError },
  ] = await Promise.all([
    db.from("providers").select("id").eq("id", draft.provider_id).eq("is_active", true).maybeSingle(),
    db.from("praktika_helper_jobs").select("id,status,response,request")
      .eq("id", continuationChildId(intentId, "upload_report_to_praktika")).maybeSingle(),
    db.from("praktika_helper_jobs").select("id,status,response,request")
      .eq("id", continuationChildId(intentId, "update_praktika_letter_icons")).maybeSingle(),
    db.from("praktika_helper_jobs").select("id,status,attempts,job_type,request,response")
      .eq("app_user_id", intent.app_user_id).eq("request->>continuationId", intentId)
      .in("job_type", [...PERIO_READ_TYPES]),
    db.from("mediref_helper_jobs").select("id,status").eq("job_type", "send_mediref_letter")
      .eq("payload->>draftId", draftId),
  ]);

  if (providerError || uploadError || iconError || readsError || medirefError) throw new Error("lookup_unavailable");
  if (!provider) return { eligible: false, reason: "provider_inactive" };

  if (upload?.status !== "completed" || upload.request?.continuationId !== intentId ||
      !isConfirmedPraktikaUpload(upload.response)) {
    return { eligible: false, reason: "praktika_not_confirmed" };
  }

  if (draft.workflow_icon_update_status === "completed" &&
      (icon?.status !== "completed" || icon.request?.continuationId !== intentId || !validIconResult(icon.response))) {
    return { eligible: false, reason: "icon_not_confirmed" };
  }

  // Once MediRef has an attempt, its dedicated verification/retry controls own recovery.
  if ((medirefJobs || []).length > 0) return { eligible: false, reason: "mediref_attempt_exists" };

  const failedReads = (reads || []).filter((job) =>
    job.status === "failed" &&
    Number(job.attempts || 0) >= 3 &&
    job.request?.continuationId === intentId &&
    PERIO_READ_TYPES.includes(job.job_type),
  );

  if (!failedReads.length) return { eligible: false, reason: "no_exhausted_safe_read" };

  if ((reads || []).some((job) => ["pending", "processing", "waiting", "running"].includes(job.status))) {
    return { eligible: false, reason: "automatic_recovery_active" };
  }

  for (const job of failedReads) {
    if (job.id !== continuationChildId(intentId, job.job_type)) {
      return { eligible: false, reason: "legacy_or_ambiguous_read" };
    }
  }

  return { eligible: true, intentId, readIds: failedReads.map((job) => job.id) };
}

export async function GET(req: Request) {
  const { denied } = await access();
  if (denied) return denied;
  try {
    const draftId = new URL(req.url).searchParams.get("draftId") || "";
    return NextResponse.json(await eligibility(draftId));
  } catch {
    return NextResponse.json({ eligible: false, reason: "lookup_unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const { actorId, denied } = await access();
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => null);
    const draftId = String(body?.draftId || "");
    const state = await eligibility(draftId);

    if (!state.eligible) {
      return NextResponse.json({
        success: false,
        reason: state.reason,
        error: "This workflow is not currently eligible for safe automatic resumption.",
      }, { status: 409 });
    }

    const now = new Date().toISOString();

    const { data: rearmed, error: rearmError } = await db.from("praktika_helper_jobs").update({
      status: "pending",
      attempts: 0,
      error_message: null,
      failed_at: null,
      locked_at: null,
      locked_by: null,
      response: null,
      available_at: now,
      updated_at: now,
    }).in("id", state.readIds)
      .eq("status", "failed")
      .eq("request->>continuationId", state.intentId)
      .select("id");

    if (rearmError || !rearmed || rearmed.length !== state.readIds.length) {
      return NextResponse.json({
        success: false,
        error: "The safe read could not be re-armed. Refresh before trying again.",
      }, { status: 409 });
    }

    // Make the retained continuation immediately runnable. The normal continuation
    // route will regenerate the chart and continue MediRef; no Praktika write is replayed.
    const { data: parent, error: parentError } = await db.from("praktika_helper_jobs").update({
      status: "waiting",
      locked_at: null,
      locked_by: null,
      error_message: null,
      failed_at: null,
      response: { stage: "mediref", issue: "periodontal_unavailable", dispatched: false,
        resumedByUserId: actorId, resumedAt: now },
      updated_at: now,
    }).eq("id", state.intentId).eq("job_type", "complete_report_workflow")
      .eq("status", "waiting").eq("response->>stage", "mediref")
      .eq("response->>issue", "periodontal_unavailable").select("id").maybeSingle();

    if (parentError || !parent) {
      // Reads are harmless to retry. If the parent changed concurrently, leaving
      // them pending is safe; normal continuation reconciliation will decide next action.
      return NextResponse.json({
        success: true,
        accepted: true,
        message: "Safe periodontal reads were resumed. Workflow reconciliation is continuing.",
      }, { status: 202 });
    }

    await db.from("report_drafts").update({
      workflow_status: "running",
      workflow_error: null,
      workflow_mediref_status: "waiting_for_periodontal",
      workflow_last_message: "Workflow resumed. Waiting for the requested periodontal chart.",
      periodontal_chart_attachment_error: null,
      updated_at: now,
    }).eq("id", draftId);

    return NextResponse.json({
      success: true,
      accepted: true,
      message: "Workflow resumed. Safe periodontal reads will retry and the existing workflow will continue automatically.",
    }, { status: 202 });
  } catch {
    return NextResponse.json({
      success: false,
      error: "Workflow resume is temporarily unavailable. Refresh before trying again.",
    }, { status: 503 });
  }
}
