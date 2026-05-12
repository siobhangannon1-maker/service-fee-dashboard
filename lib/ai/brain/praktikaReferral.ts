import { supabaseAdmin } from "@/lib/supabase/admin";

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const PRAKTIKA_UPDATE_FORM_URL = `${PRAKTIKA_BASE_URL}/php/forms/db_updateFormData.php`;
const DEFAULT_PRACTICE_ID = Number(process.env.PRAKTIKA_PRACTICE_ID || 1181);

function getPraktikaCookie() {
  const cookie =
    process.env.PRAKTIKA_COOKIE ||
    process.env.PRAKTIKA_SESSION_COOKIE ||
    process.env.PRAKTIKA_AUTH_COOKIE ||
    "";
  if (!cookie.trim()) throw new Error("Missing Praktika session cookie.");
  return cookie;
}

function toIsoDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const au = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (au) return `${au[3]}-${au[2].padStart(2, "0")}-${au[1].padStart(2, "0")}`;
  return raw;
}

async function praktikaJsonPost(payload: any) {
  const response = await fetch(PRAKTIKA_UPDATE_FORM_URL, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: PRAKTIKA_BASE_URL,
      Referer: `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`,
      Cookie: getPraktikaCookie(),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Praktika returned non-JSON response: ${text.slice(0, 300)}`);
  }
  if (!response.ok) throw new Error(json?.error || json?.message || "Praktika referral creation failed.");
  return json;
}

function buildReferralNotes(item: any, notes?: string | null) {
  return [
    notes ? String(notes).trim() : null,
    item.summary ? `Summary: ${item.summary}` : null,
    item.extracted_referral_reason ? `Reason for referral: ${item.extracted_referral_reason}` : null,
    item.correspondence_author_name
      ? `Referrer: ${[item.correspondence_author_title, item.correspondence_author_name].filter(Boolean).join(" ")}`
      : null,
    item.extracted_referrer_provider_number
      ? `Provider number: ${item.extracted_referrer_provider_number}`
      : null,
    item.extracted_referrer_practice ? `Practice: ${item.extracted_referrer_practice}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function createPraktikaReferralFromInboxItem({
  inboxItemId,
  partyId,
  referralDate,
  reason,
  notes,
}: {
  inboxItemId: string;
  partyId?: string | number | null;
  referralDate?: string | null;
  reason?: string | null;
  notes?: string | null;
}) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) throw new Error(error?.message || "Inbox item not found.");
  if (!item.praktika_patient_id) throw new Error("Create or confirm a Praktika patient before creating a referral.");

  const resolvedPartyId = partyId || item.praktika_referrer_party_id;
  if (!resolvedPartyId) throw new Error("No safe referrer partyId selected.");

  const payload = {
    practice_id: DEFAULT_PRACTICE_ID,
    patient_id: Number(item.praktika_patient_id),
    patient_referrals: [
      {
        id: 0,
        typeId: 1,
        reference: null,
        date: toIsoDate(referralDate),
        isCompleted: false,
        isSuccessful: false,
        categoryId: 0,
        methodId: null,
        statusId: 0,
        reason: reason || item.extracted_referral_reason || item.summary || "Referral received",
        history: "",
        notes: buildReferralNotes(item, notes),
        documents: [],
        partyId: Number(resolvedPartyId),
      },
    ],
  };

  const referralResult = await praktikaJsonPost(payload);
  const referralId = String(referralResult?.patient_referrals?.[0]?.id || "").trim() || null;
  const now = new Date().toISOString();

  const { data: updatedItem, error: updateError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      praktika_referral_id: referralId,
      praktika_referral_created_at: referralId ? now : null,
      praktika_referral_result: referralResult,
    })
    .eq("id", inboxItemId)
    .select("*")
    .single();

  if (updateError) throw new Error(updateError.message);

  await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    event_type: "praktika_referral_created",
    event_label: "Praktika referral created",
    details: { partyId: resolvedPartyId, referralId, referralResult },
  });

  return { ok: true, referralId, referralResult, item: updatedItem };
}
