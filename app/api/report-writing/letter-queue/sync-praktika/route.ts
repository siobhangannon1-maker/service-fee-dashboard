import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PENDING_LETTER_ICON_ID = 7341;

type PatientGender = "male" | "female" | "neutral";

type PraktikaAppointmentRow = {
  iPatientId?: string | number | null;
  iAppointmentId?: string | number | null;
  iAppointmentID?: string | number | null;
  appointment_id?: string | number | null;
  appointmentId?: string | number | null;

  dtAppointment?: string | null;
  vchAppDate?: string | null;
  vchAppTime?: string | null;
  vchProviderName?: string | null;
  vchPatientFirstName?: string | null;
  vchPatientLastName?: string | null;
  dtDOB?: string | null;
  vchPatientTitle?: string | null;
  vchAppointmentNotes?: string | null;
  vchTxType?: string | null;
  vchTxLabel?: string | null;

  iIcon1Id?: string | number | null;
  iIcon2Id?: string | number | null;
  iIcon3Id?: string | number | null;
  iIcon4Id?: string | number | null;

  appointment_icon1id?: string | number | null;
  appointment_icon2id?: string | number | null;
  appointment_icon3id?: string | number | null;
  appointment_icon4id?: string | number | null;

  vchIconLabel1?: string | null;
  vchIconLabel2?: string | null;
  vchIconLabel3?: string | null;
  vchIconLabel4?: string | null;

  [key: string]: unknown;
};

type QueueUpsertRow = {
  provider_id: string | null;
  praktika_patient_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_dob: string | null;
  patient_gender: PatientGender;
  referrer_name: string | null;
  referrer_address: string | null;
  source_clinical_notes: string | null;
  appointment_id: string;
  appointment_time: string | null;
  queue_reason: string;
  raw_json: Record<string, unknown>;
  updated_at: string;
};

type IconIndexUpsertRow = {
  appointment_id: string;
  praktika_patient_id: string | null;
  appointment_time: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_dob: string | null;
  provider_name: string | null;
  pending_icon_id: number;
  raw_json: Record<string, unknown>;
  updated_at: string;
};

type HydrationJobInsert = {
  app_user_id: string;
  job_type: string;
  status: string;
  priority: number;
  request: {
    queueId: string;
    patientId: string;
    practiceId: string;
    appointmentId: string;
    appointmentDate: string;
  };
  attempts: number;
  available_at: string;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normaliseProviderName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getAppointmentId(row: PraktikaAppointmentRow) {
  return (
    clean(row.iAppointmentId) ||
    clean(row.iAppointmentID) ||
    clean(row.appointment_id) ||
    clean(row.appointmentId)
  );
}

function praktikaBrisbaneLocalToUtcIso(value: string | null) {
  const text = clean(value);
  if (!text) return null;

  const match = text.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );

  if (!match) return text;

  const [, datePart, hourText, minuteText, secondText] = match;

  const utcDate = new Date(
    Date.UTC(
      Number(datePart.slice(0, 4)),
      Number(datePart.slice(5, 7)) - 1,
      Number(datePart.slice(8, 10)),
      Number(hourText) - 10,
      Number(minuteText),
      Number(secondText || 0),
    ),
  );

  return utcDate.toISOString();
}

function getAppointmentTime(row: PraktikaAppointmentRow) {
  const direct = clean(row.dtAppointment);
  if (direct) return praktikaBrisbaneLocalToUtcIso(direct);

  const date = clean(row.vchAppDate);
  const time = clean(row.vchAppTime);

  if (date && time) {
    return praktikaBrisbaneLocalToUtcIso(`${date} ${time}`);
  }

  if (date) return date;

  return null;
}

function getIconIds(row: PraktikaAppointmentRow) {
  return [
    numberValue(row.iIcon1Id ?? row.appointment_icon1id),
    numberValue(row.iIcon2Id ?? row.appointment_icon2id),
    numberValue(row.iIcon3Id ?? row.appointment_icon3id),
    numberValue(row.iIcon4Id ?? row.appointment_icon4id),
  ];
}

function hasPendingLetterIcon(row: PraktikaAppointmentRow) {
  return getIconIds(row).includes(PENDING_LETTER_ICON_ID);
}

function hasTypistLetterIcon(row: PraktikaAppointmentRow) {
  return [
    row.vchIconLabel1,
    row.vchIconLabel2,
    row.vchIconLabel3,
    row.vchIconLabel4,
  ].some((label) => clean(label).toLowerCase() === "typist letter");
}

