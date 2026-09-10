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
      const actor = await getAuditActor();
      if (!actor.actorUserId || !await getUserStatus(actor.actorUserId)) {
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
      const actor = await getAuditActor();
      if (!actor.actorUserId || !await getUserStatus(actor.actorUserId)) {
        return NextResponse.json({ success: false, error: "An active login is required." }, { status: 403 });
      }
      if (workflowStatus !== "running") return NextResponse.json({ success: false, error: "Invalid workflow start." }, { status: 400 });
      if (praktikaUploadStatus === "pending") {
        if (!await isUserPraktikaReady(supabase, actor.actorUserId)) {
          return NextResponse.json({ success: false, reconnectRequired: true, error: praktikaConnectionRequired }, { status: 409 });
        }
        // Do not replay an upload with an uncertain or already successful outcome.
        const { data: attempts, error: attemptError } = await supabase.from("praktika_helper_jobs")
          .select("id").eq("job_type", "upload_report_to_praktika")
          .eq("request->>reportDraftId", draftId).limit(1).abortSignal(AbortSignal.timeout(5000));
        if (attemptError || attempts?.length) return NextResponse.json({ success: false,
          error: "This report already has an upload attempt. Check its helper result before retrying; the approved letter is retained." }, { status: 409 });
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
  } catch (error) {
    console.error("Workflow status update failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update workflow status.",
      },
      { status: 500 },
    );
  }
}