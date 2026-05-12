import { supabaseAdmin } from "@/lib/supabase/admin";

type AutomationActionKey =
  | "file_to_praktika"
  | "archive"
  | "create_outlook_draft"
  | "send_outlook"
  | "send_sms"
  | "create_new_patient";

type AutomationPreview = {
  ok: boolean;
  status: "safe" | "blocked" | "review";
  inboxItemId: string;
  summary: string;
  matchedRules: Array<{
    id: string;
    title: string;
    category: string | null;
    rule_type: string | null;
    priority: number | null;
  }>;
  allowedActions: AutomationActionKey[];
  blockedActions: Array<{
    action: AutomationActionKey;
    reason: string;
  }>;
  blockedReasons: string[];
  warnings: string[];
  facts: Record<string, any>;
};

function parseMaybeJson(value: any) {
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

function getAttachments(item: any) {
  const debug = parseMaybeJson(item.attachment_debug);
  const imported = debug?.imported_attachments;

  if (Array.isArray(imported)) {
    return imported.filter((attachment) => attachment?.storage_path);
  }

  if (item.file_path) {
    return [
      {
        name: item.file_name || "Document",
        storage_path: item.file_path,
        content_type: "application/pdf",
      },
    ];
  }

  return [];
}

function getPraktikaCandidates(item: any) {
  const candidates = parseMaybeJson(item.praktika_match_candidates);
  return Array.isArray(candidates) ? candidates : [];
}

function getCandidateConfidence(candidate: any) {
  return Number(
    candidate?.confidence ??
      candidate?.score ??
      candidate?.matchScore ??
      candidate?.match_score ??
      candidate?.match_confidence ??
      0,
  );
}

function getExactPraktikaMatches(item: any) {
  const candidates = getPraktikaCandidates(item);

  return candidates.filter((candidate) => {
    const confidence = getCandidateConfidence(candidate);
    return confidence >= 1;
  });
}

function hasDuplicateExactPraktikaMatches(item: any) {
  return getExactPraktikaMatches(item).length > 1;
}

function isClinicalReviewRequired(item: any) {
  return (
    item.classification_v2_requires_clinical_review === true ||
    item.workflow_kind === "urgent_clinical" ||
    item.classification_v2_workflow_kind === "urgent_clinical"
  );
}

function hasNoReplyRequired(item: any) {
  return (
    item.email_status === "no_reply_needed" ||
    item.draft_status === "not_required" ||
    item.classification_v2_should_generate_reply === false ||
    item.workflow_kind === "radiology_review" ||
    item.workflow_kind === "pathology_review" ||
    item.classification_v2_workflow_kind === "radiology_review" ||
    item.classification_v2_workflow_kind === "pathology_review"
  );
}

function isEmailComplete(item: any) {
  return (
    item.email_status === "sent" ||
    Boolean(item.sent_at) ||
    Boolean(item.sent_detected_at) ||
    hasNoReplyRequired(item)
  );
}

function isTrelloComplete(item: any) {
  return (
    Boolean(item.trello_card_id) ||
    Boolean(item.reception_trello_card_id) ||
    item.trello_auto_task_status === "created" ||
    item.trello_auto_task_status === "skipped" ||
    item.reception_trello_task_status === "created" ||
    item.reception_trello_task_status === "skipped" ||
    item.classification_v2_should_create_trello === false
  );
}

function isPraktikaFilingComplete(item: any) {
  return (
    item.praktika_filing_status === "completed" ||
    Boolean(item.praktika_filed_at)
  );
}

function isSafeConfirmedPraktikaMatch(item: any) {
  const matchStatus = item.praktika_match_status;
  const confidence = Number(item.praktika_match_confidence || 0);

  return (
    Boolean(item.praktika_patient_id) &&
    (matchStatus === "matched_existing" ||
      matchStatus === "confirmed_manual") &&
    confidence >= 1 &&
    !hasDuplicateExactPraktikaMatches(item)
  );
}

function pushBlocked(
  preview: AutomationPreview,
  action: AutomationActionKey,
  reason: string,
) {
  preview.blockedActions.push({ action, reason });

  if (!preview.blockedReasons.includes(reason)) {
    preview.blockedReasons.push(reason);
  }
}

function ruleLooksRelevantToAction(ruleText: string, action: AutomationActionKey) {
  const text = ruleText.toLowerCase();

  if (action === "file_to_praktika") {
    return (
      text.includes("file") ||
      text.includes("praktika") ||
      text.includes("patient file") ||
      text.includes("attachment")
    );
  }

  if (action === "archive") {
    return text.includes("archive");
  }

  if (action === "send_sms") {
    return (
      text.includes("sms") ||
      text.includes("text message") ||
      text.includes("chekkit")
    );
  }

  if (action === "send_outlook") {
    return text.includes("send") || text.includes("outlook") || text.includes("email");
  }

  return true;
}

async function loadAutomationRules() {
  const { data, error } = await supabaseAdmin
    .from("ai_learning_rules")
    .select("id, title, category, rule_type, priority, rule, is_active")
    .eq("is_active", true)
    .eq("rule_type", "automation")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

export async function previewLearningRuleAutomationForInboxItem({
  inboxItemId,
}: {
  inboxItemId: string;
}): Promise<AutomationPreview> {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const rules = await loadAutomationRules();
  const attachments = getAttachments(item);
  const candidates = getPraktikaCandidates(item);
  const exactMatches = getExactPraktikaMatches(item);
  const duplicateExactMatches = hasDuplicateExactPraktikaMatches(item);

  const clinicalReviewRequired = isClinicalReviewRequired(item);
  const safeConfirmedMatch = isSafeConfirmedPraktikaMatch(item);
  const praktikaFilingComplete = isPraktikaFilingComplete(item);
  const emailComplete = isEmailComplete(item);
  const trelloComplete = isTrelloComplete(item);

  const ocrPending =
    item.attachment_needs_ocr === true ||
    item.attachment_extraction_status === "ocr_needed" ||
    item.attachment_extraction_status === "ocr_partially_completed";

  const matchedRules = rules.map((rule) => ({
    id: rule.id,
    title: rule.title,
    category: rule.category,
    rule_type: rule.rule_type,
    priority: rule.priority,
  }));

  const preview: AutomationPreview = {
    ok: true,
    status: "review",
    inboxItemId,
    summary: "Automation preview calculated from active AI learning rules.",
    matchedRules,
    allowedActions: [],
    blockedActions: [],
    blockedReasons: [],
    warnings: [],
    facts: {
      workflow_kind: item.workflow_kind,
      classification_v2_workflow_kind: item.classification_v2_workflow_kind,
      praktika_patient_id: item.praktika_patient_id,
      praktika_match_status: item.praktika_match_status,
      praktika_match_confidence: item.praktika_match_confidence,
      praktika_match_candidates_count: candidates.length,
      praktika_exact_match_count: exactMatches.length,
      duplicate_exact_praktika_matches: duplicateExactMatches,
      attachment_count: attachments.length,
      praktika_filing_status: item.praktika_filing_status,
      clinical_review_required: clinicalReviewRequired,
      ocr_pending: ocrPending,
      trello_complete: trelloComplete,
      email_complete: emailComplete,
      archived: Boolean(item.archived_at),
      active_automation_rules_count: rules.length,
    },
  };

  const hasFileRule = rules.some((rule) =>
    ruleLooksRelevantToAction(String(rule.rule || ""), "file_to_praktika"),
  );

  const hasArchiveRule = rules.some((rule) =>
    ruleLooksRelevantToAction(String(rule.rule || ""), "archive"),
  );

  if (item.archived_at) {
    pushBlocked(preview, "file_to_praktika", "Item is already archived.");
    pushBlocked(preview, "archive", "Item is already archived.");
  }

  if (rules.length === 0) {
    pushBlocked(
      preview,
      "file_to_praktika",
      "No active automation learning rules found.",
    );
    pushBlocked(preview, "archive", "No active automation learning rules found.");
  }

  if (!hasFileRule) {
    pushBlocked(
      preview,
      "file_to_praktika",
      "No active automation rule allows filing to Praktika.",
    );
  }

  if (!hasArchiveRule) {
    preview.warnings.push(
      "No active archive automation rule found. Auto-archive will remain blocked.",
    );
  }

  if (!safeConfirmedMatch) {
    if (!item.praktika_patient_id) {
      pushBlocked(preview, "file_to_praktika", "No Praktika patient selected.");
    } else if (
      item.praktika_match_status !== "matched_existing" &&
      item.praktika_match_status !== "confirmed_manual"
    ) {
      pushBlocked(
        preview,
        "file_to_praktika",
        "Praktika match has not been confidently confirmed.",
      );
    } else if (Number(item.praktika_match_confidence || 0) < 1) {
      pushBlocked(
        preview,
        "file_to_praktika",
        "Praktika match confidence is below 100%.",
      );
    } else if (duplicateExactMatches) {
      pushBlocked(
        preview,
        "file_to_praktika",
        "Multiple exact Praktika patient matches were found.",
      );
    }
  }

  if (attachments.length === 0) {
    pushBlocked(preview, "file_to_praktika", "No imported attachments found.");
  }

  if (ocrPending) {
    pushBlocked(
      preview,
      "file_to_praktika",
      "OCR or attachment processing is still pending.",
    );
    pushBlocked(preview, "archive", "OCR or attachment processing is still pending.");
  }

  if (clinicalReviewRequired) {
    pushBlocked(preview, "file_to_praktika", "Clinical review is required.");
    pushBlocked(preview, "archive", "Clinical review is required.");
  }

  if (praktikaFilingComplete) {
    preview.warnings.push("Praktika filing is already completed.");
  }

  const filingBlocked = preview.blockedActions.some(
    (blocked) => blocked.action === "file_to_praktika",
  );

  if (!filingBlocked && !praktikaFilingComplete) {
    preview.allowedActions.push("file_to_praktika");
  }

  if (!hasArchiveRule) {
    pushBlocked(preview, "archive", "No active automation rule allows archiving.");
  }

  if (!praktikaFilingComplete) {
    pushBlocked(preview, "archive", "Praktika filing is not complete yet.");
  }

  if (!trelloComplete) {
    pushBlocked(preview, "archive", "Trello/reception task is not complete yet.");
  }

  if (!emailComplete) {
    pushBlocked(
      preview,
      "archive",
      "Email is not sent and has not been marked no-reply.",
    );
  }

  const archiveBlocked = preview.blockedActions.some(
    (blocked) => blocked.action === "archive",
  );

  if (!archiveBlocked && !item.archived_at) {
    preview.allowedActions.push("archive");
  }

  if (preview.allowedActions.length > 0 && preview.blockedReasons.length === 0) {
    preview.status = "safe";
    preview.summary = "Safe automation actions are available.";
  } else if (preview.allowedActions.length > 0) {
    preview.status = "review";
    preview.summary =
      "Some safe automation actions are available, but others are blocked.";
  } else {
    preview.status = "blocked";
    preview.summary = "Automation is blocked by safety gates.";
  }

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      automation_preview: preview,
    })
    .eq("id", inboxItemId);

  return preview;
}