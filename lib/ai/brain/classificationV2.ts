import OpenAI from "openai";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyOperationalWorkflow } from "@/lib/ai/brain/operationalWorkflow";
import { routeClinicianForInboxItem } from "@/lib/ai/brain/clinicianRouting";
import { extractCorrespondenceParties } from "@/lib/ai/brain/extractCorrespondenceParties";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ClassificationV2Params = {
  inboxItemId: string;
  source?: string;
  persist?: boolean;
};

function splitPatientNameForStorage(value: string | null | undefined) {
  const cleaned = String(value || "")
    .replace(/^(master|miss|mrs|ms|mr|dr|prof|mx)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return {
      firstName: null,
      lastName: null,
    };
  }

  const parts = cleaned.split(" ").filter(Boolean);

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: null,
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function clean(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactText(value: string | null | undefined, maxLength = 14000) {
  const text = clean(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n[Text truncated for classification]`;
}

function getSourceText(item: any) {
  return compactText(
    [
      `Email subject: ${item.email_subject || item.subject || ""}`,
      `Email sender name: ${item.sender_name || ""}`,
      `Email sender email: ${item.sender_email || ""}`,
      "",
      "Email body:",
      item.email_body || item.body || "",
      "",
      "Attachment / extracted text:",
      item.extracted_text || item.raw_text || "",
      "",
      "Existing extracted fields:",
      JSON.stringify(
        {
          patient_name: item.patient_name,
          patient_dob: item.patient_dob,
          category: item.category,
          workflow_kind: item.workflow_kind,
          assigned_clinician_name: item.assigned_clinician_name,
          extracted_patient_first_name: item.extracted_patient_first_name,
          extracted_patient_last_name: item.extracted_patient_last_name,
          extracted_patient_dob: item.extracted_patient_dob,
          extracted_patient_mobile: item.extracted_patient_mobile,
          correspondence_sender_name: item.correspondence_sender_name,
          correspondence_author_name: item.correspondence_author_name,
          correspondence_addressee_name: item.correspondence_addressee_name,
        },
        null,
        2,
      ),
    ].join("\n"),
  );
}

function parseJsonObject(raw: string) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function normaliseBoolean(value: any, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normaliseNumber(value: any, fallback = 0) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(value, 1));
}

function normaliseString(value: any, fallback: string | null = null) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.trim();
  return cleaned || fallback;
}

function normaliseDobToIso(value: string | null | undefined) {
  const raw = clean(value);

  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return raw;

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  let year = match[3];

  if (year.length === 2) {
    const numericYear = Number(year);
    year = numericYear <= 29 ? `20${year}` : `19${year}`;
  }

  return `${year}-${month}-${day}`;
}

function splitPatientName(value: string | null | undefined) {
  const parts = clean(value)
    .replace(/^(master|miss|mrs|ms|mr|dr)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return { firstName: null as string | null, lastName: null as string | null };
  }

  return {
    firstName: parts[0] || null,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function extractPatientIdentityFromReferralHeader(sourceText: string) {
  const text = clean(sourceText);

  const patterns = [
    /\bRE\s*:\s*(?:Master|Mr|Mrs|Ms|Miss|Mx)?\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){1,3})\s+(?:DOB|D\.O\.B\.|Date\s*of\s*Birth)\s*[:\-]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b/i,
    /\bPatient\s*:?\s*(?:Master|Mr|Mrs|Ms|Miss|Mx)?\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){1,3})\s+(?:DOB|D\.O\.B\.|Date\s*of\s*Birth)\s*[:\-]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b/i,
    /\bName\s*:?\s*(?:Master|Mr|Mrs|Ms|Miss|Mx)?\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){1,3})\s+(?:DOB|D\.O\.B\.|Date\s*of\s*Birth)\s*[:\-]?\s*(\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const fullName = match[1].trim();
    const parts = splitPatientName(fullName);

    return {
      fullName,
      firstName: parts.firstName,
      lastName: parts.lastName,
      dob: normaliseDobToIso(match[2]) || match[2] || null,
      source: "referral_header",
    };
  }

  return {
    fullName: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null,
    dob: null as string | null,
    source: null as string | null,
  };
}

function derivePatientStatus(result: any, workflowKind: string | null) {
  const supplied = normaliseString(result.patient_status);

  if (
    supplied === "existing_patient" ||
    supplied === "new_patient" ||
    supplied === "unknown"
  ) {
    return supplied;
  }

  if (workflowKind === "existing_patient_correspondence") {
    return "existing_patient";
  }

  return "unknown";
}

function deriveTrelloDecision({
  result,
  workflowKind,
  requiresClinicalReview,
}: {
  result: any;
  workflowKind: string | null;
  requiresClinicalReview: boolean;
}) {
  if (typeof result.should_create_trello_task === "boolean") {
    return result.should_create_trello_task;
  }

  if (
    workflowKind === "existing_patient_correspondence" ||
    workflowKind === "radiology_review" ||
    workflowKind === "pathology_review" ||
    workflowKind === "urgent_clinical"
  ) {
    return true;
  }

  if (requiresClinicalReview) return true;

  return false;
}

function buildResultRow({
  inboxItemId,
  source,
  item,
  aiResult,
  workflow,
  clinician,
  parties,
}: {
  inboxItemId: string;
  source: string;
  item: any;
  aiResult: any;
  workflow: any;
  clinician: any;
  parties: any;
}) {
  const workflowKind =
    normaliseString(aiResult.workflow_kind) ||
    workflow?.workflow_kind ||
    item.workflow_kind ||
    null;

  const requiresClinicalReview = normaliseBoolean(
    aiResult.requires_clinical_review,
    Boolean(aiResult.risk_level === "high"),
  );

  const shouldCreateTrello = deriveTrelloDecision({
    result: aiResult,
    workflowKind,
    requiresClinicalReview,
  });

  const shouldGenerateReplyDraft = normaliseBoolean(
    aiResult.should_generate_reply_draft,
    workflowKind !== "radiology_review" &&
      workflowKind !== "pathology_review" &&
      workflowKind !== "urgent_clinical",
  );

  const patientStatus = derivePatientStatus(aiResult, workflowKind);
  const deterministicPatient = extractPatientIdentityFromReferralHeader(getSourceText(item));

  const patientFirstName =
    deterministicPatient.firstName ||
    normaliseString(aiResult.patient_first_name) ||
    item.extracted_patient_first_name ||
    null;

  const patientLastName =
    deterministicPatient.lastName ||
    normaliseString(aiResult.patient_last_name) ||
    item.extracted_patient_last_name ||
    null;

  const patientDob =
    deterministicPatient.dob ||
    normaliseDobToIso(normaliseString(aiResult.patient_dob)) ||
    item.extracted_patient_dob ||
    item.patient_dob ||
    null;

  return {
    inbox_item_id: inboxItemId,
    source,

    primary_category:
      normaliseString(aiResult.primary_category) ||
      normaliseString(aiResult.category) ||
      item.category ||
      null,
    workflow_kind: workflowKind,
    document_type:
      normaliseString(aiResult.document_type) ||
      item.workflow_document_type ||
      null,
    operational_intent:
      normaliseString(aiResult.operational_intent) ||
      normaliseString(aiResult.intent) ||
      null,

    patient_status: patientStatus,
    patient_first_name: patientFirstName,
    patient_last_name: patientLastName,
    patient_dob: patientDob,
    patient_mobile:
      normaliseString(aiResult.patient_mobile) ||
      item.extracted_patient_mobile ||
      null,
    patient_email:
      normaliseString(aiResult.patient_email) ||
      item.extracted_patient_email ||
      null,

    sender_name:
      parties?.correspondence_sender_name ||
      item.correspondence_sender_name ||
      item.sender_name ||
      null,
    sender_email:
      parties?.correspondence_sender_email || item.sender_email || null,
    correspondence_author_name:
      parties?.correspondence_author_name ||
      item.correspondence_author_name ||
      null,
    correspondence_addressee_name:
      parties?.correspondence_addressee_name ||
      item.correspondence_addressee_name ||
      null,

    internal_focus_clinician_key:
      clinician?.clinician_key || item.assigned_clinician_key || null,
    internal_focus_clinician_name:
      clinician?.clinician_name || item.assigned_clinician_name || null,
    internal_focus_clinician_confidence:
      typeof clinician?.confidence === "number"
        ? clinician.confidence
        : item.clinician_routing_confidence || null,
    internal_focus_clinician_reason:
      clinician?.reason || item.clinician_routing_reason || null,

    should_generate_reply_draft: shouldGenerateReplyDraft,
    should_create_trello_task: shouldCreateTrello,
    should_match_praktika: normaliseBoolean(aiResult.should_match_praktika, true),
    requires_clinical_review: requiresClinicalReview,
    safe_to_auto_draft: normaliseBoolean(aiResult.safe_to_auto_draft, true),

    urgency: normaliseString(aiResult.urgency, "low"),
    confidence: normaliseNumber(aiResult.confidence, workflow?.confidence || 0.5),
    risk_level: normaliseString(aiResult.risk_level, "low"),

    missing_information: asArray(aiResult.missing_information),
    risks: asArray(aiResult.risks),
    evidence: asArray(aiResult.evidence),
    reasoning_summary:
      normaliseString(aiResult.reasoning_summary) ||
      normaliseString(aiResult.explanation) ||
      null,
    recommended_next_step:
      normaliseString(aiResult.recommended_next_step) ||
      normaliseString(aiResult.suggested_action) ||
      null,

    raw_result: {
      aiResult,
      workflow,
      clinician,
      parties,
      generated_at: new Date().toISOString(),
    },
  };
}

async function loadInboxItem(inboxItemId: string) {
  const { data, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  return data;
}

async function runAIClassification({
  item,
  workflow,
  clinician,
  parties,
}: {
  item: any;
  workflow: any;
  clinician: any;
  parties: any;
}) {
  const content = getSourceText(item);

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_CLASSIFICATION_V2_MODEL || "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
You are Classification Engine V2 for an Australian dental specialist practice.

Your job:
Classify the inbox item, identify patient/context, decide workflow actions, and separate:
- email sender / reply greeting person
- attached letter author
- attached letter addressee
- internal Focus Dental Specialists clinician/provider

Return JSON only.

Important rules:
- Do not invent patient details.
- Prioritise patient names in RE:, Patient:, or Name: lines.
- If a full name appears beside DOB/D.O.B./date of birth, that is the patient.
- Do not override a RE-line patient name with later wording such as "I am referring [word/name]".
- Example: "RE: Fake Fake DOB: 03/03/2003 Phone: 0411111111 I am referring Test for extraction" means patient_first_name="Fake" and patient_last_name="Fake", not Test.
- Do not use the attached letter addressee as the internal Focus clinician unless the text clearly says they are a Focus clinician.
- If the item is existing patient correspondence, it should usually create a Trello task.
- Existing patient correspondence should receive an acknowledgement draft unless unsafe.
- Radiology/pathology/urgent clinical items should create Trello tasks and usually not auto-draft.
- If the letter says patient was referred to or under care of Dr Troy McGowan at Focus, route internally to Dr Troy McGowan.
- If the letter is only cc'd to Focus, identify the Focus clinician from cc line or care/referral wording.
- Use Australian English.
`,
      },
      {
        role: "user",
        content: `
Existing V1 workflow:
${JSON.stringify(workflow, null, 2)}

Existing clinician route:
${JSON.stringify(clinician, null, 2)}

Existing correspondence party extraction:
${JSON.stringify(parties, null, 2)}

Inbox content:
${content}

Return JSON in this exact shape:
{
  "primary_category": "existing_patient_correspondence | new_referral | radiology_review | pathology_review | urgent_clinical | admin | invoice_request | other",
  "workflow_kind": "existing_patient_correspondence | new_referral | radiology_review | pathology_review | urgent_clinical | marketing_or_spam | other",
  "document_type": "string",
  "operational_intent": "string",
  "patient_status": "existing_patient | new_patient | unknown",
  "patient_first_name": "string or null",
  "patient_last_name": "string or null",
  "patient_dob": "YYYY-MM-DD or DD/MM/YYYY or null",
  "patient_mobile": "string or null",
  "patient_email": "string or null",
  "should_generate_reply_draft": true,
  "should_create_trello_task": true,
  "should_match_praktika": true,
  "requires_clinical_review": false,
  "safe_to_auto_draft": true,
  "urgency": "low | medium | high",
  "risk_level": "low | medium | high",
  "confidence": 0.0,
  "missing_information": [],
  "risks": [],
  "evidence": [
    {
      "label": "short label",
      "quote": "short source phrase",
      "meaning": "why it matters"
    }
  ],
  "reasoning_summary": "brief explanation",
  "recommended_next_step": "brief staff next action"
}
`,
      },
    ],
  });

  return parseJsonObject(completion.choices[0]?.message?.content || "{}");
}

