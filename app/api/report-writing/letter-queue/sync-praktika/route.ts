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

type PatientGender = "male" | "female" | "neutral";

type PraktikaAppointmentRow = {
  iPatientId?: string;
  iAppointmentId?: string;
  dtAppointment?: string;
  vchProviderName?: string;
  vchPatientFirstName?: string;
  vchPatientLastName?: string;
  dtDOB?: string;
  vchIconLabel1?: string;
  vchIconLabel2?: string;
  vchIconLabel3?: string;
  vchIconLabel4?: string;
  vchPatientTitle?: string;
  vchAppointmentNotes?: string;
  vchTxType?: string;
  vchTxLabel?: string;
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

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normaliseProviderName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
    timeoutMs: 120_000,
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

    const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

    // Original model: keep this sync fast. It creates/updates queue rows only.
    // Referral and same-day clinical notes are loaded live when a queue item is opened,
    // then cached back into report_letter_queue.
    const parsedRows = await fetchAppointmentRowsFromPraktika({
      fromDate,
      toDate,
      practiceId,
      mode,
    });

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
        const appointmentId = clean(row.iAppointmentId);
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
          appointment_time: clean(row.dtAppointment) || null,
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
        fromDate,
        toDate,
        message: "No appointments with Typist Letter icon found.",
      });
    }

    const appointmentIds = incomingQueueRows.map((row) => row.appointment_id);

    const { data: existingRows, error: existingError } = await supabase
      .from("report_letter_queue")
      .select("appointment_id, status, report_draft_id, referrer_name, referrer_address, source_clinical_notes, raw_json")
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
      const existingRaw =
        existing?.raw_json && typeof existing.raw_json === "object"
          ? existing.raw_json
          : {};

      const existingCachedNotes = clean(existingRaw.cached_clinical_notes);
      const existingSourceClinicalNotes = clean(existing?.source_clinical_notes);
      const appointmentOnlyNotes = row.source_clinical_notes;

      return {
        ...row,
        status: existing?.status || "queued",
        report_draft_id: existing?.report_draft_id || null,
        // Preserve manually/live-filled referral details when resyncing appointments.
        referrer_name: clean(existing?.referrer_name) || row.referrer_name,
        referrer_address: clean(existing?.referrer_address) || row.referrer_address,
        // Preserve real cached clinical notes if they were already loaded on open.
        source_clinical_notes:
          existingCachedNotes
            ? [appointmentOnlyNotes, "Same-day Praktika clinical notes:", existingCachedNotes]
                .filter(Boolean)
                .join("\n\n")
            : existingSourceClinicalNotes && existingSourceClinicalNotes.includes("Same-day Praktika clinical notes:")
              ? existingSourceClinicalNotes
              : appointmentOnlyNotes,
        raw_json: {
          ...row.raw_json,
          cached_clinical_notes: existingCachedNotes || null,
          cached_clinical_notes_source:
            clean(existingRaw.cached_clinical_notes_source) || null,
          cached_clinical_notes_at: clean(existingRaw.cached_clinical_notes_at) || null,
          previous_raw_json_preserved_at: existingRaw ? new Date().toISOString() : null,
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
