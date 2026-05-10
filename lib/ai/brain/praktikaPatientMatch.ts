import OpenAI from "openai";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { searchPraktikaPatients } from "@/lib/praktika/patientSearch";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ExtractedPatient = {
  firstName: string | null;
  lastName: string | null;
  dob: string | null;
  mobile: string | null;
  email: string | null;
  confidence: number;
  reason: string;
};

function getInboxText(item: any) {
  const attachmentText = [item.extracted_text, item.raw_text]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const emailText = [
    item.email_subject,
    item.subject,
    item.sender_name,
    item.sender_email,
    item.email_body,
    item.body,
    item.summary,
    item.suggested_action,
    item.workflow_classification_reason,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (attachmentText.length >= 40) {
    return [attachmentText, emailText]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 12000);
  }

  return emailText.slice(0, 12000);
}


async function extractPatient(item: any): Promise<ExtractedPatient> {
  const text = getInboxText(item);

  if (!text.trim()) {
    return {
      firstName: null,
      lastName: null,
      dob: null,
      mobile: null,
      email: null,
      confidence: 0,
      reason: "No source text available.",
    };
  }

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_PATIENT_MATCH_MODEL || "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Extract the main patient identity from dental referral/correspondence text.

Return JSON only:
{
  "firstName": string or null,
  "lastName": string or null,
  "dob": string or null,
  "mobile": string or null,
  "email": string or null,
  "confidence": number,
  "reason": string
}

Rules:
- Do not invent details.
- DOB should be YYYY-MM-DD if possible.
- Choose the patient, not the referring doctor.
- If multiple patients appear, choose the main patient.
`,
      },
      { role: "user", content: text },
    ],
  });

  const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");

  return {
    firstName: parsed.firstName || null,
    lastName: parsed.lastName || null,
    dob: parsed.dob || null,
    mobile: parsed.mobile || null,
    email: parsed.email || null,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(parsed.confidence, 1))
        : 0,
    reason: parsed.reason || "Extracted patient identity.",
  };
}

export async function matchPraktikaPatientForInboxItem({
  inboxItemId,
}: {
  inboxItemId: string;
}) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const extracted = await extractPatient(item);

  if (!extracted.lastName && !extracted.firstName && !extracted.mobile) {
    const result = {
      status: "insufficient_information",
      confidence: 0,
      reason: "Could not extract enough patient details for Praktika search.",
      extracted,
      matches: [],
      bestMatch: null,
    };

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        extracted_patient_first_name: extracted.firstName,
        extracted_patient_last_name: extracted.lastName,
        extracted_patient_dob: extracted.dob,
        extracted_patient_mobile: extracted.mobile,
        extracted_patient_email: extracted.email,
        praktika_match_status: result.status,
        praktika_match_confidence: result.confidence,
        praktika_match_reason: result.reason,
        praktika_matched_at: new Date().toISOString(),
      })
      .eq("id", inboxItemId);

    return result;
  }

  const matches = await searchPraktikaPatients({
    firstName: extracted.firstName || undefined,
    lastName: extracted.lastName || undefined,
    dob: extracted.dob || undefined,
    mobile: extracted.mobile || undefined,
  });

  const bestMatch = matches[0] || null;

  let status = "no_match";
let confidence = matches.length > 0 ? 0.3 : 0.1;
let reason =
  matches.length > 0
    ? "Praktika returned possible patients, but none scored high enough for a confident match."
    : "No matching Praktika patient found.";

  if (bestMatch && bestMatch.matchScore >= 0.8) {
    status = "matched_existing";
    confidence = bestMatch.matchScore;
    reason = `Matched Praktika patient ${bestMatch.id}: ${bestMatch.matchReason}.`;
  } else if (bestMatch && bestMatch.matchScore >= 0.4) {
    status = "possible_match";
    confidence = bestMatch.matchScore;
    reason = `Possible Praktika match ${bestMatch.id}: ${bestMatch.matchReason}. Staff review recommended.`;
  }

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      extracted_patient_first_name: extracted.firstName,
      extracted_patient_last_name: extracted.lastName,
      extracted_patient_dob: extracted.dob,
      extracted_patient_mobile: extracted.mobile,
      extracted_patient_email: extracted.email,
      praktika_patient_id: bestMatch ? String(bestMatch.id) : null,
      praktika_patient_number: bestMatch?.patientNumber
        ? String(bestMatch.patientNumber)
        : null,
      praktika_match_status: status,
      praktika_match_confidence: confidence,
      praktika_match_reason: reason,
      praktika_matched_at: new Date().toISOString(),
    })
    .eq("id", inboxItemId);

  return {
    status,
    confidence,
    reason,
    extracted,
    bestMatch,
    matches,
  };
}