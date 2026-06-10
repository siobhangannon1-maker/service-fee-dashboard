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

type QueueRow = {
  id: string;
  appointment_id: string | null;
  appointment_time: string | null;
  praktika_patient_id: string | null;
  referrer_name: string | null;
  referrer_address: string | null;
  referrer_practice_name?: string | null;
  source_clinical_notes: string | null;
  raw_json: Record<string, unknown> | null;
};

type PraktikaReferral = {
  id?: string | number;
  date?: string;
  createdDate?: string;
  reason?: string;
  party?: {
    id?: string | number;
    clinicId?: string | number;
    provider?: {
      id?: string | number;
      title?: string;
      firstName?: string;
      lastName?: string;
      providerNumber?: string;
    };
    clinic?: Record<string, unknown>;
    practice?: Record<string, unknown>;
  };
  provider?: Record<string, unknown>;
  clinic?: Record<string, unknown>;
  practice?: Record<string, unknown>;
  [key: string]: unknown;
};

type ClinicalNote = {
  id?: string | number;
  author?: string;
  date?: string;
  text?: string;
  deleted?: boolean;
  appointmentid?: string | number | null;
  appointmentId?: string | number | null;
  iAppointmentId?: string | number | null;
  dateCreated?: string;
  history?: ClinicalNote[];
  [key: string]: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function timeoutAfter<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  // Attach a catch so the original helper promise cannot create an unhandled rejection
  // if it eventually fails after this route has already returned a timeout response.
  promise.catch(() => {});
  return Promise.race([promise, timeoutAfter<T>(ms, message)]);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isoDateOnly(value: unknown) {
  return clean(value).slice(0, 10);
}

function auDateFromIso(value: string) {
  const iso = isoDateOnly(value);
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}

function auDateShortFromIso(value: string) {
  const iso = isoDateOnly(value);
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year.slice(-2)}`;
}

function getFirstCleanString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = clean(source[key]);
    if (value) return value;
  }
  return "";
}

function joinUniqueLines(parts: string[]) {
  const seen = new Set<string>();

  return parts
    .flatMap((part) => clean(part).split(/\n+/))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

function getAppointmentNotesText(raw: Record<string, unknown>) {
  const appointmentNotes = getFirstCleanString(raw, [
    "vchAppointmentNotes",
    "appointment_notes",
    "appointmentNotes",
  ]);
  const treatmentType = getFirstCleanString(raw, [
    "vchTxType",
    "vchTreatmentType",
    "treatment_type",
  ]);
  const treatmentLabel = getFirstCleanString(raw, [
    "vchTxLabel",
    "treatment_label",
  ]);

  return [
    appointmentNotes ? `Appointment notes: ${appointmentNotes}` : "",
    treatmentType ? `Treatment type: ${treatmentType}` : "",
    treatmentLabel ? `Treatment label: ${treatmentLabel}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function normaliseKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

type DeepMatch = { key: string; value: string; path: string };

function collectDeepStringMatches(
  value: unknown,
  keyMatcher: (normalisedKey: string, rawKey: string, path: string) => boolean,
  options?: { maxDepth?: number; path?: string; seen?: WeakSet<object> },
): DeepMatch[] {
  const maxDepth = options?.maxDepth ?? 8;
  const path = options?.path ?? "root";
  const seen = options?.seen ?? new WeakSet<object>();

  if (maxDepth < 0 || !value || typeof value !== "object") return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);

  const matches: DeepMatch[] = [];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      matches.push(
        ...collectDeepStringMatches(entry, keyMatcher, {
          maxDepth: maxDepth - 1,
          path: `${path}[${index}]`,
          seen,
        }),
      );
    });
    return matches;
  }

  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const normalised = normaliseKey(rawKey);
    const nextPath = `${path}.${rawKey}`;

    if (typeof rawValue === "string" || typeof rawValue === "number") {
      const text = clean(rawValue);
      if (text && keyMatcher(normalised, rawKey, nextPath)) {
        matches.push({ key: rawKey, value: text, path: nextPath });
      }
      continue;
    }

    matches.push(
      ...collectDeepStringMatches(rawValue, keyMatcher, {
        maxDepth: maxDepth - 1,
        path: nextPath,
        seen,
      }),
    );
  }

  return matches;
}

