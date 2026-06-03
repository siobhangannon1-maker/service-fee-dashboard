import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { praktikaHelperPostForCurrentUser } from "@/lib/praktika/helper-job-client";

const DEFAULT_PRACTICE_ID = Number(process.env.PRAKTIKA_PRACTICE_ID || 1181);

function toIsoDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const au = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (au) return `${au[3]}-${au[2].padStart(2, "0")}-${au[1].padStart(2, "0")}`;
  return raw;
}

async function praktikaJsonPost(payload: any) {
  return await praktikaHelperPostForCurrentUser<any>({
    jobType: "ai_create_praktika_referral",
    priority: 20,
    path: "/php/forms/db_updateFormData.php",
    contentType: "json",
    referer: "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    timeoutMs: 90_000,
    body: payload,
  });
}

function buildReferralNotes(item: any, notes?: string | null) {
  return [
    notes ? String(notes).trim() : null,
    item.summary ? `Summary: ${item.summary}` : null,
    item.extracted_referral_reason
      ? `Reason for referral: ${item.extracted_referral_reason}`
      : null,
    item.correspondence_author_name
      ? `Referrer: ${[item.correspondence_author_title, item.correspondence_author_name]
          .filter(Boolean)
          .join(" ")}`
      : null,
    item.extracted_referrer_provider_number
      ? `Provider number: ${item.extracted_referrer_provider_number}`
      : null,
    item.extracted_referrer_practice
      ? `Practice: ${item.extracted_referrer_practice}`
      : null,
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

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  if (!item.praktika_patient_id) {
    throw new Error(
      "Create or confirm a Praktika patient before creating a referral.",
    );
  }

  const resolvedPartyId = partyId || item.praktika_referrer_party_id;

  if (!resolvedPartyId) {
    throw new Error("No safe referrer partyId selected.");
  }

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
        reason:
          reason ||
          item.extracted_referral_reason ||
          item.summary ||
          "Referral received",
        history: "",
        notes: buildReferralNotes(item, notes),
        documents: [],
        partyId: Number(resolvedPartyId),
      },
    ],
  };

  const referralResult = await praktikaJsonPost(payload);
  const referralId =
    String(referralResult?.patient_referrals?.[0]?.id || "").trim() || null;
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
