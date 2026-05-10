import OpenAI from "openai";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  extractCorrespondenceParties,
  formatCorrespondencePartiesForPrompt,
} from "@/lib/ai/brain/extractCorrespondenceParties";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function normalise(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseEmail(value: string | null | undefined) {
  return String(value || "").toLowerCase().trim();
}

function normaliseDobForMatching(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, "")
    .trim();
}

function nameParts(value: string | null | undefined) {
  return normalise(value)
    .split(" ")
    .filter((part) => part.length >= 2);
}

function cleanSourceText(value: string) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normaliseAustralianDate({
  day,
  month,
  year,
}: {
  day: string;
  month: string;
  year: string;
}) {
  const dd = day.padStart(2, "0");
  const mm = month.padStart(2, "0");

  let yyyy = year;

  if (yyyy.length === 2) {
    const numericYear = Number(yyyy);
    yyyy = numericYear <= 29 ? `20${yyyy}` : `19${yyyy}`;
  }

  return `${dd}/${mm}/${yyyy}`;
}

function formatIsoDobToAustralian(value: string | null | undefined) {
  const raw = String(value || "").trim();

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const australianMatch = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);

  if (australianMatch) {
    const dob = normaliseAustralianDate({
      day: australianMatch[1],
      month: australianMatch[2],
      year: australianMatch[3],
    });

    return isPlausibleDob(dob) ? dob : null;
  }

  return null;
}

function isPlausibleDob(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) return false;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const currentYear = new Date().getFullYear();

  if (day < 1 || day > 31) return false;
  if (month < 1 || month > 12) return false;
  if (year < 1900 || year > currentYear) return false;

  return true;
}