function extractPatientReferrals(parsed: any): PraktikaReferral[] {
  const found: PraktikaReferral[] = [];

  function walk(value: any) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== "object") return;

    if (Array.isArray(value.patient_referrals)) {
      found.push(...value.patient_referrals);
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") walk(nested);
    }
  }

  walk(parsed);

  const unique = new Map<string, PraktikaReferral>();
  for (const referral of found) {
    const key = clean(referral.id) || JSON.stringify(referral).slice(0, 300);
    if (!unique.has(key)) unique.set(key, referral);
  }

  return Array.from(unique.values());
}

function getReferralSortDate(referral: PraktikaReferral) {
  return new Date(
    clean(referral.createdDate) || clean(referral.date) || "1900-01-01",
  ).getTime();
}

function formatProviderName(referral: PraktikaReferral | null) {
  if (!referral) return "";

  const provider = referral.party?.provider || asObject(referral.provider);

  return [provider?.title, provider?.firstName, provider?.lastName]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function getObjectCandidatesFromReferral(referral: PraktikaReferral | null) {
  if (!referral) return [] as Record<string, unknown>[];

  const root = asObject(referral);
  const party = asObject(referral.party);
  const provider = asObject(referral.party?.provider || referral.provider);
  const clinic = asObject(referral.clinic || referral.party?.clinic);
  const practice = asObject(referral.practice || referral.party?.practice);

  const nestedKeys = [
    "clinic",
    "practice",
    "referrerClinic",
    "referrer_clinic",
    "referrerPractice",
    "referrer_practice",
    "providerClinic",
    "provider_clinic",
    "providerPractice",
    "provider_practice",
    "organisation",
    "organization",
    "business",
    "facility",
    "address",
  ];

  const nested = [root, party, provider, clinic, practice]
    .flatMap((object) => nestedKeys.map((key) => asObject(object[key])))
    .filter((object) => Object.keys(object).length > 0);

  return [root, party, provider, clinic, practice, ...nested].filter(
    (object) => Object.keys(object).length > 0,
  );
}

function extractReferralPracticeAndAddress(referral: PraktikaReferral | null) {
  const candidates = getObjectCandidatesFromReferral(referral);

  let practiceName = "";
  let wholeAddress = "";
  let line1 = "";
  let line2 = "";
  let suburb = "";
  let state = "";
  let postcode = "";

  for (const candidate of candidates) {
    practiceName ||= getFirstCleanString(candidate, [
      "practiceName",
      "practice_name",
      "clinicName",
      "clinic_name",
      "businessName",
      "business_name",
      "organisationName",
      "organizationName",
      "organisation_name",
      "organization_name",
      "facilityName",
      "facility_name",
      "name",
      "vchClinic",
      "vchClinicName",
      "vchPractice",
      "vchPracticeName",
      "vchBusinessName",
    ]);

    wholeAddress ||= getFirstCleanString(candidate, [
      "address",
      "formattedAddress",
      "formatted_address",
      "practiceAddress",
      "practice_address",
      "clinicAddress",
      "clinic_address",
      "providerAddress",
      "provider_address",
      "vchAddress",
      "vchClinicAddress",
      "vchPracticeAddress",
      "vchProviderAddress",
    ]);

    line1 ||= getFirstCleanString(candidate, [
      "addressLine1",
      "address_line_1",
      "line1",
      "streetAddress",
      "street_address",
      "vchAddress1",
      "vchStreetAddress",
    ]);
    line2 ||= getFirstCleanString(candidate, [
      "addressLine2",
      "address_line_2",
      "line2",
      "vchAddress2",
    ]);
    suburb ||= getFirstCleanString(candidate, ["suburb", "city", "town", "vchSuburb", "vchCity"]);
    state ||= getFirstCleanString(candidate, ["state", "province", "vchState"]);
    postcode ||= getFirstCleanString(candidate, [
      "postcode",
      "postCode",
      "postalCode",
      "postal_code",
      "zip",
      "vchPostcode",
      "vchPostCode",
    ]);
  }

  // Last resort: search only inside the selected referral object, never the appointment row.
  const deepPractice = !practiceName
    ? collectDeepStringMatches(referral, (key) =>
        [
          "practicename",
          "clinicname",
          "businessname",
          "organisationname",
          "organizationname",
          "facilityname",
          "vchclinic",
          "vchclinicname",
          "vchpractice",
          "vchpracticename",
        ].includes(key),
      )[0]?.value || ""
    : "";

  const deepAddress = !wholeAddress
    ? collectDeepStringMatches(referral, (key) =>
        [
          "address",
          "formattedaddress",
          "practiceaddress",
          "clinicaddress",
          "provideraddress",
          "vchaddress",
          "vchclinicaddress",
          "vchpracticeaddress",
          "vchprovideraddress",
        ].includes(key),
      )[0]?.value || ""
    : "";

  practiceName ||= deepPractice;
  wholeAddress ||= deepAddress;

  const suburbStatePostcode = [suburb, state, postcode].filter(Boolean).join(" ");
  const address = joinUniqueLines([
    practiceName,
    wholeAddress,
    line1,
    line2,
    suburbStatePostcode,
  ]);

  return {
    practiceName,
    address,
  };
}

function flattenClinicalNotes(notes: ClinicalNote[]) {
  const output: ClinicalNote[] = [];

  function add(note: ClinicalNote) {
    output.push(note);
    if (Array.isArray(note.history)) {
      for (const historyNote of note.history) add(historyNote);
    }
  }

  for (const note of notes) add(note);
  return output;
}

function extractClinicalNotes(parsed: any): ClinicalNote[] {
  const found: ClinicalNote[] = [];

  function walk(value: any) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== "object") return;

    if (Array.isArray(value.patient_clinicalnotes)) {
      found.push(...flattenClinicalNotes(value.patient_clinicalnotes));
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") walk(nested);
    }
  }

  walk(parsed);

  const unique = new Map<string, ClinicalNote>();
  for (const note of found) {
    const key = clean(note.id) || JSON.stringify(note).slice(0, 200);
    if (!unique.has(key)) unique.set(key, note);
  }

  return Array.from(unique.values());
}

