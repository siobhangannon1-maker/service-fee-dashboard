import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const ACTIVE_STATUSES = ["queued", "started"];
const HYDRATION_JOB_TYPE = "hydrate_report_letter_queue_item";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isoDateOnly(value: unknown) {
  const text = clean(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

async function getHydrationAppUserId() {
  const { data, error } = await supabase
    .from("praktika_sessions")
    .select("app_user_id, updated_at")
    .eq("scope", "user")
    .not("app_user_id", "is", null)
    .in("status", ["connected", "refreshing", "refresh_requested"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Could not find a Praktika session for hydration:", error.message);
  }

  return clean(data?.app_user_id) || null;
}

async function getAlreadyQueuedQueueIds(queueIds: string[]) {
  if (queueIds.length === 0) return new Set<string>();

  const { data, error } = await supabase
    .from("praktika_helper_jobs")
    .select("request")
    .eq("job_type", HYDRATION_JOB_TYPE)
    // The helper processor in scripts/praktika-helper-job-processor.ts claims
    // jobs by changing status from "pending" to "processing".
    // Keep "running" too in case an older worker/version used that name.
    .in("status", ["pending", "processing", "running"]);

  if (error) {
    console.warn("Could not check existing hydration jobs:", error.message);
    return new Set<string>();
  }

  const requested = new Set(queueIds);
  const existing = new Set<string>();

  for (const job of data || []) {
    const request = asObject(job.request);
    const queueId = clean(request.queueId);
    if (requested.has(queueId)) existing.add(queueId);
  }

  return existing;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const providerId = clean(body.providerId);
    const status = clean(body.status) || "active";
    const limit = Math.min(Math.max(Number(body.limit || 50), 1), 100);
    const practiceId = clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 },
      );
    }

    let query = supabase
      .from("report_letter_queue")
      .select(
        "id, praktika_patient_id, appointment_id, appointment_time, status, referrer_name, referrer_address, raw_json",
      )
      .eq("provider_id", providerId)
      .order("appointment_time", { ascending: false })
      .limit(limit);

    if (status === "active") {
      query = query.in("status", ACTIVE_STATUSES);
    } else {
      query = query.eq("status", status);
    }

    const { data: rows, error } = await query;

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    const candidateRows = (rows || []).filter((row: any) => {
      const raw = asObject(row.raw_json);
      const hasClinicalNotes = Boolean(clean(raw.cached_clinical_notes));
      const latestReferral = asObject(raw.latest_referral || raw.latestReferral);
      const hasLatestReferral = Object.keys(latestReferral).length > 0;
      const hasReferrer =
        Boolean(clean(row.referrer_name)) &&
        Boolean(clean(row.referrer_address)) &&
        hasLatestReferral;

      return (
        Boolean(clean(row.id)) &&
        Boolean(clean(row.praktika_patient_id)) &&
        (!hasClinicalNotes || !hasReferrer)
      );
    });

    if (candidateRows.length === 0) {
      return NextResponse.json({
        success: true,
        enqueued: 0,
        skipped: rows?.length || 0,
        message: "All visible queue rows already look hydrated.",
      });
    }

    const appUserId = await getHydrationAppUserId();

    if (!appUserId) {
      return NextResponse.json({
        success: true,
        enqueued: 0,
        skipped: candidateRows.length,
        message: "No connected user Praktika session was found for hydration jobs.",
      });
    }

    const queueIds = candidateRows
      .map((row: any) => clean(row.id))
      .filter(Boolean);

    const alreadyQueued = await getAlreadyQueuedQueueIds(queueIds);
    const now = new Date().toISOString();

    const jobs = candidateRows
      .filter((row: any) => !alreadyQueued.has(clean(row.id)))
      .map((row: any) => {
        const raw = asObject(row.raw_json);

        return {
          app_user_id: appUserId,
          job_type: HYDRATION_JOB_TYPE,
          status: "pending",
          priority: 35,
          attempts: 0,
          available_at: now,
          request: {
            queueId: clean(row.id),
            patientId: clean(row.praktika_patient_id),
            practiceId,
            appointmentId: clean(row.appointment_id) || clean(raw.iAppointmentId),
            appointmentDate:
              isoDateOnly(row.appointment_time) ||
              isoDateOnly(raw.dtAppointment) ||
              isoDateOnly(raw.vchAppDate),
          },
        };
      });

    if (jobs.length === 0) {
      return NextResponse.json({
        success: true,
        enqueued: 0,
        skipped: candidateRows.length,
        message: "Hydration jobs are already pending or processing.",
      });
    }

    const { error: insertError } = await supabase
      .from("praktika_helper_jobs")
      .insert(jobs);

    if (insertError) {
      return NextResponse.json(
        { success: false, error: insertError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      enqueued: jobs.length,
      skipped: candidateRows.length - jobs.length,
      message: "Queue hydration jobs enqueued.",
    });
  } catch (error) {
    console.error("Hydrate letter queue failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to enqueue queue hydration jobs.",
      },
      { status: 500 },
    );
  }
}
