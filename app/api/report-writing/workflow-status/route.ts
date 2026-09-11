import { canQueueUserPraktikaWorkflow } from "@/lib/report-writing/praktika-readiness";
import { workflowConfigurationIssue, continuationIntentId, workflowAuthorization } from "@/lib/report-writing/workflow-continuation-token";
import { isUserPraktikaReady, praktikaConnectionRequired } from "@/lib/report-writing/praktika-readiness";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { claimWorkflowStart } from "@/lib/report-writing/complete-workflow";
import { getAuditActor } from "@/lib/report-writing/audit";
import { enqueueFailure } from "@/lib/mediref/enqueue-transition";
import { getUserStatus } from "@/lib/getUserStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

const ALLOWED_WORKFLOW_STATUSES = new Set([
  "idle",
  "running",
  "completed",
  "failed",
]);

const ALLOWED_STEP_STATUSES = new Set([
  "not_requested",
  "pending",
  "running",
  "completed",
  "skipped",
  "failed",
]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function validOrNull(value: unknown, allowed: Set<string>) {
  const text = clean(value);
  if (!text) return undefined;
  if (!allowed.has(text)) return undefined;
  return text;
}

export async function POST(req: Request) {
  // Only read-only preflight is raced. Never abandon a reservation transport and
  // infer rollback: the deterministic RPC reconciles an uncertain acknowledgement.
  async function boundedRead<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Workflow preflight unavailable")), 5000);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  try {
    const body = await req.json().catch(() => ({}));

    const draftId = clean(body.draftId);

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 },
      );
    }

    if (body.failMedirefEnqueue === true) {
      const actor = await boundedRead(getAuditActor());
      if (!actor.actorUserId || !await boundedRead(getUserStatus(actor.actorUserId))) {
        return NextResponse.json({ success: false, error: "An active login is required." }, { status: 403 });
      }
      const { data: active, error: activeError } = await supabase.from("mediref_helper_jobs").select("id")
        .eq("job_type", "send_mediref_letter").eq("payload->>draftId", draftId)
        .in("status", ["pending", "processing"]).limit(1).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (activeError) return NextResponse.json({ success: false, error: enqueueFailure }, { status: 503 });
      if (active) return NextResponse.json({ success: true, jobId: active.id });
      const { error } = await supabase.from("report_drafts").update({
        workflow_status: "failed", workflow_mediref_status: "failed", workflow_error: enqueueFailure,
        workflow_last_message: "MediRef preparation or queueing failed.", updated_at: new Date().toISOString(),
      }).eq("id", draftId).eq("workflow_status", "running").in("workflow_mediref_status", ["pending", "running"]).is("deleted_at", null)
        .abortSignal(AbortSignal.timeout(5000));
      return NextResponse.json({ success: !error }, { status: error ? 503 : 200 });
    }

    const now = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      updated_at: now,
    };

    const workflowStatus = validOrNull(
      body.workflowStatus,
      ALLOWED_WORKFLOW_STATUSES,
    );

    if (workflowStatus) {
      updatePayload.workflow_status = workflowStatus;

      if (workflowStatus === "running") {
        updatePayload.workflow_started_at = body.workflowStartedAt || now;
        updatePayload.workflow_completed_at = null;
        updatePayload.workflow_error = null;
      }

      if (workflowStatus === "completed") {
        updatePayload.workflow_completed_at = body.workflowCompletedAt || now;
        updatePayload.workflow_error = null;
      }

      if (workflowStatus === "failed") {
        updatePayload.workflow_error =
          clean(body.workflowError) || "Workflow failed.";
      }
    }

    const praktikaUploadStatus = validOrNull(
      body.praktikaUploadStatus,
      ALLOWED_STEP_STATUSES,
    );
    const iconUpdateStatus = validOrNull(
      body.iconUpdateStatus,
      ALLOWED_STEP_STATUSES,
    );
    const medirefStatus = validOrNull(body.medirefStatus, ALLOWED_STEP_STATUSES);
    const periodontalChartStatus = validOrNull(
      body.periodontalChartStatus,
      ALLOWED_STEP_STATUSES,
    );

    if (praktikaUploadStatus) {
      updatePayload.workflow_praktika_upload_status = praktikaUploadStatus;
    }

    if (iconUpdateStatus) {
      updatePayload.workflow_icon_update_status = iconUpdateStatus;
    }

    if (medirefStatus) {
      updatePayload.workflow_mediref_status = medirefStatus;
    }

    if (periodontalChartStatus) {
      updatePayload.workflow_periodontal_chart_status = periodontalChartStatus;
    }

    if (typeof body.message === "string") {
      updatePayload.workflow_last_message = clean(body.message) || null;
    }

    if (typeof body.workflowError === "string") {
      updatePayload.workflow_error = clean(body.workflowError) || null;
    }

    if (body.startWorkflow === true) {
      const actor = await boundedRead(getAuditActor());
      if (!actor.actorUserId || !await boundedRead(getUserStatus(actor.actorUserId))) {
        return NextResponse.json({ success: false, error: "An active login is required." }, { status: 403 });
      }
      if (workflowStatus !== "running") return NextResponse.json({ success: false, error: "Invalid workflow start." }, { status: 400 });
      if (praktikaUploadStatus === "pending" && body.continuationOptions) {
        if (workflowConfigurationIssue()) return NextResponse.json({ success: false, error: "Workflow continuation is not configured." }, { status: 503 });
        const options = body.continuationOptions;
        if (typeof options !== "object" || Array.isArray(options) || !/^\d+$/.test(String(options.praktikaPatientId || ""))) {
          return NextResponse.json({ success: false, error: "Invalid workflow options." }, { status: 400 });
        }
        // Reconcile first even if a previously accepted workflow is now challenged.
        // The RPC alone reserves; the read below never creates or resets work.
        const [lookup, queueable] = await boundedRead(Promise.all([
          Promise.resolve(supabase.from("praktika_helper_jobs").select("id")
            .eq("job_type", "complete_report_workflow").eq("id", continuationIntentId(draftId)).limit(1)
            .abortSignal(AbortSignal.timeout(5000))),
          canQueueUserPraktikaWorkflow(supabase, actor.actorUserId).catch(() => false),
        ]));
        if (lookup.error) return NextResponse.json({ success: false, code: "reservation_unavailable", stage: "workflow_preflight",
          error: "Workflow start could not be confirmed. Please try Complete Workflow again; any existing intent will be reconciled." }, { status: 503 });
        if (!lookup.data?.length && !queueable) {
          return NextResponse.json({ success: false, reconnectRequired: true, error: praktikaConnectionRequired }, { status: 409 });
        }
        const optionKeys = ["referrerName", "referrerPracticeName", "referrerEmail", "referrerProviderNumber",
          "medirefAutoMatchRecipient", "patientEmail", "additionalRecipients", "additionalRecipientsText",
          "message", "attachPeriodontalChart", "praktikaPatientId", "queueId"];
        const authorizedOptions = { ...Object.fromEntries(optionKeys.filter(key => Object.hasOwn(options, key)).map(key => [key, options[key]])), actor };
        const { data: reservation, error: reserveError } = await Promise.resolve(supabase.rpc("reserve_praktika_workflow", {
          p_draft_id: draftId, p_actor_user_id: actor.actorUserId,
          p_options: { ...authorizedOptions, authorization: workflowAuthorization(draftId, actor.actorUserId, authorizedOptions, process.env.SUPABASE_SERVICE_ROLE_KEY!) },
        }).abortSignal(AbortSignal.timeout(5000))).catch(() => ({ data: null, error: {} }));
        if (reserveError) return NextResponse.json({ success: false, code: "lookup_failed", stage: "workflow_reservation",
          error: "Workflow start could not be confirmed. Please try Complete Workflow again; any existing intent will be reconciled." }, { status: 503 });
        if (!reservation?.ok) return NextResponse.json({ success: false, code: reservation?.code || "reservation_failed",
          error: "This workflow already exists or needs reconciliation. The approved letter is retained." }, { status: 409 });
        return NextResponse.json({ success: true, accepted: true, intentId: reservation.intentId,
          reconciled: reservation.reconciled, intentStatus: reservation.intentStatus,
          workflowStatus: reservation.workflowStatus, uploadStatus: reservation.uploadStatus }, { status: 202 });
      }
      if (praktikaUploadStatus === "pending") {
        if (!await isUserPraktikaReady(supabase, actor.actorUserId)) {
          return NextResponse.json({ success: false, reconnectRequired: true, error: praktikaConnectionRequired }, { status: 409 });
        }
        // Do not replay an upload with an uncertain or already successful outcome.
        const { data: attempts, error: attemptError } = await Promise.resolve(supabase.from("praktika_helper_jobs")
          .select("id").eq("job_type", "upload_report_to_praktika")
          .eq("request->>reportDraftId", draftId).limit(1).abortSignal(AbortSignal.timeout(5000))).catch((error: unknown) => ({ data: null, error: error || {} }));
        if (attemptError) {
          const reason = typeof attemptError === "object" && attemptError !== null
            && "name" in attemptError && attemptError.name === "TimeoutError" ? "lookup_timeout" : "lookup_failed";
          console.warn("praktika_upload_attempt", { stage: "upload_attempt_lookup", reason });
          return NextResponse.json({ success: false, code: reason, stage: "upload_attempt_lookup",
            error: "Previous Praktika upload attempts could not be verified. No new upload was started; the approved letter is retained." }, { status: 503 });
        }
        if (attempts?.length) {
          console.warn("praktika_upload_attempt", { stage: "upload_attempt_lookup", reason: "existing_attempt" });
          return NextResponse.json({ success: false, code: "existing_attempt", stage: "upload_attempt_lookup",
          error: "This report already has an upload attempt. Check its helper result before retrying; the approved letter is retained." }, { status: 409 });
        }
      }
      const { data, error } = await claimWorkflowStart(supabase, draftId, updatePayload);
      if (error) return NextResponse.json({ success: false, error: "Could not start workflow." }, { status: 500 });
      if (!data) return NextResponse.json({ success: false, error: "Workflow is already running or this report is not eligible." }, { status: 409 });
      return NextResponse.json({ success: true, draft: data });
    }

    delete updatePayload.workflow_praktika_upload_status;
    delete updatePayload.workflow_icon_update_status;

    const { data, error } = await supabase
      .from("report_drafts")
      .update(updatePayload)
      .eq("id", draftId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      draft: data,
    });
  } catch {

    return NextResponse.json(
      {
        success: false,
        code: "workflow_status_unavailable",
        error: "Workflow status could not be confirmed. Please refresh and try again; any existing workflow will be reconciled.",
      },
      { status: 503 },
    );
  }
}