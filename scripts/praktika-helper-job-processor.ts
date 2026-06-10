import { type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const WORKER_ID = `praktika-helper-${process.pid}`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

type ReportReferrer = {
  id?: string;
  name?: string | null;
  address?: string | null;
  praktika_referrer_id?: string | null;
  practice_name?: string | null;
  phone?: string | null;
  email?: string | null;
  is_active?: boolean | null;
  raw_json?: Record<string, unknown> | null;
  praktika_referrer_key?: string | null;
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
  };
  providerId?: string | number | null;
  [key: string]: unknown;
};

type ClinicalNote = {
  id?: string | number;
  author?: string;
  date?: string;
  text?: string;
  notes?: string;
  note?: string;
  body?: string;
  content?: string;
  value?: string;
  deleted?: boolean;
  appointmentid?: string | number | null;
  appointmentId?: string | number | null;
  appointment_id?: string | number | null;
  iAppointmentId?: string | number | null;
  dateCreated?: string;
  createdDate?: string;
  created?: string;
  history?: ClinicalNote[];
  [key: string]: unknown;
};

function nowIso() {
  return new Date().toISOString();
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normaliseName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseKey(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "");
}

function looksLoggedOut(text: string) {
  const lower = text.toLowerCase();

  return (
    lower.includes("login failed") ||
    lower.includes("logged-out") ||
    lower.includes("logged out") ||
    lower.includes("not logged in") ||
    lower.includes("dbunauthorisedexception") ||
    lower.includes("hijacked or expired session") ||
    lower.includes("expired session") ||
    lower.includes("/v2/login") ||
    lower.includes('type="password"')
  );
}

function looksLikeHtml(text: string) {
  const lower = text.trim().toLowerCase();
  return lower.startsWith("<!doctype") || lower.startsWith("<html");
}

async function claimNextJob(appUserId?: string | null) {
  let query = supabase
    .from("praktika_helper_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  if (appUserId) {
    query = query.eq("app_user_id", appUserId);
  } else {
    query = query.is("app_user_id", null);
  }

  const { data: jobs, error } = await query;

  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) return null;

  const job = jobs[0];

  const { data: claimed, error: claimError } = await supabase
    .from("praktika_helper_jobs")
    .update({
      status: "processing",
      locked_at: nowIso(),
      locked_by: WORKER_ID,
      attempts: Number(job.attempts || 0) + 1,
      updated_at: nowIso(),
    })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (claimError) throw new Error(claimError.message);

  return claimed;
}

async function completeJob(jobId: string, response: unknown) {
  const { error } = await supabase
    .from("praktika_helper_jobs")
    .update({
      status: "completed",
      response,
      completed_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", jobId);

  if (error) throw new Error(error.message);
}

async function failJob(job: any, message: string) {
  const attempts = Number(job.attempts || 0);
  const permanent = attempts >= 3;

  const { error } = await supabase
    .from("praktika_helper_jobs")
    .update({
      status: permanent ? "failed" : "pending",
      error_message: message,
      failed_at: permanent ? nowIso() : null,
      available_at: permanent
        ? nowIso()
        : new Date(Date.now() + 60_000).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
    })
    .eq("id", job.id);

  if (error) throw new Error(error.message);
}

function parsePraktikaResponse(text: string, status: number) {
  if (looksLoggedOut(text) || looksLikeHtml(text)) {
    throw new Error(`Praktika helper session is logged out: ${text.slice(0, 500)}`);
  }

  if (!text.trim()) {
    if (status >= 200 && status < 300) return { ok: true, empty: true };
    throw new Error(`Praktika returned an empty response with status ${status}.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Praktika helper returned non-JSON: ${text.slice(0, 500)}`);
  }
}

async function runJsonOrFormRequest(context: BrowserContext, request: any) {
  const method = request.method || "POST";
  const contentType = request.contentType || "json";
  const referer =
    request.referer || `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`;

  if (method !== "POST") {
    throw new Error(`Unsupported Praktika helper method: ${method}`);
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    Origin: PRAKTIKA_BASE_URL,
    Referer: referer,
    "X-Requested-With": "XMLHttpRequest",
  };

  let data: any;

  if (contentType === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(request.body || {})) {
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, String(item)));
      } else if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }

    data = params.toString();
  } else {
    headers["Content-Type"] = "application/json";
    data = request.body;
  }

  const response = await context.request.post(
    `${PRAKTIKA_BASE_URL}${request.path}`,
    {
      headers,
      data,
      timeout: 120_000,
    },
  );

  const text = await response.text();

  if (!response.ok()) {
    throw new Error(`Praktika helper request failed ${response.status()}: ${text}`);
  }

  return parsePraktikaResponse(text, response.status());
}

