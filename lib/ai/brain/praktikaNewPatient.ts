import { supabaseAdmin } from "@/lib/supabase/admin";
import { autoFileInboxItemToPraktika } from "@/lib/ai/brain/praktikaAutoFile";
import { getPraktikaCookie } from "@/lib/praktika/hybrid-session-store";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const PRAKTIKA_UPDATE_FORM_URL = `${PRAKTIKA_BASE_URL}/php/forms/db_updateFormData.php`;
const DEFAULT_PRACTICE_ID = Number(process.env.PRAKTIKA_PRACTICE_ID || 1181);
const DEFAULT_CUSTOMER_ID = String(process.env.PRAKTIKA_CUSTOMER_ID || 480);
const DEFAULT_USER_ID = String(process.env.PRAKTIKA_USER_ID || 12393);
const DEFAULT_FEE_SCHEDULE_ID = Number(
  process.env.PRAKTIKA_DEFAULT_FEE_SCHEDULE_ID || 8769,
);
const PRACTICE_MODE = { scope: "practice" as const };

type NewPatientInput = {
  inboxItemId: string;
  firstName: string;
  lastName: string;
  dob: string;
  mobile: string;
  email?: string | null;
  partyId?: string | number | null;
  referralDate?: string | null;
  referralReason?: string | null;
  referralNotes?: string | null;
  createReferral?: boolean;
  fileAttachments?: boolean;
};

type Actor = {
  userId?: string | null;
  email?: string | null;
  fullName?: string | null;
  initials?: string | null;
};

function getInitials(name?: string | null, email?: string | null) {
  const cleanName = String(name || "").trim();

  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  const cleanEmail = String(email || "").trim();
  if (cleanEmail) return cleanEmail.slice(0, 2).toUpperCase();

  return "AI";
}

function normaliseMobile(value: string) {
  return String(value || "")
    .replace(/[^0-9+]/g, "")
    .replace(/^\+61/, "0")
    .trim();
}

function parseIsoDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const au = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (au) {
    return `${au[1].padStart(2, "0")}/${au[2].padStart(2, "0")}/${au[3]}`;
  }

  return raw;
}

function toIsoDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const au = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (au) return `${au[3]}-${au[2].padStart(2, "0")}-${au[1].padStart(2, "0")}`;

  return raw;
}

function todayAuDate() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
}

function validateNewPatientInput(input: NewPatientInput) {
  const missing: string[] = [];

  if (!input.inboxItemId) missing.push("inboxItemId");
  if (!input.firstName?.trim()) missing.push("first name");
  if (!input.lastName?.trim()) missing.push("last name");
  if (!input.dob?.trim()) missing.push("DOB");
  if (!input.mobile?.trim()) missing.push("mobile");

  if (missing.length > 0) {
    throw new Error(`Missing required field(s): ${missing.join(", ")}.`);
  }
}

async function writeAuditEvent({
  inboxItemId,
  eventType,
  eventLabel,
  actor,
  details,
}: {
  inboxItemId: string;
  eventType: string;
  eventLabel: string;
  actor?: Actor;
  details?: Record<string, any>;
}) {
  const { error } = await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    event_type: eventType,
    event_label: eventLabel,
    actor_user_id: actor?.userId || null,
    actor_email: actor?.email || null,
    actor_full_name: actor?.fullName || null,
    actor_initials: actor?.initials || getInitials(actor?.fullName, actor?.email),
    details: details || {},
    metadata: details || {},
  });

  if (error) {
    console.error("New patient audit insert failed:", error);
  }
}