export async function classifyInboxItemV2({
  inboxItemId,
  source = "manual",
  persist = true,
}: ClassificationV2Params) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      classification_v2_status: "running",
      classification_v2_error: null,
      classification_v2_last_run_at: new Date().toISOString(),
    })
    .eq("id", inboxItemId);

  try {
    const workflow = await classifyOperationalWorkflow({
      inboxItemId,
      persist,
    });

    let clinician: any = null;

    try {
      clinician = await routeClinicianForInboxItem({
        inboxItemId,
        persist,
      });
    } catch (error) {
      console.warn("V2 clinician routing context failed:", error);
      clinician = null;
    }

    let parties: any = null;

    try {
      parties = await extractCorrespondenceParties({
        inboxItemId,
      });
    } catch (error) {
      console.warn("V2 party extraction context failed:", error);
      parties = null;
    }

    const item = await loadInboxItem(inboxItemId);

    const aiResult = await runAIClassification({
      item,
      workflow,
      clinician,
      parties,
    });

    const row = buildResultRow({
      inboxItemId,
      source,
      item,
      aiResult,
      workflow,
      clinician,
      parties,
    });

    let savedResult: any = null;

    if (persist) {
      const { data, error } = await supabaseAdmin
        .from("ai_classification_v2_results")
        .insert(row)
        .select("*")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      savedResult = data;

      await supabaseAdmin
        .from("ai_inbox_items")
        .update({
          classification_v2_status: "completed",
          classification_v2_last_run_at: new Date().toISOString(),
          classification_v2_category: row.primary_category,
          classification_v2_workflow_kind: row.workflow_kind,
          classification_v2_confidence: row.confidence,
          classification_v2_summary: row.reasoning_summary,
          classification_v2_should_create_trello: row.should_create_trello_task,
          classification_v2_should_generate_reply:
            row.should_generate_reply_draft,
          classification_v2_requires_clinical_review:
            row.requires_clinical_review,
          patient_name:
            [row.patient_first_name, row.patient_last_name]
              .filter(Boolean)
              .join(" ") || item.patient_name || null,
          extracted_patient_first_name:
            row.patient_first_name || item.extracted_patient_first_name || null,
          extracted_patient_last_name:
            row.patient_last_name || item.extracted_patient_last_name || null,
          extracted_patient_dob:
            normaliseDobToIso(row.patient_dob) || item.extracted_patient_dob || null,
          extracted_patient_mobile:
            row.patient_mobile || item.extracted_patient_mobile || null,
          extracted_patient_email:
            row.patient_email || item.extracted_patient_email || null,
          patient_dob:
            row.patient_dob || item.patient_dob || null,
          classification_v2_error: null,
        })
        .eq("id", inboxItemId);

      await supabaseAdmin.from("ai_workbench_audit_events").insert({
        inbox_item_id: inboxItemId,
        event_type: "classification_v2_completed",
        event_label: "Classification Engine V2 completed",
        details: {
          result_id: savedResult.id,
          row,
        },
      });
    }

    return {
      success: true,
      result: savedResult || row,
      row,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Classification Engine V2 failed.";

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        classification_v2_status: "failed",
        classification_v2_error: message,
        classification_v2_last_run_at: new Date().toISOString(),
      })
      .eq("id", inboxItemId);

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "classification_v2_failed",
      event_label: "Classification Engine V2 failed",
      details: {
        error: message,
      },
    });

    throw error;
  }
}