function getClinicalNoteText(note: ClinicalNote) {
  return (
    clean(note.text) ||
    clean((note as any).note) ||
    clean((note as any).noteText) ||
    clean((note as any).notes) ||
    clean((note as any).vchClinicalNotes) ||
    clean((note as any).vchClinicalNote) ||
    clean((note as any).body) ||
    clean((note as any).content)
  );
}

function noteMatchesAppointment(note: ClinicalNote, appointmentId: string) {
  if (!appointmentId) return false;

  return [
    note.appointmentid,
    note.appointmentId,
    note.iAppointmentId,
    (note as any).appointment_id,
  ].some((value) => clean(value) === appointmentId);
}

function noteMatchesDate(note: ClinicalNote, appointmentDate: string) {
  const targetDate = isoDateOnly(appointmentDate);
  if (!targetDate) return false;

  const noteDate = isoDateOnly(note.date);
  const createdDate = isoDateOnly(note.dateCreated);

  if (noteDate === targetDate || createdDate === targetDate) return true;

  const text = getClinicalNoteText(note).toLowerCase();
  const auLong = auDateFromIso(targetDate).toLowerCase();
  const auShort = auDateShortFromIso(targetDate).toLowerCase();

  return Boolean(
    text.includes(`appointment of ${auLong}`) ||
      text.includes(`appointment of ${auShort}`) ||
      text.includes(auLong) ||
      text.includes(auShort),
  );
}