async function runMultipartStorageRequest(context: BrowserContext, request: any) {
  const referer =
    request.referer || `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`;

  const fields = request.body?.fields || {};
  const fileSpec = request.body?.file;

  if (!fileSpec?.bucket || !fileSpec?.path || !fileSpec?.fieldName || !fileSpec?.fileName) {
    throw new Error("Multipart helper job is missing storage file details.");
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(fileSpec.bucket)
    .download(fileSpec.path);

  if (downloadError || !fileData) {
    throw new Error(
      `Could not download helper upload file: ${downloadError?.message || "No file returned."}`,
    );
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  const multipart: Record<
    string,
    string | number | boolean | { name: string; mimeType: string; buffer: Buffer }
  > = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      multipart[key] = String(value);
    }
  }

  multipart[fileSpec.fieldName] = {
    name: fileSpec.fileName,
    mimeType: fileSpec.contentType || "application/octet-stream",
    buffer: fileBuffer,
  };

  const response = await context.request.post(
    `${PRAKTIKA_BASE_URL}${request.path}`,
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: PRAKTIKA_BASE_URL,
        Referer: referer,
        "X-Requested-With": "XMLHttpRequest",
      },
      multipart,
      timeout: 120_000,
    },
  );

  const text = await response.text();

  if (!response.ok()) {
    throw new Error(`Praktika helper upload failed ${response.status()}: ${text.slice(0, 1000)}`);
  }

  const parsed = parsePraktikaResponse(text, response.status());

  await supabase.storage.from(fileSpec.bucket).remove([fileSpec.path]).catch(() => null);

  return parsed;
}

async function markSessionConnectedForJob(job: any) {
  if (!job.app_user_id) return;

  await supabase
    .from("praktika_sessions")
    .update({
      status: "connected",
      message: "Praktika helper browser is connected. Helper jobs can run for this user.",
      refreshed_at: nowIso(),
      last_used_at: nowIso(),
      updated_at: nowIso(),
      refresh_requested_at: null,
    })
    .eq("scope", "user")
    .eq("app_user_id", job.app_user_id);
}

async function markSessionNeedsReconnectForJob(job: any, message: string) {
  if (!job.app_user_id) return;

  await supabase
    .from("praktika_sessions")
    .update({
      status: "refresh_requested",
      message,
      refresh_requested_at: nowIso(),
      updated_at: nowIso(),
    })
    .eq("scope", "user")
    .eq("app_user_id", job.app_user_id);
}

async function runPraktikaRequest(context: BrowserContext, request: any) {
  if (request.contentType === "multipart_storage") {
    return await runMultipartStorageRequest(context, request);
  }

  return await runJsonOrFormRequest(context, request);
}

