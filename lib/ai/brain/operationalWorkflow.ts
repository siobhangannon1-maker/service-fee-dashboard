import OpenAI from "openai";

import { supabaseAdmin } from "@/lib/supabase/admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type WorkflowKind =
  | "radiology_review"
  | "pathology_review"
  | "urgent_clinical"
  | "existing_patient_correspondence"
  | "new_referral"
  | "administrative"
  | "marketing_or_spam"
  | "unknown";

export type WorkflowClassification = {
  workflow_kind: WorkflowKind;
  document_type: string;
  confidence: number;
  reason: string;
  modifiers: {
    urgent?: boolean;
    abnormal_findings?: boolean;
    clinical_findings_present?: boolean;
    existing_patient?: boolean;
    routine_referral?: boolean;
    unusual_or_complex?: boolean;
    missing_information?: boolean;
    should_auto_create_trello?: boolean;
    should_generate_reply_draft?: boolean;
  };
};

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalise(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonMaybe(value: any) {
  if (!value) return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function getAttachmentText(item: any) {
  const attachmentDebug = parseJsonMaybe(item.attachment_debug);
  const importedAttachments = attachmentDebug?.imported_attachments || [];

  if (!Array.isArray(importedAttachments)) return "";

  return importedAttachments
    .map((attachment: any) =>
      [
        attachment.name ? `Attachment: ${attachment.name}` : "",
        attachment.extracted_text || "",
        attachment.ocr_text || "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function getWorkflowSourceText(item: any) {
  return cleanText(
    [
      item.email_subject || item.subject || "",
      item.email_body || "",
      item.raw_text || "",
      item.body || "",
      item.extracted_text || "",
      item.summary || "",
      item.suggested_action || "",
      item.category || "",
      getAttachmentText(item),
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(normalise(word)));
}

function isStrongRadiologyText(text: string) {
  const radiologyWords = [
    "radiology",
    "radiologist",
    "radiological",
    "radiograph",
    "radiographic",
    "radiographic findings",
    "imaging",
    "imaging report",
    "diagnostic imaging",
    "medical imaging",
    "scan report",
    "mri",
    "mri report",
    "magnetic resonance",
    "magnetic resonance imaging",
    "tmj mri",
    "temporomandibular joint mri",
    "temporomandibular joint imaging",
    "ct report",
    "ct scan",
    "dentascan",
    "ct dentascan",
    "cbct",
    "cone beam",
    "cone beam ct",
    "opg",
    "xray",
    "x ray",
    "x-ray",
    "iomr",
    "ultrasound report",
  ];

  if (containsAny(text, radiologyWords)) return true;

  const reportClues = [
    "clinical details",
    "clinical history",
    "findings",
    "conclusion",
    "impression",
    "reported by",
    "report status",
    "examination",
  ];

  const imagingClues = [
    "mri",
    "ct",
    "cbct",
    "opg",
    "dentascan",
    "scan",
    "temporomandibular",
    "tmj",
    "mandible",
    "maxilla",
  ];

  return containsAny(text, reportClues) && containsAny(text, imagingClues);
}

function isStrongPathologyText(text: string) {
  const pathologyWords = [
    "pathology",
    "pathologist",
    "qml pathology",
    "histopathology",
    "histology",
    "oral pathology",
    "surgical pathology",
    "anatomical pathology",
    "cytology",
    "biopsy",
    "incisional biopsy",
    "excisional biopsy",
    "punch biopsy",
    "specimen",
    "specimens",
    "specimen type",
    "specimen received",
    "date received",
    "date collected",
    "laboratory report",
    "lab report",
    "final diagnosis",
    "diagnosis",
    "clinical diagnosis",
    "gross description",
    "macroscopic examination",
    "macroscopic description",
    "microscopic examination",
    "microscopic description",
    "microscopy",
    "macroscopy",
    "immunohistochemistry",
    "dysplasia",
    "malignancy",
    "carcinoma",
    "squamous cell carcinoma",
    "basal cell carcinoma",
    "mucocele",
    "odontogenic",
    "keratocyst",
    "dentigerous cyst",
    "periapical granuloma",
    "periapical cyst",
    "focal fibrous hyperplasia",
    "irritation fibroma",
  ];

  if (containsAny(text, pathologyWords)) return true;

  const reportClues = [
    "clinical notes",
    "clinical history",
    "specimen",
    "diagnosis",
    "microscopy",
    "macroscopy",
    "reported by",
    "authorised by",
    "validated by",
    "final report",
    "accession",
  ];

  const pathologyClues = [
    "biopsy",
    "histology",
    "pathologist",
    "dysplasia",
    "malignancy",
    "carcinoma",
    "cyst",
    "lesion",
    "fibroma",
    "hyperplasia",
  ];

  return containsAny(text, reportClues) && containsAny(text, pathologyClues);
}

export function deterministicWorkflowClassification(item: any): WorkflowClassification {
  const text = normalise(getWorkflowSourceText(item));

  const urgentWords = [
    "urgent",
    "same day",
    "asap",
    "facial swelling",
    "airway",
    "difficulty breathing",
    "difficulty swallowing",
    "uncontrolled bleeding",
    "severe pain",
    "fever",
    "spreading infection",
    "rapidly worsening",
    "trauma",
  ];

  const marketingWords = [
    "unsubscribe",
    "marketing",
    "promotional",
    "newsletter",
    "microsoft 365",
    "productivity tools",
    "privacy statement",
  ];

  const existingPatientWords = [
    "existing patient",
    "current patient",
    "records request",
    "records transfer",
    "correspondence",
    "letter regarding",
    "regarding patient",
    "clinical update",
    "follow up",
    "review of",
  ];

  const referralWords = ["referral", "refer", "referred", "please see", "new patient"];

  const abnormalWords = [
    "finding",
    "findings",
    "lesion",
    "cyst",
    "infection",
    "resorption",
    "bone loss",
    "pathosis",
    "periapical",
    "impacted",
    "fracture",
    "closed lock",
    "disc displacement",
    "joint effusion",
    "degenerative change",
    "arthritis",
    "arthropathy",
    "dysplasia",
    "malignancy",
    "carcinoma",
  ];

  const complexWords = [
    "unusual",
    "complex",
    "complication",
    "persistent infection",
    "failed",
    "failure",
    "revision",
    "second opinion",
    "closed lock",
    "tmj",
    "dysplasia",
    "malignancy",
    "carcinoma",
  ];

  const urgent = containsAny(text, urgentWords);
  const clinicalFindings = containsAny(text, abnormalWords);
  const unusualOrComplex = containsAny(text, complexWords);

  // Hard priority 1: pathology reports/results.
  // This must run before generic referral/general correspondence detection.
  if (isStrongPathologyText(text)) {
    return {
      workflow_kind: "pathology_review",
      document_type: "pathology_or_histopathology_report",
      confidence: 0.97,
      reason:
        "Pathology/histopathology report wording was detected. This overrides generic referral/general correspondence wording; clinical findings remain modifiers.",
      modifiers: {
        urgent,
        abnormal_findings: clinicalFindings,
        clinical_findings_present: clinicalFindings,
        unusual_or_complex: unusualOrComplex,
        should_auto_create_trello: true,
        should_generate_reply_draft: false,
      },
    };
  }

  // Hard priority 2: radiology/imaging reports/results.
  if (isStrongRadiologyText(text)) {
    return {
      workflow_kind: "radiology_review",
      document_type: "radiology_or_imaging_report",
      confidence: 0.96,
      reason:
        "Radiology/imaging report wording was detected. This overrides generic referral/general correspondence wording; clinical findings remain modifiers.",
      modifiers: {
        urgent,
        abnormal_findings: clinicalFindings,
        clinical_findings_present: clinicalFindings,
        unusual_or_complex: unusualOrComplex,
        should_auto_create_trello: true,
        should_generate_reply_draft: false,
      },
    };
  }

  if (urgent) {
    return {
      workflow_kind: "urgent_clinical",
      document_type: "urgent_clinical_correspondence",
      confidence: 0.85,
      reason:
        "Strong urgent clinical wording was detected outside a radiology/pathology report.",
      modifiers: {
        urgent: true,
        abnormal_findings: clinicalFindings,
        clinical_findings_present: clinicalFindings,
        unusual_or_complex: unusualOrComplex,
        should_auto_create_trello: true,
        should_generate_reply_draft: false,
      },
    };
  }

  if (containsAny(text, marketingWords)) {
    return {
      workflow_kind: "marketing_or_spam",
      document_type: "marketing_or_system_email",
      confidence: 0.95,
      reason: "Marketing/promotional/system email wording was detected.",
      modifiers: {
        should_auto_create_trello: false,
        should_generate_reply_draft: false,
      },
    };
  }

  if (containsAny(text, existingPatientWords)) {
    return {
      workflow_kind: "existing_patient_correspondence",
      document_type: "existing_patient_correspondence",
      confidence: 0.8,
      reason: "Existing patient correspondence or records transfer wording was detected.",
      modifiers: {
        existing_patient: true,
        clinical_findings_present: clinicalFindings,
        unusual_or_complex: unusualOrComplex,
        should_auto_create_trello: true,
        should_generate_reply_draft: false,
      },
    };
  }

  if (containsAny(text, referralWords)) {
    return {
      workflow_kind: "new_referral",
      document_type: "new_referral",
      confidence: 0.75,
      reason: "New referral wording was detected and no radiology/pathology report override matched.",
      modifiers: {
        routine_referral: !unusualOrComplex && !clinicalFindings,
        abnormal_findings: clinicalFindings,
        clinical_findings_present: clinicalFindings,
        unusual_or_complex: unusualOrComplex,
        should_auto_create_trello: unusualOrComplex || clinicalFindings,
        should_generate_reply_draft: true,
      },
    };
  }

  return {
    workflow_kind: "unknown",
    document_type: "unknown",
    confidence: 0.5,
    reason: "No strong workflow pattern was detected.",
    modifiers: {
      clinical_findings_present: clinicalFindings,
      unusual_or_complex: unusualOrComplex,
      should_auto_create_trello: false,
      should_generate_reply_draft: false,
    },
  };
}

function coerceWorkflowKind(value: any): WorkflowKind | null {
  const allowed: WorkflowKind[] = [
    "radiology_review",
    "pathology_review",
    "urgent_clinical",
    "existing_patient_correspondence",
    "new_referral",
    "administrative",
    "marketing_or_spam",
    "unknown",
  ];

  return allowed.includes(value) ? value : null;
}

export async function classifyOperationalWorkflow({
  inboxItemId,
  persist = true,
}: {
  inboxItemId: string;
  persist?: boolean;
}) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const deterministic = deterministicWorkflowClassification(item);
  const sourceText = getWorkflowSourceText(item);

  let aiResult: any = null;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_WORKFLOW_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
You classify dental practice correspondence into operational workflow buckets.

Return ONLY JSON:
{
  "workflow_kind": "radiology_review | pathology_review | urgent_clinical | existing_patient_correspondence | new_referral | administrative | marketing_or_spam | unknown",
  "document_type": "brief document type",
  "confidence": 0.0,
  "reason": "brief reason",
  "modifiers": {
    "urgent": false,
    "abnormal_findings": false,
    "clinical_findings_present": false,
    "existing_patient": false,
    "routine_referral": false,
    "unusual_or_complex": false,
    "missing_information": false,
    "should_auto_create_trello": false,
    "should_generate_reply_draft": false
  }
}

Critical hierarchy:
1. Document/workflow type is primary.
2. Histopathology, pathology, biopsy, specimen, microscopic description, macroscopic description, final diagnosis, surgical pathology, oral pathology, laboratory report, or lab report = pathology_review.
3. MRI, CT, CBCT, OPG, x-ray, scan, imaging report, radiology report, or diagnostic imaging report = radiology_review.
4. Pathology/radiology reports remain their report workflow even if they contain clinical findings, abnormal findings, treatment implications, sender fax text, or the word referral.
5. Clinical findings are modifiers, not a reason to override pathology/radiology workflow.
6. Do not generate email reply drafts for pathology or radiology result faxes/reports.
7. Radiology, pathology, urgent items, and existing patient correspondence should auto-create Trello.
8. Routine new referrals should usually NOT auto-create Trello.
`,
        },
        {
          role: "user",
          content: `
Item:
Subject: ${item.email_subject || item.subject || item.file_name || ""}
Current category: ${item.category || ""}
Current summary: ${item.summary || ""}

Deterministic suggestion:
${JSON.stringify(deterministic, null, 2)}

Content:
${sourceText.slice(0, 12000)}
`,
        },
      ],
    });

    aiResult = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch (error) {
    console.warn("AI workflow classification failed, using deterministic result:", error);
  }

  const aiWorkflowKind = coerceWorkflowKind(aiResult?.workflow_kind);

  // Hard lock: if deterministic rules identify a report workflow, AI cannot downgrade it.
  const deterministicIsHardReport =
    deterministic.workflow_kind === "radiology_review" ||
    deterministic.workflow_kind === "pathology_review";

  const workflowKind = deterministicIsHardReport
    ? deterministic.workflow_kind
    : aiWorkflowKind || deterministic.workflow_kind;

  const result: WorkflowClassification = {
    workflow_kind: workflowKind,
    document_type: deterministicIsHardReport
      ? deterministic.document_type
      : aiResult?.document_type || deterministic.document_type,
    confidence: deterministicIsHardReport
      ? deterministic.confidence
      : typeof aiResult?.confidence === "number"
      ? Math.max(0, Math.min(aiResult.confidence, 0.99))
      : deterministic.confidence,
    reason: deterministicIsHardReport
      ? `${deterministic.reason} AI result was not allowed to override this hard report classification.`
      : aiResult?.reason || deterministic.reason,
    modifiers: {
      ...deterministic.modifiers,
      ...(deterministicIsHardReport ? {} : aiResult?.modifiers || {}),
    },
  };

  if (
    result.workflow_kind === "radiology_review" ||
    result.workflow_kind === "pathology_review" ||
    result.workflow_kind === "urgent_clinical"
  ) {
    result.modifiers.should_auto_create_trello = true;
    result.modifiers.should_generate_reply_draft = false;
  }

  if (persist) {
    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        workflow_kind: result.workflow_kind,
        workflow_document_type: result.document_type,
        workflow_modifiers: result.modifiers,
        workflow_classification_reason: result.reason,
      })
      .eq("id", inboxItemId);
  }

  return result;
}
