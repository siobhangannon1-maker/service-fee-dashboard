import OpenAI from "openai";

import { supabaseAdmin } from "@/lib/supabase/admin";

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

  const looseDateMatches = Array.from(
    text.matchAll(/\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/g)
  );

  for (const match of looseDateMatches) {
    const dob = normaliseAustralianDate({
      day: match[1],
      month: match[2],
      year: match[3],
    });

    if (isPlausibleDob(dob)) return dob;
  }

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
    extractDobFromText(sourceText) || inboxItem.patient_dob || null;

  const deterministicEmail =
    extractEmailFromText(sourceText) || inboxItem.sender_email || null;

  const deterministicPhone = extractPhoneFromText(sourceText);

  const prompt = `
You are the AI Reception Brain for a specialist dental practice:
- oral and maxillofacial surgery
- periodontics
- implant dentistry
- referral-based specialist care

Analyse the incoming correspondence and return ONLY valid JSON.

Use this exact structure:

{
  "title": "short human-readable case title",
  "category": "new_referral | appointment_request | billing | post_op | clinical_question | complaint | admin | unknown",
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

  const decision = JSON.parse(raw);

  const finalCategory = decision.category || inboxItem.category || "unknown";
  const finalPatientName =
    decision.patient_name || inboxItem.patient_name || null;

  const finalPatientDob =
    deterministicDob || decision.patient_dob || inboxItem.patient_dob || null;

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
    item.patient_dob || extractDobFromText(sourceText) || null;
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

export async function generateOrUpdateDraft({
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
      skipped: true,
      reason: "inbox_item_not_found",
    };
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

  if (decision.requires_clinical_review) {
    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        email_status: "drafted",
      })
      .eq("id", inboxItemId);

    return {
      skipped: true,
      reason: "clinical_review_required",
    };
  }

  if (decision.missing_information?.length) {
    return {
      skipped: true,
      reason: "missing_information",
      missing_information: decision.missing_information,
    };
  }

  if (decision.safe_to_auto_draft === false) {
    return {
      skipped: true,
      reason: "not_safe_to_auto_draft",
    };
  }

  const { data: rules } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("*")
    .eq("is_active", true)
    .limit(20);

  const { data: examples } = await supabaseAdmin
    .from("ai_approved_examples")
    .select("*")
    .eq("is_active", true)
    .limit(5);

  const rulesText = rules?.map((r) => `- ${r.rule}`).join("\n") || "";

  const examplesText =
    examples
      ?.map(
        (e) => `
Incoming example:
${e.incoming_message}

Approved reply subject:
${e.approved_reply_subject || ""}

Approved reply body:
${e.approved_reply_body}

Tone notes:
${e.tone_notes || ""}

Avoid:
${e.avoid_notes || ""}
`
      )
      .join("\n\n") || "";

  const prompt = `
You are a receptionist at Focus Dental Specialists.

Draft a professional, warm, concise email reply.

Important rules:
- Use Australian English.
- Do not give clinical advice.
- Do not diagnose.
- Do not invent fees, appointment times, treatment plans, or clinical opinions.
- If staff need to review something, say the team will review and respond.
- Do not say the email was written by AI.
- Do not include an email signature. Outlook will add the signature separately.
- Do not output unresolved placeholders like {{clinic_name}}.

Learning rules:
${rulesText}

Approved examples:
${examplesText}

AI Brain decision:
${JSON.stringify(decision, null, 2)}

Context:
Sender name: ${item.sender_name || "Unknown"}
Sender email: ${item.sender_email || "Unknown"}
Email subject: ${item.email_subject || item.subject || item.file_name || "No subject"}
Category: ${item.category || "unknown"}
Patient name: ${item.patient_name || "Unknown"}
Patient DOB: ${item.patient_dob || "Unknown"}
Summary: ${item.summary || ""}
Suggested action: ${item.suggested_action || ""}

Correspondence:
${item.raw_text || item.body || item.email_body || item.extracted_text || ""}

Return JSON only:
{
  "subject": "",
  "body": ""
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

  const body = parsed.body || "";

  if (!body) {
    return {
      skipped: true,
      reason: "empty_draft_body",
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
      used_learning_rules: rules?.map((r) => r.title) || [],
      used_examples: examples?.map((e) => e.title) || [],
      decision_summary: decision,
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
