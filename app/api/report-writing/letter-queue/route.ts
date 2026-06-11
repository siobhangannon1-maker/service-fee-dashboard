import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createReportAuditEvent,
  getAuditActor,
} from "@/lib/report-writing/audit";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ALLOWED_STATUSES = new Set(["queued", "started", "completed"]);

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get("providerId");
  const status = searchParams.get("status") || "active";
  const draftId = searchParams.get("draftId");

  let query = supabase
    .from("report_letter_queue")
    .select("*")
    .order("appointment_time", { ascending: false });

  if (draftId) {
    query = query.eq("report_draft_id", draftId);
  } else if (providerId) {
    query = query.eq("provider_id", providerId);
  }

  if (!draftId) {
    if (status === "active") {
      query = query.in("status", ["queued", "started"]);
    } else if (ALLOWED_STATUSES.has(status)) {
      query = query.eq("status", status);
    } else {
      query = query.in("status", ["queued", "started"]);
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    queue: data || [],
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const {
      queueId,
      status,
      reportDraftId,
      cachedClinicalNotes,
      cachedClinicalNotesSource,
      referrerName,
      referrerAddress,
      latestReferral,
    } = body;

    if (!queueId || !status) {
      return NextResponse.json(
        { success: false, error: "Missing queueId or status." },
        { status: 400 },
      );
    }

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { success: false, error: "Invalid queue status." },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("report_letter_queue")
      .select("raw_json, source_clinical_notes")
      .eq("id", queueId)
      .single();

    if (existingError) {
      return NextResponse.json(
        { success: false, error: existingError.message },
        { status: 500 },
      );
    }

    const rawJson = asObject(existing?.raw_json);

    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (reportDraftId) {
      updatePayload.report_draft_id = reportDraftId;
    }

    if (typeof referrerName === "string") {
      updatePayload.referrer_name = clean(referrerName) || null;
    }

    if (typeof referrerAddress === "string") {
      updatePayload.referrer_address = clean(referrerAddress) || null;
    }

    const nextRawJson: Record<string, unknown> = {
      ...rawJson,
    };

    if (latestReferral && typeof latestReferral === "object") {
      nextRawJson.latest_referral = latestReferral;
      nextRawJson.referral_autofill_at = new Date().toISOString();
    }

    if (typeof cachedClinicalNotes === "string") {
      const cleanCachedClinicalNotes = clean(cachedClinicalNotes);

      if (cleanCachedClinicalNotes) {
        updatePayload.source_clinical_notes = cleanCachedClinicalNotes;

        nextRawJson.cached_clinical_notes = cleanCachedClinicalNotes;
        nextRawJson.cached_clinical_notes_source =
          clean(cachedClinicalNotesSource) || "praktika_clinical_notes";
        nextRawJson.cached_clinical_notes_at = new Date().toISOString();
      }
    }

    updatePayload.raw_json = nextRawJson;

    const { data, error } = await supabase
      .from("report_letter_queue")
      .update(updatePayload)
      .eq("id", queueId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    try {
      const actor = await getAuditActor();

      await createReportAuditEvent({
        reportDraftId: reportDraftId || data.report_draft_id || null,
        providerId: data.provider_id,
        patientName: [data.patient_first_name, data.patient_last_name]
          .filter(Boolean)
          .join(" "),
        action:
          status === "started"
            ? "Started queue item"
            : status === "completed"
              ? "Completed queue item"
              : "Updated queue item",
        details: {
          queueId: data.id,
          queueStatus: status,
          reportDraftId: reportDraftId || data.report_draft_id || null,
          actorInitials: actor.actorInitials,
          actorFullName: actor.actorFullName,
          referrerCached: typeof referrerName === "string",
          clinicalNotesCached: typeof cachedClinicalNotes === "string",
        },
      });
    } catch (auditError) {
      console.warn("Queue audit event failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      queueItem: data,
    });
  } catch (error) {
    console.error("Update letter queue failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update queue item.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const queueId = clean(body.queueId);

    if (!queueId) {
      return NextResponse.json(
        { success: false, error: "Missing queueId." },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("report_letter_queue")
      .select(
        "id, provider_id, report_draft_id, patient_first_name, patient_last_name, appointment_id, status",
      )
      .eq("id", queueId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { success: false, error: existingError.message },
        { status: 500 },
      );
    }

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Queue item not found." },
        { status: 404 },
      );
    }

    const { error } = await supabase
      .from("report_letter_queue")
      .delete()
      .eq("id", queueId);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    try {
      const actor = await getAuditActor();

      await createReportAuditEvent({
        reportDraftId: existing.report_draft_id || null,
        providerId: existing.provider_id,
        patientName: [existing.patient_first_name, existing.patient_last_name]
          .filter(Boolean)
          .join(" "),
        action: "Deleted queue item",
        details: {
          queueId: existing.id,
          appointmentId: existing.appointment_id || null,
          previousStatus: existing.status || null,
          actorInitials: actor.actorInitials,
          actorFullName: actor.actorFullName,
        },
      });
    } catch (auditError) {
      console.warn("Queue delete audit event failed:", auditError);
    }

    return NextResponse.json({
      success: true,
      deletedQueueId: queueId,
    });
  } catch (error) {
    console.error("Delete letter queue item failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete queue item.",
      },
      { status: 500 },
    );
  }
}