function inferPatientGenderFromTitle(row: PraktikaAppointmentRow): PatientGender {
  const title = clean(row.vchPatientTitle).toLowerCase().replace(/\./g, "");

  if (["mr", "mister", "master"].includes(title)) return "male";
  if (["miss", "ms", "mrs", "madam", "madame"].includes(title)) return "female";

  return "neutral";
}

function getAppointmentNotes(row: PraktikaAppointmentRow) {
  const appointmentNotes = clean(row.vchAppointmentNotes);
  const treatmentType = clean(row.vchTxType);
  const treatmentLabel = clean(row.vchTxLabel);

  return [
    appointmentNotes ? `Appointment notes: ${appointmentNotes}` : "",
    treatmentType ? `Treatment type: ${treatmentType}` : "",
    treatmentLabel ? `Treatment label: ${treatmentLabel}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function isQueueUpsertRow(row: QueueUpsertRow | null): row is QueueUpsertRow {
  return row !== null;
}

function isIconIndexUpsertRow(
  row: IconIndexUpsertRow | null,
): row is IconIndexUpsertRow {
  return row !== null;
}

function isHydrationJobInsert(
  job: HydrationJobInsert | null,
): job is HydrationJobInsert {
  return job !== null;
}

async function fetchAppointmentRowsFromPraktika({
  fromDate,
  toDate,
  practiceId,
  mode,
}: {
  fromDate: string;
  toDate: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  const rows = await praktikaHelperPost<PraktikaAppointmentRow[]>({
    mode,
    jobType: "sync_letter_queue_appointments",
    priority: 20,
    timeoutMs: 300_000,
    path: "/php/json/db_reportingDataWarehouse.php",
    contentType: "form",
    referer:
      "https://praktika.praktika.net.au/v2/reports/upcoming-appointments",
    body: {
      sReportName: "appointments",
      bByCreationTime: "false",
      "iPracticeIds[]": [practiceId],
      sFromDate: fromDate,
      sToDate: toDate,
    },
  });

  if (!Array.isArray(rows)) {
    throw new Error("Praktika did not return a valid appointment array.");
  }

  return rows;
}

async function getHydrationAppUserId() {
  const { data } = await supabase
    .from("praktika_sessions")
    .select("app_user_id, updated_at")
    .eq("scope", "user")
    .not("app_user_id", "is", null)
    .in("status", ["connected", "refreshing", "refresh_requested"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return clean(data?.app_user_id) || null;
}

async function enqueueHydrationJobs(queueRows: any[], practiceId: string) {
  const appUserId = await getHydrationAppUserId();

  if (!appUserId) {
    return {
      enqueued: 0,
      skipped: queueRows.length,
      message:
        "No user-scoped Praktika session was found, so hydration jobs were not enqueued.",
    };
  }

  const jobsToInsert = queueRows
    .map((row): HydrationJobInsert | null => {
      const raw = asObject(row.raw_json);
      const patientId = clean(row.praktika_patient_id);
      const queueId = clean(row.id);
      const appointmentId =
        clean(row.appointment_id) || clean(raw.iAppointmentId);
      const appointmentDate =
        clean(row.appointment_time).slice(0, 10) ||
        clean(raw.dtAppointment).slice(0, 10) ||
        clean(raw.vchAppDate).slice(0, 10);

      if (!queueId || !patientId) return null;

      const hasLatestReferral =
        Object.keys(asObject(raw.latest_referral || raw.latestReferral)).length >
        0;

      const hasReferrer =
        Boolean(clean(row.referrer_name)) &&
        Boolean(clean(row.referrer_address)) &&
        hasLatestReferral;

      const hasClinicalNotes = Boolean(clean(raw.cached_clinical_notes));

      if (hasReferrer && hasClinicalNotes) return null;

      return {
        app_user_id: appUserId,
        job_type: "hydrate_report_letter_queue_item",
        status: "pending",
        priority: 35,
        request: {
          queueId,
          patientId,
          practiceId,
          appointmentId,
          appointmentDate,
        },
        attempts: 0,
        available_at: new Date().toISOString(),
      };
    })
    .filter(isHydrationJobInsert);

  if (jobsToInsert.length === 0) {
    return {
      enqueued: 0,
      skipped: queueRows.length,
      message: "All queue rows already have cached referral and clinical-note data.",
    };
  }

  const { error } = await supabase.from("praktika_helper_jobs").insert(jobsToInsert);

  if (error) {
    console.warn("Could not enqueue queue hydration jobs:", error.message);

    return {
      enqueued: 0,
      skipped: queueRows.length,
      message: error.message,
    };
  }

  return {
    enqueued: jobsToInsert.length,
    skipped: queueRows.length - jobsToInsert.length,
    message: "Hydration jobs enqueued for the local Praktika helper.",
  };
}

async function upsertPendingLetterIconIndex(parsedRows: PraktikaAppointmentRow[]) {
  const now = new Date().toISOString();

  const iconRows: IconIndexUpsertRow[] = parsedRows
    .filter(hasPendingLetterIcon)
    .map((row): IconIndexUpsertRow | null => {
      const appointmentId = getAppointmentId(row);
      if (!appointmentId) return null;

      return {
        appointment_id: appointmentId,
        praktika_patient_id: clean(row.iPatientId) || null,
        appointment_time: getAppointmentTime(row),
        patient_first_name: clean(row.vchPatientFirstName) || null,
        patient_last_name: clean(row.vchPatientLastName) || null,
        patient_dob: clean(row.dtDOB) || null,
        provider_name: clean(row.vchProviderName) || null,
        pending_icon_id: PENDING_LETTER_ICON_ID,
        raw_json: {
          ...row,
          pending_letter_icon_indexed_at: now,
          pending_letter_icon_id: PENDING_LETTER_ICON_ID,
        },
        updated_at: now,
      };
    })
    .filter(isIconIndexUpsertRow);

  if (iconRows.length === 0) {
    return {
      indexed: 0,
      message: `No appointments with pending letter icon ${PENDING_LETTER_ICON_ID} found.`,
    };
  }

  const { error } = await supabase
    .from("praktika_letter_icon_index")
    .upsert(iconRows, {
      onConflict: "appointment_id",
      ignoreDuplicates: false,
    });

  if (error) {
    console.warn("Could not upsert praktika_letter_icon_index:", error.message);

    return {
      indexed: 0,
      message: error.message,
    };
  }

  return {
    indexed: iconRows.length,
    message: `Indexed ${iconRows.length} appointment(s) with pending letter icon ${PENDING_LETTER_ICON_ID}.`,
  };
}

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json().catch(() => ({}));

    const fromDate = clean(body.fromDate) || new Date().toISOString().slice(0, 10);
    const toDate = clean(body.toDate) || fromDate;

    if (fromDate > toDate) {
      return NextResponse.json(
        { success: false, error: "From date cannot be after to date." },
        { status: 400 },
      );
    }

    const practiceId = clean(process.env.PRAKTIKA_PRACTICE_ID) || "1181";

    const parsedRows = await fetchAppointmentRowsFromPraktika({
      fromDate,
      toDate,
      practiceId,
      mode,
    });

    const iconIndexResult = await upsertPendingLetterIconIndex(parsedRows);

    const { data: mappings, error: mappingError } = await supabase
      .from("provider_name_mappings")
      .select(`
        provider_id,
        raw_provider_name,
        normalized_provider_name,
        providers!inner (
          id,
          is_active
        )
      `)
      .eq("source_type", "appointments_csv")
      .eq("providers.is_active", true);

    if (mappingError) {
      return NextResponse.json(
        { success: false, error: mappingError.message },
        { status: 500 },
      );
    }

    const providerMap = new Map<string, string>();

    for (const mapping of mappings || []) {
      if (!mapping.provider_id) continue;

      providerMap.set(
        normaliseProviderName(mapping.raw_provider_name),
        mapping.provider_id,
      );

      providerMap.set(
        normaliseProviderName(mapping.normalized_provider_name),
        mapping.provider_id,
      );
    }

    const typedAppointmentRows = parsedRows.filter(hasTypistLetterIcon);

    const incomingQueueRows: QueueUpsertRow[] = typedAppointmentRows
      .map((row): QueueUpsertRow | null => {
        const appointmentId = getAppointmentId(row);
        if (!appointmentId) return null;

        const rawProviderName = clean(row.vchProviderName);
        const providerId =
          providerMap.get(normaliseProviderName(rawProviderName)) || null;

        const patientId = clean(row.iPatientId);
        const appointmentNotes = getAppointmentNotes(row);
        const gender = inferPatientGenderFromTitle(row);

        return {
          provider_id: providerId,
          praktika_patient_id: patientId || null,
          patient_first_name: clean(row.vchPatientFirstName) || null,
          patient_last_name: clean(row.vchPatientLastName) || null,
          patient_dob: clean(row.dtDOB) || null,
          patient_gender: gender,
          referrer_name: null,
          referrer_address: null,
          source_clinical_notes: appointmentNotes || null,
          appointment_id: appointmentId,
          appointment_time: getAppointmentTime(row),
          queue_reason: "Typist Letter icon on Praktika appointment",
          raw_json: {
            ...row,
            patient_gender: gender,
            cached_clinical_notes: null,
            cached_clinical_notes_source: null,
            cached_clinical_notes_at: null,
            source_clinical_notes: appointmentNotes || null,
            lightweight_queue_sync: true,
            lightweight_queue_sync_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        };
      })
      .filter(isQueueUpsertRow);

    if (incomingQueueRows.length === 0) {
      return NextResponse.json({
        success: true,
        totalRows: parsedRows.length,
        queued: 0,
        matchedProviders: 0,
        unmatchedProviders: 0,
        genderCounts: {},
        referrerFilled: 0,
        referrerAddressFilled: 0,
        clinicalNotesFilled: 0,
        hydrationJobsEnqueued: 0,
        pendingLetterIconIndexed: iconIndexResult.indexed,
        pendingLetterIconMessage: iconIndexResult.message,
        fromDate,
        toDate,
        message: "No appointments with Typist Letter icon found.",
      });
    }

    const appointmentIds = incomingQueueRows.map((row) => row.appointment_id);

    const { data: existingRows, error: existingError } = await supabase
      .from("report_letter_queue")
      .select(
        "appointment_id, status, report_draft_id, referrer_name, referrer_address, source_clinical_notes, raw_json",
      )
      .in("appointment_id", appointmentIds);

    if (existingError) {
      return NextResponse.json(
        { success: false, error: existingError.message },
        { status: 500 },
      );
    }

    const existingByAppointmentId = new Map(
      (existingRows || []).map((row) => [row.appointment_id, row]),
    );

    const rowsToUpsert = incomingQueueRows.map((row) => {
      const existing = existingByAppointmentId.get(row.appointment_id) as any;
      const existingRaw = asObject(existing?.raw_json);

      const existingCachedNotes = clean(existingRaw.cached_clinical_notes);
      const existingSourceClinicalNotes = clean(existing?.source_clinical_notes);
      const appointmentOnlyNotes = row.source_clinical_notes;

      const existingLatestReferral = asObject(
        existingRaw.latest_referral || existingRaw.latestReferral,
      );

      return {
        ...row,
        status: existing?.status || "queued",
        report_draft_id: existing?.report_draft_id || null,
        referrer_name: clean(existing?.referrer_name) || row.referrer_name,
        referrer_address: clean(existing?.referrer_address) || row.referrer_address,
        source_clinical_notes:
          existingCachedNotes
            ? existingCachedNotes
            : existingSourceClinicalNotes &&
                !existingSourceClinicalNotes.startsWith("Appointment notes:")
              ? existingSourceClinicalNotes
              : appointmentOnlyNotes,
        raw_json: {
          ...row.raw_json,
          latest_referral:
            Object.keys(existingLatestReferral).length > 0
              ? existingLatestReferral
              : null,
          cached_clinical_notes: existingCachedNotes || null,
          cached_clinical_notes_source:
            clean(existingRaw.cached_clinical_notes_source) || null,
          cached_clinical_notes_at:
            clean(existingRaw.cached_clinical_notes_at) || null,
          previous_raw_json_preserved_at: existingRaw
            ? new Date().toISOString()
            : null,
        },
      };
    });

    const matchedProviders = rowsToUpsert.filter((row) => row.provider_id).length;
    const unmatchedProviders = rowsToUpsert.filter((row) => !row.provider_id).length;

    const genderCounts = rowsToUpsert.reduce(
      (counts, row) => {
        const gender = row.patient_gender || "neutral";
        counts[gender] = (counts[gender] || 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    );

    const clinicalNotesFilled = rowsToUpsert.filter((row: any) =>
      clean(row.raw_json?.cached_clinical_notes),
    ).length;

    const { data, error } = await supabase
      .from("report_letter_queue")
      .upsert(rowsToUpsert, {
        onConflict: "appointment_id",
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    const hydrationResult = await enqueueHydrationJobs(data || [], practiceId);

    return NextResponse.json({
      success: true,
      totalRows: parsedRows.length,
      queued: data?.length || 0,
      matchedProviders,
      unmatchedProviders,
      genderCounts,
      referrerFilled: rowsToUpsert.filter((row) => row.referrer_name).length,
      referrerAddressFilled: rowsToUpsert.filter((row) => row.referrer_address).length,
      clinicalNotesFilled,
      hydrationJobsEnqueued: hydrationResult.enqueued,
      hydrationJobsSkipped: hydrationResult.skipped,
      hydrationMessage: hydrationResult.message,
      pendingLetterIconIndexed: iconIndexResult.indexed,
      pendingLetterIconMessage: iconIndexResult.message,
      fromDate,
      toDate,
      lightweight: true,
      queue: data || [],
    });
  } catch (error) {
    console.error("Praktika letter queue sync failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Praktika letter queue.",
      },
      { status: 500 },
    );
  }
}