import { supabaseAdmin } from "@/lib/supabase/admin";

type WorkflowKind =
  | "new_referral"
  | "existing_patient_correspondence"
  | "appointment_request"
  | "billing"
  | "post_op_concern"
  | "radiology_review"
  | "pathology_review"
  | "urgent_clinical"
  | "admin"
  | "unknown";

type WorkflowResult = {
  workflow_kind: WorkflowKind;
  workflow_document_type: string;
  workflow_modifiers: {
    urgent: boolean;
    abnormal_findings: boolean;
    unusual_or_complex: boolean;
    clinical_findings_present: boolean;
    should_auto_create_trello: boolean;
    should_generate_reply_draft: boolean;
  };
  workflow_classification_reason: string;
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalise(value: string | null | undefined) {
  return clean(value).replace(/[^a-z0-9]+/g, " ").trim();
}

export function getWorkflowSourceText(item: any) {
  return [
    item?.email_subject || item?.subject || "",
    item?.email_body || "",
    item?.body || "",
    item?.raw_text || "",
    item?.extracted_text || "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function getWorkflowEmailText(item: any) {
  return [
    item?.email_subject || item?.subject || "",
    item?.email_body || "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function countTerms(text: string, terms: string[]) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function getBestEmailBody(item: any) {
  return getWorkflowEmailText(item);
}

function getBestFullText(item: any) {
  return getWorkflowSourceText(item);
}

function detectExistingPatientCommunication(emailText: string, fullText: string) {
  const email = normalise(emailText);
  const full = normalise(fullText);

  const emailSignals = [
    "our mutual patient",
    "mutual patient",
    "existing patient",
    "your patient",
    "our patient",
    "shared patient",
    "patient karoly",
    "letter for",
    "attached letter",
    "please find attached letter",
    "correspondence regarding",
    "regarding our mutual patient",
    "regarding your patient",
    "follow up",
    "followup",
    "review letter",
    "progress letter",
    "treatment update",
    "ongoing care",
    "previous treatment",
  ];

  const fullTextSignals = [
    "previous appointment",
    "review appointment",
    "ongoing treatment",
    "ongoing care",
    "follow up",
    "followup",
    "post operative review",
    "postoperative review",
    "existing patient",
    "mutual patient",
    "your patient",
    "our patient",
  ];

  const emailSignalCount = countTerms(email, emailSignals);
  const fullTextSignalCount = countTerms(full, fullTextSignals);

  return {
    matched: emailSignalCount > 0 || fullTextSignalCount >= 2,
    emailSignalCount,
    fullTextSignalCount,
  };
}

function detectNewReferral(emailText: string, fullText: string) {
  const email = normalise(emailText);
  const full = normalise(fullText);

  const explicitReferralSignals = [
    "new referral",
    "please see this patient",
    "please see patient",
    "please assess",
    "please review this patient",
    "i am referring",
    "we are referring",
    "referral for",
    "referred for",
  ];

  const weakerReferralSignals = [
    "thank you for referring",
    "thanks for referring",
    "referring",
    "referral",
  ];

  return {
    explicit: includesAny(email, explicitReferralSignals),
    weak:
      includesAny(email, weakerReferralSignals) ||
      includesAny(full, weakerReferralSignals),
  };
}

function detectPathologyReview(emailText: string, fullText: string) {
  const email = normalise(emailText);
  const full = normalise(fullText);

  const pathologyTerms = [
    "pathology report",
    "histopathology",
    "histology",
    "biopsy result",
    "biopsy report",
    "specimen",
    "microscopic description",
    "macroscopic description",
    "pathologist",
  ];

  const emailPathology = countTerms(email, pathologyTerms);
  const fullPathology = countTerms(full, pathologyTerms);

  return {
    matched: emailPathology > 0 || fullPathology >= 2,
    emailPathology,
    fullPathology,
  };
}

function detectRadiologyReview(emailText: string, fullText: string) {
  const email = normalise(emailText);
  const full = normalise(fullText);

  const radiologyTerms = [
    "radiology report",
    "imaging report",
    "xray report",
    "x ray report",
    "cbct report",
    "opg report",
    "cone beam",
    "radiologist",
    "impression:",
  ];

  const emailRadiology = countTerms(email, radiologyTerms);
  const fullRadiology = countTerms(full, radiologyTerms);

  return {
    matched: emailRadiology > 0 || fullRadiology >= 2,
    emailRadiology,
    fullRadiology,
  };
}

function detectUrgentClinical(fullText: string) {
  const full = normalise(fullText);

  const urgentTerms = [
    "difficulty breathing",
    "difficulty swallowing",
    "facial swelling",
    "severe swelling",
    "uncontrolled bleeding",
    "bleeding will not stop",
    "fever",
    "spreading infection",
    "severe pain",
    "unbearable pain",
    "paraesthesia",
    "numbness",
    "medication reaction",
  ];

  return includesAny(full, urgentTerms);
}

function detectClinicalModifiers(fullText: string) {
  const full = normalise(fullText);

  const abnormalTerms = [
    "infection",
    "bone loss",
    "failing implant",
    "failing implants",
    "diagnosis",
    "radiographic bone loss",
    "prolia",
    "denosumab",
    "mronj",
    "antibiotics",
    "surgical intervention",
    "clinical findings",
  ];

  const complexTerms = [
    "complexity",
    "complex",
    "staged approach",
    "surgical intervention",
    "implant supported bridge",
    "10 implants",
    "medication related osteonecrosis",
    "mronj",
  ];

  return {
    abnormal_findings: includesAny(full, abnormalTerms),
    unusual_or_complex: includesAny(full, complexTerms),
    clinical_findings_present: includesAny(full, [
      "diagnosis",
      "examination",
      "intraoral examination",
      "radiographic",
      "treatment planning",
      "medical history",
    ]),
  };
}

function buildWorkflowResult({
  workflowKind,
  documentType,
  reason,
  shouldGenerateReplyDraft,
  shouldAutoCreateTrello,
  urgent,
  modifiers,
}: {
  workflowKind: WorkflowKind;
  documentType: string;
  reason: string;
  shouldGenerateReplyDraft: boolean;
  shouldAutoCreateTrello: boolean;
  urgent: boolean;
  modifiers: {
    abnormal_findings: boolean;
    unusual_or_complex: boolean;
    clinical_findings_present: boolean;
  };
}): WorkflowResult {
  return {
    workflow_kind: workflowKind,
    workflow_document_type: documentType,
    workflow_modifiers: {
      urgent,
      abnormal_findings: modifiers.abnormal_findings,
      unusual_or_complex: modifiers.unusual_or_complex,
      clinical_findings_present: modifiers.clinical_findings_present,
      should_auto_create_trello: shouldAutoCreateTrello,
      should_generate_reply_draft: shouldGenerateReplyDraft,
    },
    workflow_classification_reason: reason,
  };
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

  const emailText = getBestEmailBody(item);
  const fullText = getBestFullText(item);

  const existingPatientCommunication = detectExistingPatientCommunication(
    emailText,
    fullText,
  );
  const newReferral = detectNewReferral(emailText, fullText);
  const pathology = detectPathologyReview(emailText, fullText);
  const radiology = detectRadiologyReview(emailText, fullText);
  const urgent = detectUrgentClinical(fullText);
  const modifiers = detectClinicalModifiers(fullText);

  /*
    Important architecture rule:
    The email communication intent wins over clinical content inside attachments.

    Example:
    Email body says "Here is a letter for our mutual patient".
    Attachment contains diagnosis/findings/referral wording.

    Correct workflow:
    existing_patient_correspondence

    NOT:
    pathology_review
    radiology_review
    new_referral

    Pathology/radiology should only hard-override when the email itself or the
    document is clearly a pathology/radiology report, not merely a clinical
    correspondence letter with findings.
  */

  let result: WorkflowResult;

  if (urgent) {
    result = buildWorkflowResult({
      workflowKind: "urgent_clinical",
      documentType: "urgent_clinical_correspondence",
      reason:
        "Urgent risk language was detected. This should be escalated operationally without clinical advice.",
      shouldGenerateReplyDraft: false,
      shouldAutoCreateTrello: true,
      urgent: true,
      modifiers,
    });
  } else if (existingPatientCommunication.matched && !newReferral.explicit) {
    result = buildWorkflowResult({
      workflowKind: "existing_patient_correspondence",
      documentType: "existing_patient_letter_or_correspondence",
      reason:
        "The email body/context indicates correspondence for an existing or mutual patient. This communication intent overrides generic referral/clinical wording inside attachments.",
      shouldGenerateReplyDraft: true,
      shouldAutoCreateTrello: false,
      urgent: false,
      modifiers,
    });
  } else if (pathology.matched && pathology.emailPathology > 0) {
    result = buildWorkflowResult({
      workflowKind: "pathology_review",
      documentType: "pathology_or_histopathology_report",
      reason:
        "Pathology/histopathology wording was detected in the email communication itself.",
      shouldGenerateReplyDraft: false,
      shouldAutoCreateTrello: true,
      urgent: false,
      modifiers,
    });
  } else if (radiology.matched && radiology.emailRadiology > 0) {
    result = buildWorkflowResult({
      workflowKind: "radiology_review",
      documentType: "radiology_or_imaging_report",
      reason:
        "Radiology/imaging report wording was detected in the email communication itself.",
      shouldGenerateReplyDraft: false,
      shouldAutoCreateTrello: true,
      urgent: false,
      modifiers,
    });
  } else if (pathology.matched && !existingPatientCommunication.matched) {
    result = buildWorkflowResult({
      workflowKind: "pathology_review",
      documentType: "pathology_or_histopathology_report",
      reason:
        "Pathology/histopathology report wording was detected and no existing-patient communication context was found.",
      shouldGenerateReplyDraft: false,
      shouldAutoCreateTrello: true,
      urgent: false,
      modifiers,
    });
  } else if (radiology.matched && !existingPatientCommunication.matched) {
    result = buildWorkflowResult({
      workflowKind: "radiology_review",
      documentType: "radiology_or_imaging_report",
      reason:
        "Radiology/imaging report wording was detected and no existing-patient communication context was found.",
      shouldGenerateReplyDraft: false,
      shouldAutoCreateTrello: true,
      urgent: false,
      modifiers,
    });
  } else if (newReferral.explicit || newReferral.weak) {
    result = buildWorkflowResult({
      workflowKind: "new_referral",
      documentType: "referral_or_new_patient_correspondence",
      reason:
        "Referral wording was detected and no stronger existing-patient communication override applied.",
      shouldGenerateReplyDraft: true,
      shouldAutoCreateTrello: false,
      urgent: false,
      modifiers,
    });
  } else if (normalise(emailText).includes("appointment")) {
    result = buildWorkflowResult({
      workflowKind: "appointment_request",
      documentType: "appointment_correspondence",
      reason: "Appointment wording was detected.",
      shouldGenerateReplyDraft: true,
      shouldAutoCreateTrello: false,
      urgent: false,
      modifiers,
    });
  } else if (
    normalise(emailText).includes("invoice") ||
    normalise(emailText).includes("receipt") ||
    normalise(emailText).includes("payment")
  ) {
    result = buildWorkflowResult({
      workflowKind: "billing",
      documentType: "billing_correspondence",
      reason: "Billing wording was detected.",
      shouldGenerateReplyDraft: true,
      shouldAutoCreateTrello: false,
      urgent: false,
      modifiers,
    });
  } else {
    result = buildWorkflowResult({
      workflowKind: "admin",
      documentType: "general_correspondence",
      reason:
        "No stronger workflow signal was detected, so this was classified as general administrative correspondence.",
      shouldGenerateReplyDraft: true,
      shouldAutoCreateTrello: false,
      urgent: false,
      modifiers,
    });
  }

  if (persist) {
    const { error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        workflow_kind: result.workflow_kind,
        workflow_document_type: result.workflow_document_type,
        workflow_modifiers: result.workflow_modifiers,
        workflow_classification_reason: result.workflow_classification_reason,
      })
      .eq("id", inboxItemId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "workflow_classified",
      event_label: "Workflow classified",
      details: {
        ...result,
        existingPatientCommunication,
        newReferral,
        pathology,
        radiology,
      },
    });
  }

  return result;
}