async function praktikaJsonPost(url: string, payload: any) {
  return withPraktikaAutoRefresh(async () => {
    const cookie = await getPraktikaCookie(PRACTICE_MODE);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json; charset=UTF-8",
        Origin: PRAKTIKA_BASE_URL,
        Referer: `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`,
        Cookie: cookie,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await response.text();
    const lower = text.trim().toLowerCase();

    if (
      lower.startsWith("<!doctype") ||
      lower.startsWith("<html") ||
      lower.includes("/v2/login") ||
      lower.includes("type=\"password\"") ||
      lower.includes("logged-out") ||
      lower.includes("logged out")
    ) {
      throw new Error("Praktika session expired or returned a login page.");
    }

    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Praktika returned non-JSON response: ${text.slice(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(json?.error || json?.message || `Praktika request failed (${response.status}).`);
    }

    return json;
  },
  {
    mode: PRACTICE_MODE,
  });
}

function buildCreatePatientPayload(input: NewPatientInput) {
  return {
    customer_id: DEFAULT_CUSTOMER_ID,
    practice_id: String(DEFAULT_PRACTICE_ID),
    patient_id: "0",
    session_id: "",
    user_id: DEFAULT_USER_ID,
    user_practices: [
      { iCustomerId: DEFAULT_CUSTOMER_ID, iPracticeId: "0", iStatusId: "1" },
      {
        iCustomerId: DEFAULT_CUSTOMER_ID,
        iPracticeId: String(DEFAULT_PRACTICE_ID),
        iStatusId: "1",
      },
    ],
    user_status: "1",
    user_type: "1",
    patient_dob: parseIsoDate(input.dob),
    patient_title: "",
    patient_number: 0,
    patient_lastname: input.lastName.trim(),
    patient_statusid: "1",
    patient_firstname: input.firstName.trim(),
    patient_nonrecall: false,
    patient_datejoined: todayAuDate(),
    patient_phone_home: "",
    patient_phone_work: "",
    patient_photofileid: 0,
    patient_phone_mobile: normaliseMobile(input.mobile),
    patient_email_personal: input.email || "",
    patient_phone_emergency: "",
    patient_practice_sharing: [
      {
        id: String(DEFAULT_PRACTICE_ID),
        label: "Focus Dental Specialists",
        home: true,
        shared: true,
        position: 1,
      },
    ],
    patient_signature_fileid: 0,
    patient_defaultfeescheduleid: DEFAULT_FEE_SCHEDULE_ID,
    patient_preferredcontact_sms: true,
    patient_lockpreferredprovider: false,
    patient_preferredcontact_post: true,
    patient_preferredcontact_email: true,
    patient_preferredcontact_phone: true,
    question: {},
  };
}

function buildReferralPayload({
  patientId,
  input,
}: {
  patientId: string;
  input: NewPatientInput;
}) {
  return {
    practice_id: DEFAULT_PRACTICE_ID,
    patient_id: Number(patientId),
    patient_referrals: [
      {
        id: 0,
        typeId: 1,
        reference: null,
        date: toIsoDate(input.referralDate),
        isCompleted: false,
        isSuccessful: false,
        categoryId: 0,
        methodId: null,
        statusId: 0,
        reason: input.referralReason || "",
        history: "",
        notes: input.referralNotes || "",
        documents: [],
        partyId: Number(input.partyId),
      },
    ],
  };
}

export async function createPraktikaPatientFromInboxItem({
  input,
  actor,
}: {
  input: NewPatientInput;
  actor?: Actor;
}) {
  validateNewPatientInput(input);

  const { data: item, error: itemError } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", input.inboxItemId)
    .single();

  if (itemError || !item) {
    throw new Error(itemError?.message || "Inbox item not found.");
  }

  const startedAt = new Date().toISOString();

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      praktika_new_patient_creation_status: "running",
      praktika_new_patient_creation_error: null,
    })
    .eq("id", input.inboxItemId);

  await writeAuditEvent({
    inboxItemId: input.inboxItemId,
    eventType: "praktika_new_patient_creation_started",
    eventLabel: "New Praktika patient creation started",
    actor,
    details: {
      firstName: input.firstName,
      lastName: input.lastName,
      dob: input.dob,
      mobile: input.mobile,
      started_at: startedAt,
    },
  });

  try {
    const patientPayload = buildCreatePatientPayload(input);
    const patientResult = await praktikaJsonPost(PRAKTIKA_UPDATE_FORM_URL, patientPayload);

    const patientId = String(patientResult?.patient_id || "").trim();

    if (!patientId) {
      throw new Error("Praktika did not return a patient_id.");
    }

    let referralResult: any = null;
    let referralId: string | null = null;

    if (input.partyId) {
      const referralPayload = buildReferralPayload({
        patientId,
        input,
      });

      referralResult = await praktikaJsonPost(
        PRAKTIKA_UPDATE_FORM_URL,
        referralPayload,
      );

      referralId =
        String(referralResult?.patient_referrals?.[0]?.id || "").trim() || null;
    } else {
      referralResult = {
        skipped: true,
        reason:
          "No referrer partyId supplied, so referral creation was skipped.",
      };
    }

    const now = new Date().toISOString();

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        praktika_patient_id: patientId,
        praktika_match_status: "created_new_patient",
        praktika_match_confidence: 1,
        praktika_match_reason:
          "New Praktika patient created from assisted workflow.",
        praktika_matched_at: now,
        praktika_new_patient_creation_status: "completed",
        praktika_new_patient_created_at: now,
        praktika_new_patient_creation_error: null,
        praktika_new_patient_creation_result: patientResult,
        praktika_referral_id: referralId,
        praktika_referral_created_at: referralId ? now : null,
        praktika_referral_result: referralResult || {},
      })
      .eq("id", input.inboxItemId)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    let filingResult: any = null;

    if (input.fileAttachments !== false) {
      filingResult = await autoFileInboxItemToPraktika({
        inboxItemId: input.inboxItemId,
        force: false,
      });
    }

    await writeAuditEvent({
      inboxItemId: input.inboxItemId,
      eventType: "praktika_new_patient_created",
      eventLabel: "New Praktika patient created",
      actor,
      details: {
        patientId,
        referralId,
        patientResult,
        referralResult,
        filingResult,
      },
    });

    return {
      ok: true,
      patientId,
      referralId,
      patientResult,
      referralResult,
      filingResult,
      item: updatedItem,
    };
  } catch (error: any) {
    const message = error?.message || "New Praktika patient creation failed.";

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        praktika_new_patient_creation_status: "failed",
        praktika_new_patient_creation_error: message,
      })
      .eq("id", input.inboxItemId);

    await writeAuditEvent({
      inboxItemId: input.inboxItemId,
      eventType: "praktika_new_patient_creation_failed",
      eventLabel: "New Praktika patient creation failed",
      actor,
      details: { error: message },
    });

    throw error;
  }
}
