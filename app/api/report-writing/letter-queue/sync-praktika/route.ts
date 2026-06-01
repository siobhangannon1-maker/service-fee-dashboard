import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { praktikaPost } from "@/lib/praktika/praktika-client";

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

type ClinicalNote = {
  id?: string;
  author?: string;
  date?: string;
  text?: string;
  deleted?: boolean;
  appointmentid?: string | null;
  dateCreated?: string;
  [key: string]: unknown;
};

type ReportReferrer = {
  name: string | null;
  practice_name: string | null;
  address: string | null;
  email: string | null;
  raw_json: Record<string, unknown> | null;
};

type ReferrerLookup = {
  referrerName: string | null;
  referrerAddress: string | null;
  referralDebug: Record<string, unknown>;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function isoDateOnly(value: unknown) {
  return clean(value).slice(0, 10);
}

function normaliseProviderName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseForMatch(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
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

function normalisePraktikaGender(value: unknown): PatientGender {
  const gender = clean(value).toLowerCase();

  if (["m", "male"].includes(gender)) return "male";
  if (["f", "female"].includes(gender)) return "female";

  // Praktika's "Other" is mapped to neutral for letter generation so the
  // generated report avoids gendered pronouns.
  return "neutral";
}

function inferPatientGenderFromTitle(row: PraktikaAppointmentRow): PatientGender {
  const title = clean(row.vchPatientTitle).toLowerCase().replace(/\./g, "");

  if (["mr", "mister", "master"].includes(title)) return "male";
  if (["miss", "ms", "mrs", "madam", "madame"].includes(title)) return "female";

  return "neutral";
}

function getQueueClinicalNotes(row: PraktikaAppointmentRow) {
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

function noteMatchesDate(note: ClinicalNote, appointmentDate: string) {
  const targetDate = isoDateOnly(appointmentDate);
  if (!targetDate) return false;

  const noteDate = isoDateOnly(note.date);
  const createdDate = isoDateOnly(note.dateCreated);

  if (noteDate === targetDate || createdDate === targetDate) return true;

  const text = clean(note.text).toLowerCase();
  const auLong = auDateFromIso(targetDate).toLowerCase();
  const auShort = auDateShortFromIso(targetDate).toLowerCase();

  return Boolean(
    text.includes(`appointment of ${auLong}`) ||
      text.includes(`appointment of ${auShort}`) ||
      text.includes(auLong) ||
      text.includes(auShort),
  );
}

function noteMatchesAppointment(note: ClinicalNote, appointmentId: string) {
  if (!appointmentId) return false;
  return clean(note.appointmentid) === appointmentId;
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
      found.push(...value.patient_clinicalnotes);
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

function extractPatientReferrals(parsed: any): any[] {
  const found: any[] = [];

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

  return found;
}

function latestReferralFromParsed(parsed: any) {
  const referrals = extractPatientReferrals(parsed);

  if (!referrals.length) return null;

  return referrals.sort((a, b) => {
    const aDate = new Date(a.createdDate || a.date || "1900-01-01").getTime();
    const bDate = new Date(b.createdDate || b.date || "1900-01-01").getTime();
    return bDate - aDate;
  })[0];
}

function referralProviderName(referral: any) {
  const provider = referral?.party?.provider;

  return [provider?.title, provider?.firstName, provider?.lastName]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function parseReferrerFromAppointmentNotes(notes: unknown) {
  const text = clean(notes);
  if (!text) return "";

  const match = text.match(/(?:^|\n)\s*Referrer\s*:\s*([^\n\r]+)/i);
  return clean(match?.[1]).replace(/[.,;]+$/, "").trim();
}

async function fetchAppointmentRowsFromPraktika({
  fromDate,
  toDate,
  practiceId,
}: {
  fromDate: string;
  toDate: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  const rows = await praktikaPost<PraktikaAppointmentRow[]>({
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

async function fetchPatientFormFromPraktika({
  patientId,
  practiceId,
}: {
  patientId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  if (!patientId) return null;

  return await praktikaPost<any>({
    path: "/php/forms/db_getCustomerForm.php",
    contentType: "form",
    referer: `https://praktika.praktika.net.au/php/forms/getFormFile.php?sFileName=PersonalDetailsDesktop.html?iFormId=389&iCustomerId=480&iPracticeId=${practiceId}&iPatientId=${patientId}&isDialog=true`,
    body: {
      practice_id: practiceId,
      form_id: "389",
      patient_id: patientId,
      init_stage: "false",
    },
  });
}

async function fetchReferralsFromPraktika({
  patientId,
  practiceId,
}: {
  patientId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  if (!patientId) return null;

  return await praktikaPost<any>({
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    body: [
      {
        parameters: [
          {
            practice_id: Number(practiceId),
            patient_id: Number(patientId),
          },
        ],
        fields: ["patient_referrals"],
      },
    ],
  });
}

async function fetchClinicalNotesFromPraktika({
  patientId,
  practiceId,
}: {
  patientId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  if (!patientId) return null;

  return await praktikaPost<any>({
    path: "/php/forms/db_getFormData.php",
    contentType: "json",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    body: [
      {
        parameters: [
          {
            practice_id: Number(practiceId),
            patient_id: Number(patientId),
          },
        ],
        fields: ["patient_clinicalnotes"],
      },
    ],
  });
}

async function getSameDayClinicalNotes(params: {
  patientId: string;
  appointmentDate: string;
  appointmentId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
}) {
  try {
    const parsed = await fetchClinicalNotesFromPraktika({
      patientId: params.patientId,
      practiceId: params.practiceId,
      mode: params.mode,
    });

    if (!parsed) return "";

    const notes = extractClinicalNotes(parsed).filter((note) => !note.deleted);

    const matchingNotes = notes.filter((note) => {
      return (
        noteMatchesAppointment(note, params.appointmentId) ||
        noteMatchesDate(note, params.appointmentDate)
      );
    });

    return matchingNotes
      .map((note) => clean(note.text))
      .filter(Boolean)
      .join("\n\n---\n\n");
  } catch (error) {
    console.warn(
      `Could not fetch same-day clinical notes for patient ${params.patientId}.`,
      error,
    );

    return "";
  }
}

async function loadReportReferrersForMatching(): Promise<ReportReferrer[]> {
  const { data, error } = await supabase
    .from("report_referrers")
    .select("name, practice_name, address, email, raw_json")
    .limit(10000);

  if (error) {
    console.warn("Could not load report_referrers for address matching:", error);
    return [];
  }

  return (data || []) as ReportReferrer[];
}

function getReferrerSearchFields(referrer: ReportReferrer) {
  const raw: any = referrer.raw_json || {};

  return [
    referrer.name,
    referrer.practice_name,
    raw.vchProvider,
    raw.vchClinic,
    raw.vchStreetAddress,
    raw.vchSuburb,
    raw.vchPostCode,
  ];
}

function scoreReferrerMatch(candidates: string[], referrer: ReportReferrer) {
  const cleanedCandidates = candidates
    .map(normaliseForMatch)
    .filter((value) => value.length >= 3);

  if (!cleanedCandidates.length) return 0;

  const fields = getReferrerSearchFields(referrer)
    .map(normaliseForMatch)
    .filter(Boolean);

  if (!fields.length) return 0;

  let bestScore = 0;

  for (const candidate of cleanedCandidates) {
    const candidateWords = new Set(
      candidate.split(" ").filter((word) => word.length > 2),
    );

    for (const field of fields) {
      if (!field) continue;

      if (candidate === field) bestScore = Math.max(bestScore, 120);
      if (candidate.includes(field)) bestScore = Math.max(bestScore, 90);
      if (field.includes(candidate)) bestScore = Math.max(bestScore, 80);

      const fieldWords = new Set(field.split(" ").filter((word) => word.length > 2));
      const overlap = [...candidateWords].filter((word) =>
        fieldWords.has(word),
      ).length;

      bestScore = Math.max(bestScore, overlap * 20);
    }
  }

  return bestScore;
}

function findBestReportReferrerMatch(
  candidates: string[],
  referrers: ReportReferrer[],
) {
  let best: ReportReferrer | null = null;
  let bestScore = 0;

  for (const referrer of referrers) {
    const score = scoreReferrerMatch(candidates, referrer);

    if (score > bestScore) {
      best = referrer;
      bestScore = score;
    }
  }

  return best && bestScore >= 40 ? { referrer: best, score: bestScore } : null;
}

async function getReferrerLookup(params: {
  patientId: string;
  practiceId: string;
  mode: PraktikaSessionMode;
  appointmentNotes: string;
  patientForm: any | null;
  reportReferrers: ReportReferrer[];
}): Promise<ReferrerLookup> {
  const referralDebug: Record<string, unknown> = {};
  const appointmentReferrer = parseReferrerFromAppointmentNotes(
    params.appointmentNotes,
  );

  referralDebug.appointmentReferrer = appointmentReferrer || null;

  let latestReferral: any = null;

  try {
    const referralsParsed = await fetchReferralsFromPraktika({
      patientId: params.patientId,
      practiceId: params.practiceId,
      mode: params.mode,
    });

    latestReferral = latestReferralFromParsed(referralsParsed);
  } catch (error) {
    console.warn(`Could not fetch referrals for patient ${params.patientId}.`, error);
    referralDebug.referralFetchError =
      error instanceof Error ? error.message : String(error);
  }

  const latestReferralName = referralProviderName(latestReferral);
  referralDebug.latestReferralId = latestReferral?.id || null;
  referralDebug.latestReferralName = latestReferralName || null;
  referralDebug.latestReferralClinicId = latestReferral?.party?.clinicId || null;

  const familyDoctorName = clean(params.patientForm?.patient_familydoctor_name);
  const familyDoctorClinic = clean(params.patientForm?.patient_familydoctor_clinic);

  referralDebug.familyDoctorName = familyDoctorName || null;
  referralDebug.familyDoctorClinic = familyDoctorClinic || null;

  const localMatch = findBestReportReferrerMatch(
    [
      appointmentReferrer,
      latestReferralName,
      familyDoctorClinic,
      familyDoctorName,
    ],
    params.reportReferrers,
  );

  const matchedReferrer = localMatch?.referrer || null;
  referralDebug.reportReferrerMatched = matchedReferrer
    ? {
        name: matchedReferrer.name,
        practice_name: matchedReferrer.practice_name,
        score: localMatch?.score,
      }
    : null;

  const referrerName =
    matchedReferrer?.name ||
    latestReferralName ||
    appointmentReferrer ||
    familyDoctorName ||
    familyDoctorClinic ||
    null;

  const formattedReferrerAddress = matchedReferrer
    ? [
        clean(matchedReferrer.practice_name),
        clean(matchedReferrer.address),
      ]
        .filter(Boolean)
        .join("\n")
    : null;

  return {
    referrerName,
    referrerAddress: formattedReferrerAddress,
    referralDebug,
  };
}

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json().catch(() => ({}));

    const fromDate =
      clean(body.fromDate) || new Date().toISOString().slice(0, 10);
    const toDate = clean(body.toDate) || fromDate;

    if (fromDate > toDate) {
      return NextResponse.json(
        { success: false, error: "From date cannot be after to date." },
        { status: 400 },
      );
    }

    const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

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

    const reportReferrers = await loadReportReferrersForMatching();

    const typedAppointmentRows = parsedRows.filter(hasTypistLetterIcon);
    const incomingQueueRows = [];

    const patientFormCache = new Map<string, any | null>();
    const clinicalNotesCache = new Map<string, string>();

    for (const row of typedAppointmentRows) {
      const appointmentId = clean(row.iAppointmentId);
      if (!appointmentId) continue;

      const rawProviderName = clean(row.vchProviderName);
      const providerId =
        providerMap.get(normaliseProviderName(rawProviderName)) || null;

      const patientId = clean(row.iPatientId);
      const appointmentDate = isoDateOnly(row.dtAppointment);
      const appointmentNotes = getQueueClinicalNotes(row);

      let patientForm: any | null = null;

      if (patientId) {
        if (patientFormCache.has(patientId)) {
          patientForm = patientFormCache.get(patientId) || null;
        } else {
          try {
            patientForm = await fetchPatientFormFromPraktika({
              patientId,
              practiceId,
              mode,
            });
            patientFormCache.set(patientId, patientForm);
          } catch (error) {
            console.warn(
              `Could not fetch patient form for ${patientId}. Falling back to title/neutral.`,
              error,
            );
            patientFormCache.set(patientId, null);
          }
        }
      }

      const explicitGender = normalisePraktikaGender(patientForm?.patient_gender);
      const titleGender = inferPatientGenderFromTitle(row);

      const patientGender =
        explicitGender !== "neutral" ? explicitGender : titleGender || "neutral";

      let sameDayClinicalNotes = "";

      if (patientId && appointmentDate) {
        const clinicalCacheKey = `${patientId}:${appointmentDate}:${appointmentId}`;

        if (clinicalNotesCache.has(clinicalCacheKey)) {
          sameDayClinicalNotes = clinicalNotesCache.get(clinicalCacheKey) || "";
        } else {
          sameDayClinicalNotes = await getSameDayClinicalNotes({
            patientId,
            appointmentDate,
            appointmentId,
            practiceId,
            mode,
          });

          clinicalNotesCache.set(clinicalCacheKey, sameDayClinicalNotes);
        }
      }

      const sourceClinicalNotes = [
        appointmentNotes,
        sameDayClinicalNotes ? "Same-day Praktika clinical notes:" : "",
        sameDayClinicalNotes,
      ]
        .filter(Boolean)
        .join("\n\n");

      const referrerLookup = patientId
        ? await getReferrerLookup({
            patientId,
            practiceId,
            mode,
            appointmentNotes: clean(row.vchAppointmentNotes),
            patientForm,
            reportReferrers,
          })
        : {
            referrerName: null,
            referrerAddress: null,
            referralDebug: { reason: "No Praktika patient ID." },
          };

      incomingQueueRows.push({
        provider_id: providerId,
        praktika_patient_id: patientId || null,
        patient_first_name: clean(row.vchPatientFirstName) || null,
        patient_last_name: clean(row.vchPatientLastName) || null,
        patient_dob: clean(row.dtDOB) || null,
        patient_gender: patientGender,
        referrer_name: referrerLookup.referrerName,
        referrer_address: referrerLookup.referrerAddress,
        source_clinical_notes: sourceClinicalNotes || null,
        appointment_id: appointmentId,
        appointment_time: clean(row.dtAppointment) || null,
        queue_reason: "Typist Letter icon on Praktika appointment",
        raw_json: {
          ...row,
          patient_gender: patientGender,
          referrer_name: referrerLookup.referrerName,
          referrer_address: referrerLookup.referrerAddress,
          referrer_autofill_debug: referrerLookup.referralDebug,
          cached_clinical_notes: sameDayClinicalNotes || null,
          cached_clinical_notes_source: sameDayClinicalNotes
            ? "praktika_live_sync"
            : null,
          cached_clinical_notes_at: sameDayClinicalNotes
            ? new Date().toISOString()
            : null,
          source_clinical_notes: sourceClinicalNotes || null,
        },
        updated_at: new Date().toISOString(),
      });
    }

    if (incomingQueueRows.length === 0) {
      return NextResponse.json({
        success: true,
        totalRows: parsedRows.length,
        queued: 0,
        matchedProviders: 0,
        unmatchedProviders: 0,
        message: "No appointments with Typist Letter icon found.",
      });
    }

    const appointmentIds = incomingQueueRows.map((row) => row.appointment_id);

    const { data: existingRows, error: existingError } = await supabase
      .from("report_letter_queue")
      .select("appointment_id, status, report_draft_id")
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
      const existing = existingByAppointmentId.get(row.appointment_id);

      return {
        ...row,
        status: existing?.status || "queued",
        report_draft_id: existing?.report_draft_id || null,
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

    const referrerFilled = rowsToUpsert.filter((row) => row.referrer_name).length;
    const referrerAddressFilled = rowsToUpsert.filter(
      (row) => row.referrer_address,
    ).length;
    const clinicalNotesFilled = rowsToUpsert.filter(
      (row) => row.source_clinical_notes,
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
      referrerFilled,
      referrerAddressFilled,
      clinicalNotesFilled,
      fromDate,
      toDate,
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