function isoDateOnly(value: unknown) {
  const text = clean(value);
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const auMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (auMatch) {
    return `${auMatch[3]}-${auMatch[2].padStart(2, "0")}-${auMatch[1].padStart(2, "0")}`;
  }

  return "";
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

function formatProviderName(referral: PraktikaReferral) {
  const provider = referral.party?.provider;

  return [provider?.title, provider?.firstName, provider?.lastName]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function isOwnPracticeText(value: unknown) {
  const text = clean(value).toLowerCase();

  return (
    text.includes("focus dental specialists") ||
    text.includes("focus dental")
  );
}

function isOwnPracticeReferrer(referrer: ReportReferrer) {
  return isOwnPracticeText(
    [
      referrer.name,
      referrer.practice_name,
      referrer.address,
      JSON.stringify(referrer.raw_json || {}),
    ]
      .map(clean)
      .join(" "),
  );
}

function rawJsonContainsExactValue(value: unknown, target: string): boolean {
  const cleanTarget = clean(target);
  if (!cleanTarget) return false;

  if (value === null || typeof value === "undefined") return false;

  if (typeof value === "string" || typeof value === "number") {
    return clean(value) === cleanTarget;
  }

  if (Array.isArray(value)) {
    return value.some((item) => rawJsonContainsExactValue(item, cleanTarget));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((nested) =>
      rawJsonContainsExactValue(nested, cleanTarget),
    );
  }

  return false;
}

function rawJsonContainsNormalisedValue(value: unknown, target: string): boolean {
  const cleanTarget = normaliseKey(target);
  if (!cleanTarget) return false;

  if (value === null || typeof value === "undefined") return false;

  if (typeof value === "string" || typeof value === "number") {
    return normaliseKey(value) === cleanTarget;
  }

  if (Array.isArray(value)) {
    return value.some((item) =>
      rawJsonContainsNormalisedValue(item, cleanTarget),
    );
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((nested) =>
      rawJsonContainsNormalisedValue(nested, cleanTarget),
    );
  }

  return false;
}

function formatReferrerAddress(referrer: ReportReferrer | null) {
  if (!referrer) return "";

  const practiceName = clean(referrer.practice_name);
  const address = clean(referrer.address);

  if (!practiceName) return address;
  if (!address) return practiceName;

  const firstLine = address.split(/\n+/)[0]?.trim().toLowerCase();

  if (firstLine === practiceName.toLowerCase()) return address;

  return [practiceName, address].filter(Boolean).join("\n");
}

const REFERRER_SELECT =
  "id, name, address, praktika_referrer_id, practice_name, phone, email, is_active, raw_json, praktika_referrer_key";

async function addReferrerCandidates(
  map: Map<string, ReportReferrer>,
  data: ReportReferrer[] | null,
) {
  for (const referrer of data || []) {
    if (!referrer.id) continue;
    map.set(referrer.id, referrer);
  }
}

async function findReportReferrerForReferral(referral: PraktikaReferral) {
  const provider = referral.party?.provider;
  const providerName = formatProviderName(referral);
  const providerNameNoTitle = providerName.replace(/^Dr\.?\s+/i, "").trim();

  const providerNumber = clean(provider?.providerNumber);
  const providerId = clean(provider?.id);
  const referralProviderId = clean(referral.providerId);
  const partyId = clean(referral.party?.id);
  const clinicId = clean(referral.party?.clinicId);

  const firstName = clean(provider?.firstName);
  const lastName = clean(provider?.lastName);

  const candidateMap = new Map<string, ReportReferrer>();

  async function safeLookup(queryBuilder: any) {
    const { data, error } = await queryBuilder;
    if (!error) await addReferrerCandidates(candidateMap, data as ReportReferrer[] | null);
  }

  const possibleExactIds = [
    partyId,
    providerId,
    referralProviderId,
    clinicId,
    providerNumber,
  ].filter(Boolean);

  if (possibleExactIds.length > 0) {
    await safeLookup(
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .in("praktika_referrer_id", possibleExactIds)
        .limit(50),
    );

    await safeLookup(
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .in("praktika_referrer_key", possibleExactIds)
        .limit(50),
    );
  }

  if (providerNumber) {
    await safeLookup(
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("praktika_referrer_key", `%${providerNumber}%`)
        .limit(50),
    );
  }

  if (providerNameNoTitle) {
    await safeLookup(
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("name", `%${providerNameNoTitle}%`)
        .limit(50),
    );
  }

  if (lastName) {
    await safeLookup(
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("name", `%${lastName}%`)
        .limit(80),
    );
  }

  if (firstName) {
    await safeLookup(
      supabase
        .from("report_referrers")
        .select(REFERRER_SELECT)
        .eq("is_active", true)
        .ilike("name", `%${firstName}%`)
        .limit(80),
    );
  }

  const targetName = normaliseName(providerName);
  const targetNameNoTitle = normaliseName(providerNameNoTitle);

  const scored = Array.from(candidateMap.values())
    .map((referrer) => {
      const referrerName = normaliseName(referrer.name);
      const rawJson = referrer.raw_json || {};
      const praktikaReferrerId = clean(referrer.praktika_referrer_id);
      const praktikaReferrerKey = clean(referrer.praktika_referrer_key);

      let score = 0;

      if (partyId && praktikaReferrerId === partyId) score += 300;
      if (providerId && praktikaReferrerId === providerId) score += 260;
      if (referralProviderId && praktikaReferrerId === referralProviderId) score += 230;
      if (clinicId && praktikaReferrerId === clinicId) score += 180;
      if (providerNumber && praktikaReferrerId === providerNumber) score += 300;

      for (const value of [partyId, providerId, referralProviderId, clinicId, providerNumber]) {
        if (!value) continue;
        if (praktikaReferrerKey && praktikaReferrerKey.includes(value)) score += 160;
      }

      if (providerNumber && rawJsonContainsExactValue(rawJson, providerNumber)) score += 220;
      if (clinicId && rawJsonContainsExactValue(rawJson, clinicId)) score += 160;
      if (partyId && rawJsonContainsExactValue(rawJson, partyId)) score += 160;
      if (providerId && rawJsonContainsExactValue(rawJson, providerId)) score += 140;

      if (targetName && (referrerName === targetName || referrerName === targetNameNoTitle)) {
        score += 120;
      }

      if (targetNameNoTitle && referrerName.includes(targetNameNoTitle)) score += 80;
      if (targetNameNoTitle && targetNameNoTitle.includes(referrerName)) score += 50;
      if (firstName && referrerName.includes(firstName.toLowerCase())) score += 20;
      if (lastName && referrerName.includes(lastName.toLowerCase())) score += 35;

      if (providerNameNoTitle && rawJsonContainsNormalisedValue(rawJson, providerNameNoTitle)) {
        score += 70;
      }

      if (clean(referrer.practice_name)) score += 25;
      if (clean(referrer.address)) score += 35;

      if (isOwnPracticeReferrer(referrer)) score -= 1000;
      if (!clean(referrer.practice_name) && !clean(referrer.address)) score -= 40;

      return { referrer, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.referrer || null;
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
    const key = clean(note.id) || JSON.stringify(note).slice(0, 300);
    if (!unique.has(key)) unique.set(key, note);
  }

  return Array.from(unique.values());
}

function getClinicalNoteText(note: ClinicalNote) {
  const direct =
    clean(note.text) ||
    clean(note.notes) ||
    clean(note.note) ||
    clean(note.body) ||
    clean(note.content) ||
    clean(note.value);

  if (direct) return direct;

  const possibleTextKeys = [
    "vchText",
    "vchNote",
    "vchNotes",
    "clinicalNote",
    "clinical_notes",
    "clinicalNotes",
    "noteText",
    "note_text",
    "description",
  ];

  for (const key of possibleTextKeys) {
    const value = clean(note[key]);
    if (value) return value;
  }

  return "";
}

function noteMatchesDate(note: ClinicalNote, appointmentDate: string) {
  const targetDate = isoDateOnly(appointmentDate);
  if (!targetDate) return false;

  const possibleDates = [
    note.date,
    note.dateCreated,
    note.createdDate,
    note.created,
  ]
    .map(isoDateOnly)
    .filter(Boolean);

  if (possibleDates.includes(targetDate)) return true;

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

function noteMatchesAppointment(note: ClinicalNote, appointmentId: string) {
  if (!appointmentId) return false;

  return (
    clean(note.appointmentid) === appointmentId ||
    clean(note.appointmentId) === appointmentId ||
    clean(note.appointment_id) === appointmentId ||
    clean(note.iAppointmentId) === appointmentId
  );
}

function looksLikeAppointmentOnlyText(value: unknown) {
  const text = clean(value).toLowerCase();
  if (!text) return true;

  const hasAppointmentMarker =
    text.includes("appointment notes:") ||
    text.includes("treatment type:") ||
    text.includes("treatment label:") ||
    text.includes("has surgeon approved suitability") ||
    text.includes("949 code added") ||
    text.includes("fasting 6 hours prior");

  const hasClinicalMarker =
    /\b(la:|lignocaine|irrigated|closed|suture|ha,|poig|extraction completed|flap|socket|curett|debrid|implant|graft|probe|bpe|bleeding|calculus|plaque|periodontal|reviewed|consented|anaesthetic|sutured)\b/i.test(
      text,
    );

  return hasAppointmentMarker && !hasClinicalMarker;
}

function cleanClinicalNoteText(value: unknown) {
  const text = clean(value);
  if (!text || looksLikeAppointmentOnlyText(text)) return "";
  return text;
}

async function hydrateReportLetterQueueItem(context: BrowserContext, job: any) {
  const request = asObject(job.request);
  const queueId = clean(request.queueId);
  const patientId = clean(request.patientId);
  const practiceId = clean(request.practiceId) || "1181";
  const appointmentId = clean(request.appointmentId);
  const appointmentDate = clean(request.appointmentDate);

  if (!queueId) throw new Error("Hydration job is missing queueId.");
  if (!patientId) throw new Error("Hydration job is missing patientId.");

  const { data: existing, error: existingError } = await supabase
    .from("report_letter_queue")
    .select("*")
    .eq("id", queueId)
    .single();

  if (existingError || !existing) {
    throw new Error(existingError?.message || "Queue item not found for hydration.");
  }

  const rawJson = asObject(existing.raw_json);

  let latestReferralPayload: Record<string, unknown> | null =
    asObject(rawJson.latest_referral || rawJson.latestReferral);

  if (!clean(existing.referrer_name) || !clean(existing.referrer_address) || !Object.keys(latestReferralPayload).length) {
    const referralParsed = await runPraktikaRequest(context, {
      method: "POST",
      path: "/php/forms/db_getFormData.php",
      contentType: "json",
      referer: "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
      body: [
        {
          parameters: [
            {
              practice_id: Number(practiceId),
              patient_id: Number(patientId),
            },
          ],
          fields: [
            "patient_id",
            "patient_title",
            "patient_firstname",
            "patient_lastname",
            "patient_fullname",
            "patient_preferredname",
            "patient_shortname",
            "patient_gender",
            "patient_dob",
            "patient_birthdate",
            "patient_preferredproviderid",
            "patient_referrals",
          ],
        },
      ],
    });

    const referrals = extractPatientReferrals(referralParsed);
    const latestReferral = referrals
      .filter((referral) => formatProviderName(referral))
      .sort((a, b) => getReferralSortDate(b) - getReferralSortDate(a))[0];

    if (latestReferral) {
      const provider = latestReferral.party?.provider;
      const matchedReferrer = await findReportReferrerForReferral(latestReferral);
      const referrerAddress = matchedReferrer ? formatReferrerAddress(matchedReferrer) : "";

      latestReferralPayload = {
        referralId: latestReferral.id || "",
        referralDate: latestReferral.date || "",
        createdDate: latestReferral.createdDate || "",
        referrerName: formatProviderName(latestReferral),
        referrerAddress,
        providerId: provider?.id || null,
        providerNumber: provider?.providerNumber || "",
        clinicId: latestReferral.party?.clinicId || null,
        partyId: latestReferral.party?.id || null,
        referralProviderId: latestReferral.providerId || null,
        reason: latestReferral.reason || "",
      };
    }
  }

  let clinicalNotesText = cleanClinicalNoteText(rawJson.cached_clinical_notes);

  if (!clinicalNotesText) {
    const notesParsed = await runPraktikaRequest(context, {
      method: "POST",
      path: "/php/forms/db_getFormData.php",
      contentType: "json",
      referer: "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
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

    const notes = extractClinicalNotes(notesParsed).filter((note) => !note.deleted);

    const matchingNotes = notes.filter((note) => {
      return (
        noteMatchesAppointment(note, appointmentId) ||
        noteMatchesDate(note, appointmentDate)
      );
    });

    clinicalNotesText = matchingNotes
      .map((note) => getClinicalNoteText(note))
      .filter(Boolean)
      .filter((noteText) => !looksLikeAppointmentOnlyText(noteText))
      .join("\n\n---\n\n")
      .trim();
  }

  const nextRawJson = {
    ...rawJson,
    hydrated_by_helper_at: nowIso(),
    ...(latestReferralPayload && Object.keys(latestReferralPayload).length
      ? {
          latest_referral: latestReferralPayload,
          referral_autofill_at: nowIso(),
        }
      : {}),
    ...(clinicalNotesText
      ? {
          cached_clinical_notes: clinicalNotesText,
          cached_clinical_notes_source: "praktika_helper_precache",
          cached_clinical_notes_at: nowIso(),
        }
      : {}),
  };

  const updatePayload: Record<string, unknown> = {
    raw_json: nextRawJson,
    updated_at: nowIso(),
  };

  if (latestReferralPayload && Object.keys(latestReferralPayload).length) {
    const referralName = clean(latestReferralPayload.referrerName);
    const referralAddress = clean(latestReferralPayload.referrerAddress);

    if (referralName) updatePayload.referrer_name = referralName;
    if (referralAddress) updatePayload.referrer_address = referralAddress;
  }

  if (clinicalNotesText) {
    updatePayload.source_clinical_notes = clinicalNotesText;
  }

  const { data: updated, error: updateError } = await supabase
    .from("report_letter_queue")
    .update(updatePayload)
    .eq("id", queueId)
    .select("id, referrer_name, referrer_address, source_clinical_notes, raw_json")
    .single();

  if (updateError) throw new Error(updateError.message);

  return {
    success: true,
    queueId,
    patientId,
    referrerFilled: Boolean(clean(updated?.referrer_name)),
    referrerAddressFilled: Boolean(clean(updated?.referrer_address)),
    clinicalNotesFilled: Boolean(clean(updated?.source_clinical_notes)),
  };
}

export async function processOnePraktikaHelperJob(
  context: BrowserContext,
  appUserId?: string | null,
) {
  const job = await claimNextJob(appUserId || null);

  if (!job) return false;

  console.log(
    `Processing Praktika helper job ${job.id}: ${job.job_type}${
      job.app_user_id ? ` for app user ${job.app_user_id}` : ""
    }`,
  );

  try {
    const response =
      job.job_type === "hydrate_report_letter_queue_item"
        ? await hydrateReportLetterQueueItem(context, job)
        : await runPraktikaRequest(context, job.request);

    await completeJob(job.id, response);
    await markSessionConnectedForJob(job);
    console.log(`Completed Praktika helper job ${job.id}`);
  } catch (error: any) {
    const message = error?.message || "Praktika helper job failed.";
    console.error(`Failed Praktika helper job ${job.id}:`, message);

    if (
      message.toLowerCase().includes("logged out") ||
      message.toLowerCase().includes("expired session") ||
      message.toLowerCase().includes("session is logged out")
    ) {
      await markSessionNeedsReconnectForJob(
        job,
        "Praktika helper session expired. Please reconnect Praktika.",
      );
    }

    await failJob(job, message);
  }

  return true;
}