async function fetchPatientFormDataFromPraktika({
  patientId,
  practiceId,
  mode,
}: {
  patientId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  return await praktikaHelperPost<any>({
    mode,
    jobType: "enrich_letter_queue_patient_form_latest_referral_only",
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    priority: 30,
    timeoutMs: 40_000,
    body: [
      {
        parameters: [
          {
            practice_id: Number(practiceId),
            patient_id: Number(patientId),
          },
        ],
        fields: ["patient_referrals", "patient_clinicalnotes"],
      },
    ],
  });
}

async function enrichQueueRow(params: {
  row: QueueRow;
  mode: PraktikaSessionMode;
  practiceId: string;
  force: boolean;
}) {
  const { row, mode, practiceId, force } = params;
  const raw = asObject(row.raw_json);
  const patientId = clean(row.praktika_patient_id || raw.iPatientId);
  const appointmentId = clean(row.appointment_id || raw.iAppointmentId);
  const appointmentDate = clean(row.appointment_time || raw.dtAppointment || raw.vchAppDate);
  const appointmentNotesText = clean(raw.appointment_notes_text) || getAppointmentNotesText(raw);
  const existingSameDayClinicalNotes = clean(raw.cached_clinical_notes);

  if (!patientId) {
    return {
      rowId: row.id,
      success: false,
      skipped: true,
      error: "Missing Praktika patient ID.",
    };
  }

  if (!force && clean(raw.enrichment_version) === "praktika_referral_v4") {
    return {
      rowId: row.id,
      success: true,
      skipped: true,
      reason: "Already enriched by praktika_referral_v4.",
    };
  }

  try {
    const parsed = await withTimeout(
      fetchPatientFormDataFromPraktika({
        patientId,
        practiceId,
        mode,
      }),
      45_000,
      "Praktika patient-form enrichment timed out after 45 seconds.",
    );

    const referrals = extractPatientReferrals(parsed);
    const latestReferral =
      referrals
        .filter((referral) => formatProviderName(referral))
        .sort((a, b) => getReferralSortDate(b) - getReferralSortDate(a))[0] || null;

    const referralName = formatProviderName(latestReferral);
    const referralPractice = extractReferralPracticeAndAddress(latestReferral);

    // Important: do not use appointment notes, treating provider, or appointment practice
    // as fallback referrer data. If Praktika's latest referral lacks an address, leave it blank
    // and expose debug data so the extraction can be improved safely.
    const finalReferrerName = referralName || null;
    const finalReferrerPracticeName = referralPractice.practiceName || null;
    const finalReferrerAddress = referralPractice.address || null;

    const notes = extractClinicalNotes(parsed).filter((note) => !note.deleted);
    const matchingNotes = notes.filter(
      (note) => noteMatchesAppointment(note, appointmentId) || noteMatchesDate(note, appointmentDate),
    );

    const sameDayClinicalNotes = matchingNotes
      .map((note) => getClinicalNoteText(note))
      .filter(Boolean)
      .join("\n\n---\n\n");

    const finalSameDayClinicalNotes = sameDayClinicalNotes || existingSameDayClinicalNotes || "";
    const sourceClinicalNotes = [
      appointmentNotesText,
      finalSameDayClinicalNotes ? "Same-day Praktika clinical notes:" : "",
      finalSameDayClinicalNotes,
    ]
      .filter(Boolean)
      .join("\n\n");

    const now = new Date().toISOString();

    const updatePayload = {
      referrer_name: finalReferrerName,
      referrer_address: finalReferrerAddress,
      referrer_practice_name: finalReferrerPracticeName,
      source_clinical_notes: sourceClinicalNotes || null,
      updated_at: now,
      raw_json: {
        ...raw,
        appointment_notes_text: appointmentNotesText || null,
        referrer_name: finalReferrerName,
        referrer_address: finalReferrerAddress,
        referrer_practice_name: finalReferrerPracticeName,
        latest_referral: latestReferral
          ? {
              referralId: latestReferral.id || "",
              referralDate: latestReferral.date || "",
              createdDate: latestReferral.createdDate || "",
              referrerName: referralName,
              referrerAddress: finalReferrerAddress,
              referrerPracticeName: finalReferrerPracticeName,
              providerId: latestReferral.party?.provider?.id || null,
              providerNumber: latestReferral.party?.provider?.providerNumber || "",
              clinicId: latestReferral.party?.clinicId || null,
              reason: latestReferral.reason || "",
            }
          : null,
        cached_clinical_notes: finalSameDayClinicalNotes || null,
        cached_clinical_notes_source: sameDayClinicalNotes
          ? "praktika_live_enrich"
          : existingSameDayClinicalNotes
            ? clean(raw.cached_clinical_notes_source) || "preserved_existing"
            : null,
        cached_clinical_notes_at: finalSameDayClinicalNotes ? now : null,
        enrichment_attempted_at: now,
        enrichment_version: "praktika_referral_v4",
        enrichment_status:
          finalReferrerName && finalReferrerAddress && finalSameDayClinicalNotes
            ? "complete"
            : "partial",
        enrichment_debug: {
          patientId,
          appointmentId,
          appointmentDate,
          referralCount: referrals.length,
          selectedReferralId: latestReferral?.id || null,
          selectedReferralName: referralName || null,
          selectedReferralClinicId: latestReferral?.party?.clinicId || null,
          extractedReferralPracticeName: finalReferrerPracticeName,
          extractedReferralAddress: finalReferrerAddress,
          totalClinicalNotes: notes.length,
          matchedClinicalNotes: matchingNotes.length,
          clinicalNoteIds: matchingNotes.map((note) => note.id || null).filter(Boolean),
          latestReferralRawPreview: latestReferral
            ? JSON.stringify(latestReferral).slice(0, 2000)
            : null,
        },
      },
    };

    const { error } = await supabase
      .from("report_letter_queue")
      .update(updatePayload)
      .eq("id", row.id);

    if (error) throw new Error(error.message);

    return {
      rowId: row.id,
      success: true,
      skipped: false,
      referrerFilled: Boolean(finalReferrerName),
      referrerAddressFilled: Boolean(finalReferrerAddress),
      clinicalNotesFilled: Boolean(finalSameDayClinicalNotes),
      matchedClinicalNotes: matchingNotes.length,
      totalClinicalNotes: notes.length,
    };
  } catch (error) {
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Failed to enrich queue row.";

    await supabase
      .from("report_letter_queue")
      .update({
        updated_at: now,
        raw_json: {
          ...raw,
          enrichment_attempted_at: now,
          enrichment_version: "praktika_referral_v4",
          enrichment_status: "failed",
          enrichment_failed_at: now,
          enrichment_error: message,
        },
      })
      .eq("id", row.id);

    return { rowId: row.id, success: false, skipped: false, error: message };
  }
}

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json().catch(() => ({}));

    const fromDate = clean(body.fromDate);
    const toDate = clean(body.toDate);
    const force = Boolean(body.force);
    const limit = Math.min(Math.max(Number(body.limit) || 1, 1), 5);
    const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

    let query = supabase
      .from("report_letter_queue")
      .select("*")
      .in("status", ["queued", "started"])
      .order("appointment_time", { ascending: true })
      .limit(100);

    if (fromDate) query = query.gte("appointment_time", `${fromDate}T00:00:00`);
    if (toDate) query = query.lte("appointment_time", `${toDate}T23:59:59`);

    const { data: queueRows, error: queueError } = await query;

    if (queueError) {
      return NextResponse.json({ success: false, error: queueError.message }, { status: 500 });
    }

    const needingEnrichment = ((queueRows || []) as QueueRow[]).filter((row) => {
      const raw = asObject(row.raw_json);
      if (force) return true;
      return clean(raw.enrichment_version) !== "praktika_referral_v4";
    });

    const rows = needingEnrichment.slice(0, limit);
    const remainingAfterThisBatch = Math.max(0, needingEnrichment.length - rows.length);

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        enriched: 0,
        skipped: 0,
        failed: 0,
        remaining: 0,
        done: true,
        message: "No queue rows need enrichment.",
      });
    }

    const results = [];
    for (const row of rows) {
      results.push(
        await enrichQueueRow({
          row,
          mode,
          practiceId,
          force,
        }),
      );
    }

    const enriched = results.filter((result) => result.success && !result.skipped).length;
    const skipped = results.filter((result) => result.skipped).length;
    const failed = results.filter((result) => !result.success).length;
    const referrerFilled = results.filter((result: any) => result.referrerFilled).length;
    const referrerAddressFilled = results.filter((result: any) => result.referrerAddressFilled).length;
    const clinicalNotesFilled = results.filter((result: any) => result.clinicalNotesFilled).length;

    return NextResponse.json({
      success: true,
      processed: results.length,
      enriched,
      skipped,
      failed,
      referrerFilled,
      referrerAddressFilled,
      clinicalNotesFilled,
      remaining: remainingAfterThisBatch,
      done: remainingAfterThisBatch === 0,
      results,
    });
  } catch (error) {
    console.error("Praktika letter queue enrichment failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to enrich Praktika letter queue.",
      },
      { status: 500 },
    );
  }
}
