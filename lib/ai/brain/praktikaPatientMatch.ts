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

type PraktikaPatientMatch = Awaited<ReturnType<typeof searchPraktikaPatients>>[number];

function clean(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseDobToIso(value: string | null | undefined) {
  const raw = clean(value);

  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const au = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);

  if (au) {
    const day = au[1].padStart(2, "0");
    const month = au[2].padStart(2, "0");

    let year = au[3];

    if (year.length === 2) {
      const numericYear = Number(year);
      year = numericYear <= 29 ? `20${year}` : `19${year}`;
    }

    return `${year}-${month}-${day}`;
  }

  return raw;
}

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

function splitPatientName(value: string | null | undefined) {
  const parts = clean(value)
    .replace(/^(master|miss|mrs|ms|mr|dr)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      firstName: null,
      lastName: null,
    };
  }

  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts[parts.length - 1] : null,
  };
}

function serialiseMatch(match: PraktikaPatientMatch) {
  return {
    id: match.id,
    patientNumber: match.patientNumber,
    firstName: match.firstName,
    lastName: match.lastName,
    dob: match.dob,
    mobile: match.mobile,
    email: (match as any).email || null,
    matchScore: match.matchScore,
    matchReason: match.matchReason,
  };
}

async function extractPatientWithOpenAI(item: any): Promise<ExtractedPatient> {
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
Extract the MAIN PATIENT identity from dental referrals and specialist correspondence.

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

CRITICAL PATIENT IDENTIFICATION RULES:
- Do not invent details.
- DOB should be YYYY-MM-DD if possible.
- Choose the patient, not the referring doctor, sender, specialist, or addressee.

Priority order:
1. A patient named in a "RE:", "Re:", "Patient:", or "Name:" line.
2. A name directly beside DOB / D.O.B. / date of birth.
3. An explicitly labelled patient.
4. Only use referral sentence wording as a fallback.

Important:
- If a full name appears in the RE line or beside DOB, that is the patient.
- Do NOT override a full RE-line patient name with a later phrase such as "I am referring [word/name]".
- Later referral sentence subjects can be shorthand, dictation artefacts, or clinical wording.

Example:
Text: "RE: Fake Fake DOB: 03/03/2003 Phone: 0411111111 I am referring Test for extraction..."
Correct patient:
{
  "firstName": "Fake",
  "lastName": "Fake",
  "dob": "2003-03-03",
  "mobile": "0411111111"
}
Wrong patient:
{
  "firstName": "Test"
}
`,
      },
      { role: "user", content: text },
    ],
  });

  const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");

  return {
    firstName: parsed.firstName || null,
    lastName: parsed.lastName || null,
    dob: normaliseDobToIso(parsed.dob) || null,
    mobile: parsed.mobile || null,
    email: parsed.email || null,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(parsed.confidence, 1))
        : 0,
    reason: parsed.reason || "Extracted patient identity.",
  };
}

async function extractPatient(item: any): Promise<ExtractedPatient> {
  const nameParts = splitPatientName(item.patient_name);

  const deterministic: ExtractedPatient = {
    firstName: item.extracted_patient_first_name || nameParts.firstName || null,
    lastName: item.extracted_patient_last_name || nameParts.lastName || null,
    dob:
      normaliseDobToIso(item.extracted_patient_dob) ||
      normaliseDobToIso(item.patient_dob) ||
      null,
    mobile: item.extracted_patient_mobile || null,
    email: item.extracted_patient_email || null,
    confidence: 0.95,
    reason: "Used deterministic patient fields already extracted by the pipeline.",
  };

  if (
    deterministic.firstName &&
    deterministic.lastName &&
    (deterministic.dob || deterministic.mobile)
  ) {
    return deterministic;
  }

  const ai = await extractPatientWithOpenAI(item);

  return {
    firstName: deterministic.firstName || ai.firstName,
    lastName: deterministic.lastName || ai.lastName,
    dob: deterministic.dob || normaliseDobToIso(ai.dob),
    mobile: deterministic.mobile || ai.mobile,
    email: deterministic.email || ai.email,
    confidence: Math.max(deterministic.confidence, ai.confidence),
    reason: `${deterministic.reason} OpenAI fallback: ${ai.reason}`,
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
        praktika_patient_id: null,
        praktika_patient_number: null,
        praktika_match_status: result.status,
        praktika_match_confidence: result.confidence,
        praktika_match_reason: result.reason,
        praktika_match_candidates: [],
        praktika_matched_at: new Date().toISOString(),
      })
      .eq("id", inboxItemId);

    return result;
  }

  const searchAttempts: Array<{
    label: string;
    input: {
      firstName?: string;
      lastName?: string;
      dob?: string;
      mobile?: string;
    };
  }> = [
    {
      label: "name_dob_mobile",
      input: {
        firstName: extracted.firstName || undefined,
        lastName: extracted.lastName || undefined,
        dob: extracted.dob || undefined,
        mobile: extracted.mobile || undefined,
      },
    },
    {
      label: "name_dob",
      input: {
        firstName: extracted.firstName || undefined,
        lastName: extracted.lastName || undefined,
        dob: extracted.dob || undefined,
      },
    },
    {
      label: "name_mobile",
      input: {
        firstName: extracted.firstName || undefined,
        lastName: extracted.lastName || undefined,
        mobile: extracted.mobile || undefined,
      },
    },
    {
      label: "name_only",
      input: {
        firstName: extracted.firstName || undefined,
        lastName: extracted.lastName || undefined,
      },
    },
  ];

  let matches: Awaited<ReturnType<typeof searchPraktikaPatients>> = [];
  let successfulAttempt = "none";
  const attemptDebug: any[] = [];

  for (const attempt of searchAttempts) {
    if (
      !attempt.input.firstName &&
      !attempt.input.lastName &&
      !attempt.input.dob &&
      !attempt.input.mobile
    ) {
      continue;
    }

    try {
      let attemptMatches: Awaited<ReturnType<typeof searchPraktikaPatients>> = [];

      try {
        // searchPraktikaPatients now uses the current user's helper-job session.
        // Do NOT wrap this in practice-mode auto refresh, or it will spawn the old practice helper.
        attemptMatches = await searchPraktikaPatients(attempt.input);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Praktika search failed.";

        await supabaseAdmin.from("ai_workbench_audit_events").insert({
          inbox_item_id: inboxItemId,
          event_type: "praktika_search_failed_non_blocking",
          event_label: "Praktika search failed but import continued",
          details: {
            label: attempt.label,
            input: attempt.input,
            error: message,
          },
        });

        continue;
      }

      attemptDebug.push({
        label: attempt.label,
        input: attempt.input,
        returned: attemptMatches.length,
        topScore: attemptMatches[0]?.matchScore ?? null,
        topReason: attemptMatches[0]?.matchReason ?? null,
      });

      if (attemptMatches.length > 0) {
        matches = attemptMatches;
        successfulAttempt = attempt.label;

        if (attemptMatches[0]?.matchScore >= 0.8) {
          break;
        }
      }
    } catch (searchError) {
      attemptDebug.push({
        label: attempt.label,
        input: attempt.input,
        error:
          searchError instanceof Error
            ? searchError.message
            : "Unknown Praktika search error",
      });
    }
  }

  const serialisedMatches = matches.map(serialiseMatch);
  const bestMatch = matches[0] || null;
  const confidentMatches = matches.filter(
    (match) => Number(match.matchScore || 0) >= 0.8,
  );

  let status = "no_match";
  let confidence = matches.length > 0 ? 0.3 : 0.1;
  let reason =
    matches.length > 0
      ? "Praktika returned possible patients, but none scored high enough for a confident match. Staff review recommended."
      : "No matching Praktika patient found.";

  if (bestMatch && confidentMatches.length === 1) {
    status = "matched_existing";
    confidence = bestMatch.matchScore;
    reason = `Matched Praktika patient ${bestMatch.id}: ${bestMatch.matchReason}.`;
  } else if (bestMatch && confidentMatches.length > 1) {
    status = "possible_match";
    confidence = bestMatch.matchScore;
    reason =
      "Multiple high-confidence Praktika matches were found. Staff must confirm the correct patient before filing.";
  } else if (bestMatch && bestMatch.matchScore >= 0.45) {
    status = "possible_match";
    confidence = bestMatch.matchScore;
    reason = `Possible Praktika match ${bestMatch.id}: ${bestMatch.matchReason}. Staff review recommended.`;
  }

  const autoSelectedPatient = status === "matched_existing" ? bestMatch : null;

  const debug = {
    extracted,
    successfulAttempt,
    attemptDebug,
    matchCount: matches.length,
    confidentMatchCount: confidentMatches.length,
    bestMatch: bestMatch ? serialiseMatch(bestMatch) : null,
  };

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      extracted_patient_first_name: extracted.firstName,
      extracted_patient_last_name: extracted.lastName,
      extracted_patient_dob: extracted.dob,
      extracted_patient_mobile: extracted.mobile,
      extracted_patient_email: extracted.email,
      praktika_patient_id: autoSelectedPatient ? String(autoSelectedPatient.id) : null,
      praktika_patient_number: autoSelectedPatient?.patientNumber
        ? String(autoSelectedPatient.patientNumber)
        : null,
      praktika_match_status: status,
      praktika_match_confidence: confidence,
      praktika_match_reason: reason,
      praktika_match_candidates: serialisedMatches,
      praktika_matched_at: new Date().toISOString(),
    })
    .eq("id", inboxItemId);

  await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    event_type: "praktika_patient_match",
    event_label: "Praktika patient matching completed",
    details: debug,
  });

  return {
    status,
    confidence,
    reason,
    extracted,
    bestMatch: autoSelectedPatient,
    matches: serialisedMatches,
    debug,
  };
}