function extractDobFromText(sourceText: string) {
  const text = cleanSourceText(sourceText);

  /*
    DOB extraction must be conservative.

    We intentionally prioritise labelled/contextual patient DOB patterns and
    avoid using the first loose date in a letter, because that is often the
    referral/document date.

    Example problem this fixes:
    "27/04/2026 Dr Jenny Wang ... RE: Master Joshua Lee 18/10/10"
    Correct DOB = 18/10/2010, not 27/04/2026.
  */

  const labelledPatterns = [
    /\b(?:d\.?\s*o\.?\s*b\.?|dob|date\s*of\s*birth|birth\s*date)\s*[:\-]?\s*(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/i,
    /\b(?:patient\s*d\.?\s*o\.?\s*b\.?|patient\s*dob)\s*[:\-]?\s*(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/i,
  ];

  for (const pattern of labelledPatterns) {
    const match = text.match(pattern);

    if (match) {
      const dob = normaliseAustralianDate({
        day: match[1],
        month: match[2],
        year: match[3],
      });

      if (isPlausibleDob(dob)) return dob;
    }
  }

  const contextualPatterns = [
    // RE: Master Joshua Lee 18/10/10
    /\bRE\s*:\s*(?:Master|Mr|Mrs|Ms|Miss|Mx)?\s*[A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+\s+(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/i,

    // Name: Karoly Szabo D.O.B: 30/03/1957
    /\bName\s*:\s*(?:Master|Mr|Mrs|Ms|Miss|Mx)?\s*[A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+\s+(?:D\.?O\.?B\.?|DOB|Date\s*of\s*Birth)?\s*[:\-]?\s*(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/i,

    // Patient: Joshua Lee 18/10/10
    /\bPatient\s*:?\s*(?:Master|Mr|Mrs|Ms|Miss|Mx)?\s*[A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+\s+(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/i,

    // Master Joshua Lee 18/10/10
    /\b(?:Master|Mr|Mrs|Ms|Miss|Mx)\s+[A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+\s+(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/i,
  ];

  for (const pattern of contextualPatterns) {
    const match = text.match(pattern);

    if (match) {
      const dob = normaliseAustralianDate({
        day: match[1],
        month: match[2],
        year: match[3],
      });

      if (isPlausibleDob(dob)) return dob;
    }
  }

  /*
    Do NOT use arbitrary loose dates as DOBs.
    Referral letters often contain document dates, consultation dates,
    x-ray dates and image dates. Using loose dates caused the AI to save
    the document date as patient DOB.
  */

  return null;
}

function extractEmailFromText(sourceText: string) {
  const match = sourceText.match(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  );

  return match?.[0]?.toLowerCase() || null;
}

function extractPhoneFromText(sourceText: string) {
  const match = sourceText.match(
    /\b(?:\+?61\s?)?(?:0\s?)?4[\d\s]{8,12}\b|\b0[2378]\s?\d{4}\s?\d{4}\b/
  );

  return match?.[0]?.replace(/\s+/g, " ").trim() || null;
}

function getBestSourceText(inboxItem: any) {
  return cleanSourceText(
    String(
      inboxItem.raw_text ||
        inboxItem.body ||
        inboxItem.extracted_text ||
        inboxItem.email_body ||
        ""
    )
  );
}


type ClassificationHintResult = {
  hints: string[];
  preferredCategory: string | null;
  preferredOperationalIntent: string | null;
  confidence: number;
  reasons: string[];
};

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function getDeterministicClassificationHints({
  sourceText,
  inboxItem,
}: {
  sourceText: string;
  inboxItem: any;
}): ClassificationHintResult {
  const text = normalise(`${sourceText}\n${inboxItem?.subject || ""}\n${inboxItem?.email_subject || ""}`);

  const hints: string[] = [];
  const reasons: string[] = [];

  const existingPatientSignals = [
    "mutual patient",
    "our mutual patient",
    "your patient",
    "existing patient",
    "ongoing care",
    "ongoing treatment",
    "previous treatment",
    "previous appointment",
    "review appointment",
    "follow up",
    "followup",
    "follow-up",
    "post operative review",
    "post-operative review",
    "post op review",
    "post-op review",
    "treating clinician",
    "treating specialist",
    "patient record",
    "patient file",
    "letter for",
    "correspondence regarding",
    "regarding our patient",
    "regarding your patient",
  ];

  const explicitNewReferralSignals = [
    "new referral",
    "referral for",
    "refer this patient",
    "referring this patient",
    "would like to refer",
    "please see this patient",
    "please assess",
    "for assessment",
    "for consultation",
    "for your opinion",
    "for management",
    "for treatment",
    "please accept this referral",
  ];

  const weakReferralSignals = [
    "referral",
    "referred",
    "referrer",
  ];

  const existingMatches = existingPatientSignals.filter((signal) =>
    text.includes(signal),
  );

  const explicitReferralMatches = explicitNewReferralSignals.filter((signal) =>
    text.includes(signal),
  );

  const weakReferralMatches = weakReferralSignals.filter((signal) =>
    text.includes(signal),
  );

  if (existingMatches.length > 0) {
    hints.push(
      "Existing patient correspondence signals detected: " +
        existingMatches.join(", "),
    );
    reasons.push(
      "The correspondence references an existing/mutual patient or ongoing care.",
    );
  }

  if (explicitReferralMatches.length > 0) {
    hints.push(
      "Explicit new referral signals detected: " +
        explicitReferralMatches.join(", "),
    );
    reasons.push("The correspondence contains explicit referral wording.");
  }

  if (weakReferralMatches.length > 0 && explicitReferralMatches.length === 0) {
    hints.push(
      "Weak referral language detected without explicit new referral wording: " +
        weakReferralMatches.join(", "),
    );
  }

  /*
    Important operational rule:
    If the text says "mutual patient", "your patient", "letter for",
    or similar existing-patient language, prefer existing_patient_correspondence
    unless there is explicit new referral wording.
  */
  if (existingMatches.length > 0 && explicitReferralMatches.length === 0) {
    return {
      hints,
      preferredCategory: "existing_patient_correspondence",
      preferredOperationalIntent: "general_correspondence",
      confidence: 0.9,
      reasons,
    };
  }

  if (
    existingMatches.length > 0 &&
    explicitReferralMatches.length > 0 &&
    !includesAny(text, ["new referral", "please accept this referral"])
  ) {
    return {
      hints,
      preferredCategory: "existing_patient_correspondence",
      preferredOperationalIntent: "general_correspondence",
      confidence: 0.75,
      reasons: [
        ...reasons,
        "Both existing-patient and referral language appeared; existing-patient correspondence is preferred unless a clearly new referral is stated.",
      ],
    };
  }

  if (explicitReferralMatches.length > 0) {
    return {
      hints,
      preferredCategory: "new_referral",
      preferredOperationalIntent: "new_referral",
      confidence: 0.8,
      reasons,
    };
  }

  return {
    hints,
    preferredCategory: null,
    preferredOperationalIntent: null,
    confidence: 0,
    reasons,
  };
}

function applyDeterministicClassificationOverride({
  decision,
  classificationHints,
}: {
  decision: any;
  classificationHints: ClassificationHintResult;
}) {
  if (!classificationHints.preferredCategory) {
    return {
      decision,
      overrideApplied: false,
      overrideReason: null as string | null,
    };
  }

  const aiCategory = String(decision?.category || "").trim();

  if (
    classificationHints.preferredCategory === "existing_patient_correspondence" &&
    aiCategory === "new_referral"
  ) {
    return {
      decision: {
        ...decision,
        category: "existing_patient_correspondence",
        operational_intent:
          classificationHints.preferredOperationalIntent ||
          "general_correspondence",
        explanation: [
          decision?.explanation || "",
          "Deterministic classification override applied: existing-patient correspondence signals were detected, so this was not treated as a new referral.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      overrideApplied: true,
      overrideReason:
        "Existing-patient correspondence signals overrode AI new_referral classification.",
    };
  }

  return {
    decision,
    overrideApplied: false,
    overrideReason: null as string | null,
  };
}

function formatClassificationHintsForPrompt(hints: ClassificationHintResult) {
  if (!hints.hints.length && !hints.preferredCategory) {
    return "No deterministic classification hints detected.";
  }

  return `
Preferred category: ${hints.preferredCategory || "none"}
Preferred operational intent: ${hints.preferredOperationalIntent || "none"}
Confidence: ${hints.confidence}

Hints:
${hints.hints.map((hint) => `- ${hint}`).join("\n") || "- none"}

Reasons:
${hints.reasons.map((reason) => `- ${reason}`).join("\n") || "- none"}
`.trim();
}

function formatClassificationRulesForPrompt(rules: any[] | null | undefined) {
  if (!rules || rules.length === 0) {
    return "No active classification learning rules found.";
  }

  return rules
    .map((rule, index) =>
      `
Classification rule ${index + 1}
Title: ${rule.title || "Untitled rule"}
Priority: ${rule.priority ?? 100}
Instruction:
${rule.rule || ""}
`.trim(),
    )
    .join("\n\n---\n\n");
}

function removeMissingDobIfFound(
  missingInformation: string[] | null | undefined,
  extractedDob: string | null
) {
  const list = Array.isArray(missingInformation) ? missingInformation : [];

  if (!extractedDob) return list;

  return list.filter((item) => {
    const normalised = normalise(item);
    return (
      !normalised.includes("dob") &&
      !normalised.includes("date of birth") &&
      !normalised.includes("birth date")
    );
  });
}

function isOnlyDobMissing(missingInformation: string[] | null | undefined) {
  const list = Array.isArray(missingInformation) ? missingInformation : [];

  if (list.length === 0) return false;

  return list.every((item) => {
    const normalised = normalise(item);
    return (
      normalised.includes("dob") ||
      normalised.includes("date of birth") ||
      normalised.includes("birth date")
    );
  });
}

function getSafeGreetingName(value: string | null | undefined) {
  const name = String(value || "").trim();

  if (!name) return null;
  if (name.length > 50) return null;
  if (/@/.test(name)) return null;
  if (/\d/.test(name)) return null;

  const lower = name.toLowerCase();

  const genericSignals = [
    "admin",
    "accounts",
    "appointments",
    "booking",
    "bookings",
    "clinic",
    "coorparoo",
    "dental",
    "family dental",
    "front desk",
    "hello",
    "info",
    "practice",
    "reception",
    "reception team",
    "referral",
    "referrals",
    "referrals team",
    "specialists",
    "support",
    "team",
  ];

  if (genericSignals.some((signal) => lower.includes(signal))) {
    return null;
  }

  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length === 0 || parts.length > 4) return null;

  const firstName = parts[0].replace(/[^a-zA-Z'\-]/g, "");

  if (!firstName || firstName.length < 2) return null;

  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

function replaceGreetingWithCorrespondenceSender({
  body,
  senderName,
}: {
  body: string;
  senderName?: string | null;
}) {
  const safeFirstName = getSafeGreetingName(senderName);
  const greeting = safeFirstName ? `Hi ${safeFirstName},` : "Dear team,";

  const lines = String(body || "").split("\n");

  if (lines.length === 0) return `${greeting}\n\n${body}`;

  if (/^(hi|hello|dear)\s+/i.test(lines[0].trim())) {
    lines[0] = greeting;
    return lines.join("\n");
  }

  return `${greeting}\n\n${body}`;
}


function formatFocusClinicianName(value: string | null | undefined) {
  const raw = String(value || "").trim();

  if (!raw) return null;

  if (/^dr\b/i.test(raw)) return raw.replace(/^dr\b/i, "Dr");

  return `Dr ${raw}`;
}

function getInternalFocusClinicianForReply(item: any) {
  return (
    formatFocusClinicianName(item?.assigned_clinician_name) ||
    formatFocusClinicianName(item?.assigned_clinician) ||
    null
  );
}

function replacePassOnClinicianWithInternalClinician({
  body,
  internalClinicianName,
}: {
  body: string;
  internalClinicianName?: string | null;
}) {
  const clinician = formatFocusClinicianName(internalClinicianName);

  if (!clinician) return body;

  let result = String(body || "");

  /*
    Replace incorrect external addressee wording such as:
    "passed on to Dr Bao Nguyen for review"
    "passed on to Dr Nguyen for review"
    "forwarded to Dr Bao Nguyen"
  */
  const passOnPattern =
    /\b(passed\s+on\s+to|passed\s+onto|forwarded\s+to|sent\s+to)\s+Dr\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}(\s+for\s+review)?/gi;

  if (passOnPattern.test(result)) {
    result = result.replace(passOnPattern, (_match, action, suffix) => {
      return `${action} ${clinician}${suffix || ""}`;
    });
  }

  /*
    If the AI did not include a pass-on sentence but this is correspondence for
    an internal Focus clinician, add a simple safe sentence after the first paragraph.
  */
  if (!new RegExp(`\\b${clinician.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(result)) {
    const paragraphs = result.split(/\n\s*\n/);

    if (paragraphs.length >= 2) {
      paragraphs.splice(
        1,
        0,
        `We will ensure this is passed on to ${clinician} for review.`,
      );
      result = paragraphs.join("\n\n");
    } else {
      result = `${result.trim()}\n\nWe will ensure this is passed on to ${clinician} for review.`;
    }
  }

  return result;
}

function calculatePatientMatchScore({
  patient,
  targetName,
  targetDob,
  targetEmail,
}: {
  patient: any;
  targetName: string | null;
  targetDob: string | null;
  targetEmail: string | null;
}) {
  let score = 0;
  const matchedFields: string[] = [];
  const reasons: string[] = [];

  const patientEmail = normaliseEmail(patient.email);
  const email = normaliseEmail(targetEmail);

  if (email && patientEmail && email === patientEmail) {
    score += 0.55;
    matchedFields.push("email");
    reasons.push("Email address matched exactly.");
  }

  const patientDob = normaliseDobForMatching(patient.date_of_birth);
  const dob = normaliseDobForMatching(targetDob);

  if (dob && patientDob && dob === patientDob) {
    score += 0.35;
    matchedFields.push("date_of_birth");
    reasons.push("Date of birth matched.");
  }

  const patientName = normalise(patient.full_name);
  const target = normalise(targetName);

  if (target && patientName) {
    if (patientName === target) {
      score += 0.45;
      matchedFields.push("full_name");
      reasons.push("Full name matched exactly.");
    } else {
      const targetParts = nameParts(target);
      const patientParts = nameParts(patientName);
      const overlap = targetParts.filter((part) =>
        patientParts.includes(part)
      );

      if (overlap.length >= 2) {
        score += 0.35;
        matchedFields.push("name_parts");
        reasons.push("First and last name appear to match.");
      } else if (overlap.length === 1) {
        score += 0.15;
        matchedFields.push("partial_name");
        reasons.push("Partial name match.");
      }
    }
  }

  return {
    confidence: Math.min(score, 0.99),
    matchedFields,
    matchReason:
      reasons.length > 0
        ? reasons.join(" ")
        : "Possible match based on available correspondence details.",
  };
}

export async function runAIBrainAnalysis({
  inboxItemId,
  source = "manual_reanalyse",
}: {
  inboxItemId: string;
  source?: string;
}) {
  const { data: inboxItem, error: inboxError } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (inboxError || !inboxItem) {
    return {
      skipped: true,
      reason: inboxError?.message || "inbox_item_not_found",
    };
  }

  const sourceText = getBestSourceText(inboxItem);

  if (!sourceText) {
    return {
      skipped: true,
      reason: "no_source_text",
    };
  }

  const deterministicDob =
    formatIsoDobToAustralian(inboxItem.extracted_patient_dob) ||
    extractDobFromText(sourceText) ||
    formatIsoDobToAustralian(inboxItem.patient_dob) ||
    inboxItem.patient_dob ||
    null;

  const deterministicEmail =
    extractEmailFromText(sourceText) || inboxItem.sender_email || null;

  const deterministicPhone = extractPhoneFromText(sourceText);

  const classificationHints = getDeterministicClassificationHints({
    sourceText,
    inboxItem,
  });

  const { data: classificationRules } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("*")
    .eq("is_active", true)
    .or("category.eq.classification,category.eq.all,category.is.null")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(20);

  const classificationRulesText =
    formatClassificationRulesForPrompt(classificationRules);

  const classificationHintsText =
    formatClassificationHintsForPrompt(classificationHints);

  const prompt = `
You are the AI Reception Brain for a specialist dental practice:
- oral and maxillofacial surgery
- periodontics
- implant dentistry
- referral-based specialist care

Analyse the incoming correspondence and return ONLY valid JSON.

ALLOWED CATEGORIES:
You MUST choose exactly one category from this list:
- new_referral
- existing_patient_correspondence
- appointment_request
- billing
- post_op_concern
- clinical_question
- records_request
- radiology_review
- pathology_review
- complaint
- admin
- unknown

HARD CLASSIFICATION RULES:
- Do NOT classify correspondence as new_referral just because it contains an attached letter or clinical information.
- If the correspondence says "mutual patient", "our mutual patient", "your patient", "existing patient", "ongoing care", "follow-up", "review", "previous treatment", "letter for", or similar wording, classify it as existing_patient_correspondence unless it clearly states this is a new referral.
- When uncertain between new_referral and existing_patient_correspondence, prefer existing_patient_correspondence.
- Only classify as new_referral when the sender is clearly introducing or referring a patient for first assessment/treatment, or explicitly states this is a new referral.
- Use post_op_concern only when the correspondence is about post-operative symptoms, concerns or complications.
- Use radiology_review or pathology_review for reports/results being received for review, not for new patient referrals unless explicit referral wording is present.

Deterministic classification hints:
${classificationHintsText}

Active classification learning rules:
${classificationRulesText}

Use this exact structure:

{
  "title": "short human-readable case title",
  "category": "new_referral | existing_patient_correspondence | appointment_request | billing | post_op_concern | clinical_question | records_request | radiology_review | pathology_review | complaint | admin | unknown",
  "operational_intent": "new_referral | urgent_post_op_issue | implant_consult | perio_consult | missing_information | appointment_request | billing_query | records_request | radiology_received | clinical_review_required | general_correspondence | unknown",
  "confidence": 0.0,
  "patient_name": "string or null",
  "patient_dob": "DD/MM/YYYY string or null",
  "risk_level": "low | medium | high",
  "requires_clinical_review": false,
  "safe_to_auto_draft": true,
  "risks": ["risk 1", "risk 2"],
  "missing_information": ["missing item 1"],
  "recommended_next_step": "what reception should do next",
  "summary": "short receptionist-friendly summary of the correspondence",
  "suggested_action": "short practical action for reception",
  "explanation": "brief explanation of why you made this decision"
}

Known deterministic extracted identifiers:
- Extracted DOB: ${deterministicDob || "none found"}
- Extracted email: ${deterministicEmail || "none found"}
- Extracted phone: ${deterministicPhone || "none found"}

HARD DOB RULES:
- If Extracted DOB is not "none found", patient_dob MUST equal Extracted DOB.
- If Extracted DOB is not "none found", missing_information MUST NOT include DOB, date of birth, or birth date.
- If Extracted DOB is not "none found", do NOT recommend contacting the sender for DOB.
- If Extracted DOB is not "none found" and no other information is missing, safe_to_auto_draft may be true.
- Treat DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY and DD/MM/YY as Australian DOB formats.
- Ignore impossible dates such as 17/18/65.

Clinical safety rules:
- Do not give medical advice.
- Do not diagnose.
- Do not recommend treatment.
- Do not invent fees, appointment times, clinical opinions or availability.
- Be conservative.
- Human review is always required.
- If patient identity is uncertain, risk_level must be medium or high.
- If DOB is genuinely missing, include "patient DOB" in missing_information.
- If swelling, bleeding, severe pain, trauma, infection, paraesthesia, fever, breathing difficulty, swallowing difficulty, medication reaction, anticoagulant concern, bisphosphonate concern or post-operative complication is mentioned, requires_clinical_review must be true.
- If clinical advice is being requested, requires_clinical_review must be true.
`;

  const userContent = `
Subject: ${inboxItem.subject || inboxItem.email_subject || ""}
Sender name: ${inboxItem.sender_name || ""}
Sender email: ${inboxItem.sender_email || ""}
Existing category: ${inboxItem.category || ""}
Deterministic preferred category: ${classificationHints.preferredCategory || "none"}
Deterministic preferred operational intent: ${classificationHints.preferredOperationalIntent || "none"}
Known patient name: ${inboxItem.patient_name || ""}
Known patient DOB: ${inboxItem.patient_dob || ""}
File name: ${inboxItem.file_name || ""}

Correspondence text:
${sourceText}
`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_BRAIN_MODEL || "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userContent },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return {
      skipped: true,
      reason: "empty_ai_response",
    };
  }

  const parsedDecision = JSON.parse(raw);

  const {
    decision,
    overrideApplied: classificationOverrideApplied,
    overrideReason: classificationOverrideReason,
  } = applyDeterministicClassificationOverride({
    decision: parsedDecision,
    classificationHints,
  });

  const finalCategory = decision.category || inboxItem.category || "unknown";
  const finalPatientName =
    decision.patient_name || inboxItem.patient_name || null;

  const finalPatientDob =
    formatIsoDobToAustralian(inboxItem.extracted_patient_dob) ||
    deterministicDob ||
    formatIsoDobToAustralian(decision.patient_dob) ||
    formatIsoDobToAustralian(inboxItem.patient_dob) ||
    decision.patient_dob ||
    inboxItem.patient_dob ||
    null;

  const finalMissingInformation = removeMissingDobIfFound(
    decision.missing_information,
    finalPatientDob
  );

  const finalDecision = {
    ...decision,
    patient_dob: finalPatientDob,
    missing_information: finalMissingInformation,
    safe_to_auto_draft:
      finalPatientDob && isOnlyDobMissing(decision.missing_information)
        ? true
        : decision.safe_to_auto_draft,
    recommended_next_step:
      finalPatientDob &&
      String(decision.recommended_next_step || "")
        .toLowerCase()
        .includes("date of birth")
        ? "Review the referral and prepare the patient intake workflow."
        : decision.recommended_next_step,
    suggested_action:
      finalPatientDob &&
      String(decision.suggested_action || "")
        .toLowerCase()
        .includes("date of birth")
        ? "Review the referral and prepare the patient intake workflow."
        : decision.suggested_action,
  };

  const finalSummary =
    finalDecision.summary ||
    inboxItem.summary ||
    finalDecision.explanation ||
    "AI Brain analysis completed.";

  const finalSuggestedAction =
    finalDecision.suggested_action ||
    finalDecision.recommended_next_step ||
    inboxItem.suggested_action ||
    "Review this correspondence.";

  const { data: existingCase } = await supabaseAdmin
    .from("ai_cases")
    .select("id")
    .eq("inbox_item_id", inboxItemId)
    .maybeSingle();

  let aiCase: any = null;

  if (existingCase) {
    const { data: updatedCase, error: updateCaseError } = await supabaseAdmin
      .from("ai_cases")
      .update({
        title: finalDecision.title,
        patient_name: finalPatientName,
        patient_dob: finalPatientDob,
        category: finalCategory,
        confidence: finalDecision.confidence,
        risk_level: finalDecision.risk_level,
        recommended_next_step: finalDecision.recommended_next_step,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingCase.id)
      .select()
      .single();

    if (updateCaseError) throw new Error(updateCaseError.message);
    aiCase = updatedCase;
  } else {
    const { data: newCase, error: insertCaseError } = await supabaseAdmin
      .from("ai_cases")
      .insert({
        inbox_item_id: inboxItemId,
        status: "open",
        title: finalDecision.title,
        patient_name: finalPatientName,
        patient_dob: finalPatientDob,
        category: finalCategory,
        confidence: finalDecision.confidence,
        risk_level: finalDecision.risk_level,
        recommended_next_step: finalDecision.recommended_next_step,
      })
      .select()
      .single();

    if (insertCaseError) throw new Error(insertCaseError.message);
    aiCase = newCase;
  }

  const { error: decisionError } = await supabaseAdmin
    .from("ai_decisions")
    .insert({
      case_id: aiCase.id,
      decision_type:
        source === "ocr_completed"
          ? "post_ocr_reanalysis"
          : "manual_reanalysis",
      decision: finalDecision,
      confidence: finalDecision.confidence,
      risks: finalDecision.risks ?? [],
      explanation: finalDecision.explanation,
    });

  if (decisionError) throw new Error(decisionError.message);

  const { error: updateItemError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      status: "classified",
      category: finalCategory,
      patient_name: finalPatientName,
      patient_dob: finalPatientDob,
      summary: finalSummary,
      suggested_action: finalSuggestedAction,
    })
    .eq("id", inboxItemId);

  if (updateItemError) throw new Error(updateItemError.message);

  await supabaseAdmin.from("ai_case_events").insert({
    case_id: aiCase.id,
    event_type:
      source === "ocr_completed" ? "ai_reanalysed_after_ocr" : "ai_reanalysed",
    event_summary:
      source === "ocr_completed"
        ? "AI Brain analysis was rerun automatically after OCR text was extracted."
        : "AI Brain analysis was rerun manually from the Workbench.",
    metadata: {
      ...finalDecision,
      source_text_length: sourceText.length,
      reanalysis_source: source,
      deterministic_dob: deterministicDob,
      deterministic_email: deterministicEmail,
      deterministic_phone: deterministicPhone,
      classification_hints: classificationHints,
      classification_override_applied: classificationOverrideApplied,
      classification_override_reason: classificationOverrideReason,
      classification_rules_loaded:
        classificationRules?.map((rule) => ({
          id: rule.id,
          title: rule.title,
          priority: rule.priority,
        })) || [],
    },
  });

  return {
    skipped: false,
    case: aiCase,
    decision: finalDecision,
    sourceTextLength: sourceText.length,
    deterministicDob,
    deterministicEmail,
    deterministicPhone,
    classificationHints,
    classificationOverrideApplied,
    classificationOverrideReason,
  };
}

export async function autoMatchPatient({
  inboxItemId,
}: {
  inboxItemId: string;
}) {
  const { data: item } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (!item) {
    return {
      matched: false,
      reason: "inbox_item_not_found",
    };
  }

  const sourceText = getBestSourceText(item);

  const targetName = item.patient_name || null;
  const targetDob =
    formatIsoDobToAustralian(item.extracted_patient_dob) ||
    formatIsoDobToAustralian(item.patient_dob) ||
    item.patient_dob ||
    extractDobFromText(sourceText) ||
    null;
  const targetEmail =
    extractEmailFromText(sourceText) || item.sender_email || null;

  if (!targetName && !targetDob && !targetEmail) {
    return {
      matched: false,
      reason: "no_patient_identifiers",
    };
  }

  const nameTokens = nameParts(targetName);
  const firstToken = nameTokens[0] || "";
  const lastToken = nameTokens[nameTokens.length - 1] || "";

  let query = supabaseAdmin.from("patients").select("*").limit(30);

  const email = normaliseEmail(targetEmail);

  if (email) {
    query = query.or(
      `email.ilike.${email},full_name.ilike.%${firstToken}%,last_name.ilike.%${lastToken}%`
    );
  } else if (firstToken || lastToken) {
    query = query.or(
      `full_name.ilike.%${firstToken}%,last_name.ilike.%${lastToken}%,first_name.ilike.%${firstToken}%`
    );
  }

  const { data: patients, error } = await query;

  if (error) {
    return {
      matched: false,
      error: error.message,
    };
  }

  const scored =
    patients
      ?.map((patient) => {
        const score = calculatePatientMatchScore({
          patient,
          targetName,
          targetDob,
          targetEmail,
        });

        return {
          patient,
          ...score,
        };
      })
      .filter((candidate) => candidate.confidence >= 0.35)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5) || [];

  await supabaseAdmin
    .from("ai_patient_match_candidates")
    .delete()
    .eq("inbox_item_id", inboxItemId)
    .eq("status", "suggested");

  if (scored.length === 0) {
    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        match_status: "no_match_found",
        patient_match_confidence: null,
      })
      .eq("id", inboxItemId);

    return {
      matched: false,
      reason: "no_suitable_match",
      targetName,
      targetDob,
      targetEmail,
    };
  }

  const best = scored[0];
  const autoConfirm = best.confidence >= 0.9;

  const candidateRows = scored.map((candidate) => ({
    inbox_item_id: inboxItemId,
    patient_id: candidate.patient.id,
    confidence: candidate.confidence,
    match_reason: candidate.matchReason,
    matched_fields: candidate.matchedFields,
    status:
      autoConfirm && candidate.patient.id === best.patient.id
        ? "confirmed"
        : "suggested",
  }));

  await supabaseAdmin.from("ai_patient_match_candidates").insert(candidateRows);

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      match_status: autoConfirm ? "auto_confirmed" : "suggested",
      match_confidence: best.confidence,
      patient_match_confidence: best.confidence,
      patient_match_confirmed_at: autoConfirm ? new Date().toISOString() : null,
    })
    .eq("id", inboxItemId);

  return {
    matched: true,
    auto_confirmed: autoConfirm,
    best_patient_id: best.patient.id,
    best_patient_name: best.patient.full_name,
    confidence: best.confidence,
    candidates_count: scored.length,
    targetName,
    targetDob,
    targetEmail,
  };
}

function getDecisionCategory({ item, decision }: { item: any; decision: any }) {
  return String(decision?.category || item?.category || "unknown").trim() || "unknown";
}

function getDraftTemplateCategories(category: string, decision: any) {
  const value = normalise(category);
  const intent = normalise(decision?.operational_intent);
  const documentType = normalise(decision?.document_type);

  if (
    value.includes("new referral") ||
    value.includes("referral") ||
    intent.includes("new referral") ||
    intent.includes("referral")
  ) {
    return ["referral_received", "new_referral", "all"];
  }

  if (
    value.includes("existing patient correspondence") ||
    intent.includes("general correspondence") ||
    intent.includes("records request")
  ) {
    return [
      "existing_patient_correspondence_received",
      "existing_patient_correspondence",
      "all",
    ];
  }

  if (value.includes("appointment") || intent.includes("appointment")) {
    return ["appointment_availability", "appointment_request", "all"];
  }

  if (value.includes("billing") || intent.includes("billing")) {
    return ["invoice_request", "billing", "all"];
  }

  if (value.includes("post op") || intent.includes("post op")) {
    return ["post_op_concern", "post_op", "all"];
  }

  if (
    value.includes("clinical question") ||
    intent.includes("clinical review") ||
    documentType.includes("clinical")
  ) {
    return ["procedure_question", "clinical_question", "all"];
  }

  return [category, "all"];
}

function determineDraftPolicy({
  item,
  decision,
}: {
  item: any;
  decision: any;
}) {
  const category = getDecisionCategory({ item, decision });
  const normalisedCategory = normalise(category);
  const normalisedIntent = normalise(decision?.operational_intent);
  const praktikaMatched =
    item?.praktika_match_status === "matched_existing" &&
    Boolean(item?.praktika_patient_id);

  const isReferral =
    normalisedCategory.includes("new referral") ||
    normalisedCategory.includes("referral") ||
    normalisedIntent.includes("new referral") ||
    normalisedIntent.includes("referral");

  const isExistingPatientCorrespondence =
    normalisedCategory.includes("existing patient correspondence") ||
    normalisedIntent.includes("general correspondence") ||
    normalisedIntent.includes("records request") ||
    praktikaMatched;

  if (isReferral) {
    return {
      shouldDraft: true,
      mandatory: true,
      purpose: "acknowledge_referral_received",
      templateCategories: ["referral_received", "new_referral", "all"],
      reason:
        "Practice policy: referrals should always receive a receipt acknowledgement draft.",
    };
  }

  if (isExistingPatientCorrespondence) {
    return {
      shouldDraft: true,
      mandatory: true,
      purpose: "acknowledge_existing_patient_correspondence",
      templateCategories: [
        "existing_patient_correspondence_received",
        "existing_patient_correspondence",
        "all",
      ],
      reason:
        "Practice policy: correspondence for an existing patient should receive a receipt acknowledgement draft.",
    };
  }

  if (decision?.requires_clinical_review) {
    return {
      shouldDraft: false,
      mandatory: false,
      purpose: "clinical_review_required_no_auto_draft",
      templateCategories: getDraftTemplateCategories(category, decision),
      reason:
        "Clinical review is required and this item is not covered by a mandatory acknowledgement policy.",
    };
  }

  if (decision?.safe_to_auto_draft === false) {
    return {
      shouldDraft: false,
      mandatory: false,
      purpose: "not_safe_to_auto_draft",
      templateCategories: getDraftTemplateCategories(category, decision),
      reason: "AI Brain marked this item as not safe to auto-draft.",
    };
  }

  return {
    shouldDraft: true,
    mandatory: false,
    purpose: "standard_reception_reply",
    templateCategories: getDraftTemplateCategories(category, decision),
    reason: "Standard safe reception draft generation.",
  };
}


function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function escapePostgrestValue(value: string) {
  return String(value).replace(/"/g, '\\"');
}

function buildCategoryOrFilter(categories: string[]) {
  const cleaned = uniqueStrings(categories);

  if (cleaned.length === 0) {
    return "category.eq.all,category.is.null";
  }

  const categoryFilter = cleaned
    .map((category) => `category.eq."${escapePostgrestValue(category)}"`)
    .join(",");

  return `${categoryFilter},category.is.null`;
}

function formatResponseTemplates(templates: any[]) {
  if (!templates || templates.length === 0) {
    return "No active response templates found for this category.";
  }

  return templates
    .map(
      (template, index) => `
Template ${index + 1}: ${template.title || "Untitled template"}
Category: ${template.category || "unknown"}
Subject template:
${template.subject_template || ""}

Body template:
${template.body_template || ""}

Tone notes:
${template.tone_notes || ""}

Avoid notes:
${template.avoid_notes || ""}
`.trim()
    )
    .join("\n\n---\n\n");
}


function getCorrespondencePartiesFromItem(item: any) {
  const saved = item?.correspondence_party_extraction || {};

  return {
    addressee: {
      name:
        item?.correspondence_addressee_name ||
        saved?.addressee?.name ||
        null,
      title:
        item?.correspondence_addressee_title ||
        saved?.addressee?.title ||
        null,
      source:
        item?.correspondence_addressee_source ||
        saved?.addressee?.source ||
        "not_found",
      confidence:
        item?.correspondence_addressee_confidence ??
        saved?.addressee?.confidence ??
        0,
    },
    sender: {
      name:
        item?.correspondence_sender_name ||
        saved?.sender?.name ||
        item?.sender_name ||
        null,
      email:
        item?.correspondence_sender_email ||
        saved?.sender?.email ||
        item?.sender_email ||
        null,
      source:
        item?.correspondence_sender_source ||
        saved?.sender?.source ||
        "email_sender_fallback",
      confidence:
        item?.correspondence_sender_confidence ??
        saved?.sender?.confidence ??
        (item?.sender_name ? 0.8 : 0),
    },
    author: {
      name:
        item?.correspondence_author_name ||
        saved?.author?.name ||
        null,
      title:
        item?.correspondence_author_title ||
        saved?.author?.title ||
        null,
      source:
        item?.correspondence_author_source ||
        saved?.author?.source ||
        "not_found",
      confidence:
        item?.correspondence_author_confidence ??
        saved?.author?.confidence ??
        0,
    },
    notes: Array.isArray(saved?.notes) ? saved.notes : [],
  };
}

export async function generateOrUpdateDraft({
  inboxItemId,
}: {
  inboxItemId: string;
}) {
  let { data: item } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (!item) {
    return {
      skipped: true,
      reason: "inbox_item_not_found",
    };
  }

  try {
    const partyResult = await extractCorrespondenceParties({ inboxItemId });
    if (partyResult?.item) {
      item = partyResult.item;
    }
  } catch (partyError) {
    console.warn(
      "Correspondence party extraction failed before draft generation:",
      partyError,
    );
  }

  const { data: aiCase } = await supabaseAdmin
    .from("ai_cases")
    .select(`
      *,
      ai_decisions (*)
    `)
    .eq("inbox_item_id", inboxItemId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestDecision =
    aiCase?.ai_decisions
      ?.slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      )[0] || null;

  const decision = latestDecision?.decision || {};
  const category = getDecisionCategory({ item, decision });
  const draftPolicy = determineDraftPolicy({ item, decision });

  if (!draftPolicy.shouldDraft) {
    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        email_status: "drafted",
      })
      .eq("id", inboxItemId);

    return {
      skipped: true,
      reason: draftPolicy.purpose,
      policy_reason: draftPolicy.reason,
    };
  }

  const missingInformation = Array.isArray(decision.missing_information)
    ? decision.missing_information.filter(Boolean)
    : [];

  const templateCategories = Array.from(
    new Set([...(draftPolicy.templateCategories || []), category, "all"])
  ).filter(Boolean);

  const categoryFilter = buildCategoryOrFilter(templateCategories);

  const { data: rules } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("*")
    .eq("is_active", true)
    .or(categoryFilter)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(30);

  const { data: examples } = await supabaseAdmin
    .from("ai_approved_examples")
    .select("*")
    .eq("is_active", true)
    .or(categoryFilter)
    .order("created_at", { ascending: false })
    .limit(8);

  const { data: templates } = await supabaseAdmin
    .from("ai_response_templates")
    .select("*")
    .eq("is_active", true)
    .in("category", templateCategories)
    .order("created_at", { ascending: false })
    .limit(8);

  const rulesText =
    rules && rules.length > 0
      ? rules
          .map((r, index) =>
            `
Rule ${index + 1}
Title: ${r.title || "Rule"}
Type: ${r.rule_type || "general"}
Priority: ${r.priority ?? 100}
Instruction:
${r.rule}
`.trim()
          )
          .join("\n\n---\n\n")
      : "No active learning rules found for this category.";

  const examplesText =
    examples && examples.length > 0
      ? examples
          .map(
            (e, index) => `
Example ${index + 1}: ${e.title || "Untitled example"}
Category: ${e.category || "all"}

Incoming example:
${e.incoming_message || ""}

Approved reply subject:
${e.approved_reply_subject || ""}

Approved reply body:
${e.approved_reply_body || ""}

Tone notes:
${e.tone_notes || ""}

Avoid notes:
${e.avoid_notes || ""}
`.trim()
          )
          .join("\n\n---\n\n")
      : "No active approved examples found for this category.";

  const templatesText = formatResponseTemplates(templates || []);

  const primaryTemplate =
    templates && templates.length > 0 ? templates[0] : null;

  const correspondenceParties = getCorrespondencePartiesFromItem(item);
  const correspondencePartiesText = formatCorrespondencePartiesForPrompt(correspondenceParties);

  const primaryTemplateText = primaryTemplate
    ? `
Primary template title:
${primaryTemplate.title || "Untitled template"}

Primary subject template:
${primaryTemplate.subject_template || ""}

Primary body template:
${primaryTemplate.body_template || ""}

Primary tone notes:
${primaryTemplate.tone_notes || ""}

Primary avoid notes:
${primaryTemplate.avoid_notes || ""}
`.trim()
    : "No primary response template selected.";

  const prompt = `
You are a receptionist at Focus Dental Specialists.

Draft a professional, warm, concise email reply for staff review.

Mandatory draft policy:
- Policy purpose: ${draftPolicy.purpose}
- Policy reason: ${draftPolicy.reason}
- Mandatory acknowledgement: ${draftPolicy.mandatory ? "yes" : "no"}

Structured correspondence party extraction:
${correspondencePartiesText}

Internal clinician routing rule:
- When saying who the correspondence will be passed on to, use Assigned internal Focus clinician for reply/routing if available.
- Do not use the attached letter addressee as the Focus clinician unless they are also the assigned internal Focus clinician.
- If the attached letter is addressed to an external dentist/clinic but cc'd to Focus, do not say Focus will pass it to the external addressee.
- If no internal Focus clinician is available, say "the relevant clinician" rather than naming the external addressee.

Greeting rule:
- If a real individual sender name is detected, greet them by first name.
- If only a clinic, practice, admin team, referrals team, reception team, generic mailbox, or organisation name is detected, use "Dear team,".
- Do not greet clinic names such as Coorparoo, Reception, Admin, Referrals, Dental, Practice, Clinic, Info or Team as if they are a person.

Important safety rules:
- Use Australian English.
- Do not give clinical advice.
- Do not diagnose.
- Do not interpret test results or imaging findings.
- Do not invent fees, appointment times, availability, treatment plans, acceptance of referral, or clinician opinions.
- Do not say a clinician has reviewed something unless explicitly confirmed in the data.
- If staff need to review something, say the team will review and respond.
- If clinical review is required, write only a neutral acknowledgement and do not address the clinical issue.
- If information is missing, acknowledge receipt and politely request the missing information.
- Do not say the email was written by AI.
- Do not include an email signature. Outlook will add the signature separately.
- Do not output unresolved placeholders like {{clinic_name}}, [Patient Name], or [Dr Name].

MANDATORY PRACTICE LEARNING RULES:
Follow safety rules first, then workflow rules, then reply logic, then tone and formatting rules.

${rulesText}

PRIMARY RESPONSE TEMPLATE:
Use this as the default structure when relevant. Apply safety rules and learning rules over the template if they conflict.\n\n${primaryTemplateText}\n\nApproved response templates:\n${templatesText}

Approved examples:
${examplesText}

AI Brain decision:
${JSON.stringify(decision, null, 2)}

Context:
Sender name: ${item.sender_name || "Unknown"}
Sender email: ${item.sender_email || "Unknown"}
Detected correspondence addressee: ${correspondenceParties.addressee.name || "Unknown"}
Detected correspondence sender: ${correspondenceParties.sender.name || item.sender_name || "Unknown"}
Detected correspondence author/signatory: ${correspondenceParties.author.name || "Unknown"}
Assigned internal Focus clinician for reply/routing: ${getInternalFocusClinicianForReply(item) || "Unknown"}
Email subject: ${item.email_subject || item.subject || item.file_name || "No subject"}
Category: ${category}
Patient name: ${item.patient_name || "Unknown"}
Patient DOB: ${item.patient_dob || "Unknown"}
Praktika match status: ${item.praktika_match_status || "unknown"}
Praktika patient ID: ${item.praktika_patient_id || "unknown"}
Summary: ${item.summary || ""}
Suggested action: ${item.suggested_action || ""}
Missing information: ${missingInformation.length ? missingInformation.join(", ") : "none"}

Correspondence:
${item.raw_text || item.body || item.email_body || item.extracted_text || ""}

Return JSON only:
{
  "subject": "",
  "body": "",
  "safety_notes": [],
  "used_template_titles": [],
  "used_learning_rule_titles": [],
  "used_example_titles": []
}
`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_DRAFT_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    response_format: {
      type: "json_object",
    },
    messages: [{ role: "user", content: prompt }],
  });

  const parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");

  const subject =
    parsed.subject ||
    `Re: ${item.email_subject || item.subject || "Correspondence"}`;

  const rawBody = String(parsed.body || "").trim();
  const bodyWithGreeting = replaceGreetingWithCorrespondenceSender({
    body: rawBody,
    senderName: correspondenceParties.sender.name,
  });

  const body = replacePassOnClinicianWithInternalClinician({
    body: bodyWithGreeting,
    internalClinicianName: getInternalFocusClinicianForReply(item),
  });

  if (!body) {
    return {
      skipped: true,
      reason: "empty_draft_body",
      policy_reason: draftPolicy.reason,
    };
  }

  const { data: existingDraft } = await supabaseAdmin
    .from("ai_email_drafts")
    .select("id")
    .eq("inbox_item_id", inboxItemId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let draft: any = null;

  const draftPayload = {
    inbox_item_id: inboxItemId,
    case_id: aiCase?.id || null,
    subject,
    body,
    status: "draft",
    guidance: {
      auto_generated: true,
      reanalysed: true,
      category,
      draft_policy: draftPolicy,
      missing_information: missingInformation,
      used_learning_rules:
        parsed.used_learning_rule_titles ||
        rules?.map((r) => `${r.title || "Untitled rule"} (${r.rule_type || "general"}, priority ${r.priority ?? 100})`) ||
        [],
      used_examples: parsed.used_example_titles || examples?.map((e) => e.title) || [],
      used_templates: parsed.used_template_titles || templates?.map((t) => t.title) || [],
      primary_template: primaryTemplate?.title || null,
      learning_rules_count: rules?.length || 0,
      approved_examples_count: examples?.length || 0,
      response_templates_count: templates?.length || 0,
      active_rule_ids: rules?.map((r) => r.id) || [],
      active_rule_types: Array.from(
        new Set(rules?.map((r) => r.rule_type || "general") || [])
      ),
      safety_notes: parsed.safety_notes || [],
      decision_summary: decision,
      correspondence_parties: correspondenceParties,
      internal_focus_clinician_for_reply: getInternalFocusClinicianForReply(item),
    },
  };

  if (existingDraft?.id) {
    const { data: updatedDraft } = await supabaseAdmin
      .from("ai_email_drafts")
      .update({
        subject: draftPayload.subject,
        body: draftPayload.body,
        status: draftPayload.status,
        guidance: draftPayload.guidance,
      })
      .eq("id", existingDraft.id)
      .select()
      .single();

    draft = updatedDraft;
  } else {
    const { data: newDraft } = await supabaseAdmin
      .from("ai_email_drafts")
      .insert(draftPayload)
      .select()
      .single();

    draft = newDraft;
  }

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      draft_reply_subject: subject,
      draft_reply_body: body,
      draft_status: "drafted",
      email_status: "ready_to_send",
    })
    .eq("id", inboxItemId);

  return {
    skipped: false,
    draft,
    draftPolicy,
  };
}

export async function reanalyseInboxItem({
  inboxItemId,
  source = "manual_reanalyse",
  regenerateDraft = true,
}: {
  inboxItemId: string;
  source?: string;
  regenerateDraft?: boolean;
}) {
  const analysisResult = await runAIBrainAnalysis({
    inboxItemId,
    source,
  });

  const patientMatchResult = await autoMatchPatient({
    inboxItemId,
  });

  const draftResult = regenerateDraft
    ? await generateOrUpdateDraft({
        inboxItemId,
      })
    : {
        skipped: true,
        reason: "regenerate_draft_false",
      };

  await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    actor_id: null,
    event_type:
      source === "ocr_completed"
        ? "workbench_reanalysed_after_ocr"
        : "workbench_reanalysed",
    event_summary:
      source === "ocr_completed"
        ? "Workbench item was reanalysed automatically after OCR."
        : "Workbench item was reanalysed manually.",
    metadata: {
      source,
      analysisResult,
      patientMatchResult,
      draftResult,
    },
  });

  const { data: refreshedItem } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  return {
    success: true,
    analysisResult,
    patientMatchResult,
    draftResult,
    item: refreshedItem,
  };
}
