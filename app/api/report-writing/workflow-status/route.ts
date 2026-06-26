import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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