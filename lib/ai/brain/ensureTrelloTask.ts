import { routeClinicianForInboxItem } from "@/lib/ai/brain/clinicianRouting";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  addCommentToTrelloCard,
  addUrlAttachmentToTrelloCard,
  createTrelloCard,
  getTrelloConfig,
} from "@/lib/trello/client";

type EnsureTrelloTaskOptions = {
  inboxItemId: string;
  reason?: string;
  force?: boolean;
  minimumConfidence?: number;
};

type ImportedAttachment = {
  name?: string | null;
  bucket?: string | null;
  storage_path?: string | null;
  content_type?: string | null;
  imported?: boolean | null;
  ocr_status?: string | null;
  extraction_status?: string | null;
  text_extracted?: boolean | null;
};

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

function normalise(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function latestDecisionFromItem(item: any) {
  const cases = Array.isArray(item.ai_cases) ? item.ai_cases : [];

  const decisions = cases.flatMap((aiCase: any) =>
    Array.isArray(aiCase?.ai_decisions)
      ? aiCase.ai_decisions.map((decision: any) => ({
          ...decision,
          case_id: aiCase.id,
        }))
      : []
  );

  const latest =
    decisions
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
      )[0] || null;

  return latest?.decision || null;
}

function getLatestCaseId(item: any) {
  const cases = Array.isArray(item.ai_cases) ? item.ai_cases : [];

  return (
    cases
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.updated_at || b.created_at || 0).getTime() -
          new Date(a.updated_at || a.created_at || 0).getTime()
      )[0]?.id || null
  );
}

function hasPendingOcr(item: any) {
  if (item.attachment_needs_ocr === true) return true;

  const status = String(item.attachment_extraction_status || "");

  return status === "ocr_needed" || status === "ocr_partially_completed";
}

function getSourceText(item: any) {
  return [
    item.email_subject,
    item.subject,
    item.email_body,
    item.raw_text,
    item.body,
    item.extracted_text,
    item.summary,
    item.suggested_action,
    item.category,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isExistingPatientCorrespondence({
  item,
  decision,
}: {
  item: any;
  decision: any;
}) {
  const text = normalise(getSourceText(item));

  const category = normalise(item.category || decision?.category);
  const intent = normalise(decision?.operational_intent);

  const explicitExisting =
    text.includes("existing patient") ||
    text.includes("current patient") ||
    text.includes("patient of dr") ||
    text.includes("follow up") ||
    text.includes("review correspondence") ||
    text.includes("correspondence received") ||
    text.includes("records request") ||
    text.includes("records transfer") ||
    text.includes("transfer records") ||
    text.includes("medical records") ||
    text.includes("clinical update") ||
    text.includes("letter regarding") ||
    text.includes("regarding patient");

  const patientMatchExists =
    item.match_status === "auto_confirmed" ||
    item.match_status === "confirmed" ||
    Boolean(item.matched_patient_id) ||
    Boolean(item.patient_match_confirmed_at);

  const notNewReferral =
    category !== "new referral" &&
    category !== "new_referral" &&
    intent !== "new referral" &&
    intent !== "new_referral";

  return explicitExisting || (patientMatchExists && notNewReferral);
}

function isRoutineReferral({
  item,
  decision,
  routing,
}: {
  item: any;
  decision: any;
  routing: any;
}) {
  const category = normalise(item.category || decision?.category);
  const intent = normalise(decision?.operational_intent);
  const text = normalise(getSourceText(item));

  if (routing.routing_key === "urgent_clinical") return false;
  if (routing.routing_key === "radiology_review") return false;
  if (routing.routing_key === "pathology_review") return false;

  const hasReferral =
    category.includes("new referral") ||
    category.includes("new_referral") ||
    intent.includes("new referral") ||
    intent.includes("new_referral") ||
    text.includes("referral") ||
    text.includes("referred");

  const unusualWords = [
    "urgent",
    "unusual",
    "complex",
    "complication",
    "infection",
    "swelling",
    "pain",
    "bleeding",
    "pathology",
    "radiology",
    "cbct",
    "opg",
    "biopsy",
    "lesion",
    "cyst",
    "tumour",
    "tumor",
    "fracture",
    "trauma",
  ];

  const unusual = unusualWords.some((word) => text.includes(word));

  return hasReferral && !unusual;
}

function shouldAutoCreateTrelloTask({
  item,
  decision,
  routing,
  minimumConfidence,
  force,
}: {
  item: any;
  decision: any;
  routing: any;
  minimumConfidence: number;
  force: boolean;
}) {
  if (force) {
    return {
      shouldCreate: true,
      reason: "Manual/forced Trello task creation.",
    };
  }

  if (item.source === "manual_upload" && item.status === "pending") {
    return {
      shouldCreate: false,
      reason: "Skipping old/manual upload that has not been analysed.",
    };
  }

  if (!getSourceText(item).trim() && !item.summary) {
    return {
      shouldCreate: false,
      reason: "Skipping item with no extracted text or AI summary.",
    };
  }

  if (item.trello_card_id || item.trello_card_url) {
    return {
      shouldCreate: false,
      reason: "Trello task already exists.",
    };
  }

  if (hasPendingOcr(item)) {
    return {
      shouldCreate: false,
      reason: "Attachment OCR is still pending.",
    };
  }

  if (!routing?.trello_list_id) {
    return {
      shouldCreate: false,
      reason: "No Trello list was selected by routing.",
    };
  }

  if (String(routing.trello_list_id).startsWith("REPLACE_WITH_")) {
    return {
      shouldCreate: false,
      reason:
        "Routing rule still contains a placeholder Trello list ID. Update ai_specialist_routing_rules.",
    };
  }

  if (routing.confidence < minimumConfidence) {
    return {
      shouldCreate: false,
      reason: `Routing confidence ${routing.confidence} is below minimum ${minimumConfidence}.`,
    };
  }

  if (routing.routing_key === "urgent_clinical") {
    return {
      shouldCreate: true,
      reason: "Urgent/high-risk clinical item.",
    };
  }

  if (routing.routing_key === "radiology_review") {
    return {
      shouldCreate: true,
      reason: "Radiology result/correspondence received.",
    };
  }

  if (routing.routing_key === "pathology_review") {
    return {
      shouldCreate: true,
      reason: "Pathology result/correspondence received.",
    };
  }

  if (
    routing.routing_key === "general_clinical" &&
    isExistingPatientCorrespondence({ item, decision })
  ) {
    return {
      shouldCreate: true,
      reason: "Existing patient correspondence received.",
    };
  }

  if (isRoutineReferral({ item, decision, routing })) {
    return {
      shouldCreate: false,
      reason:
        "Routine referral detected. Trello task is not automatically created for routine referrals.",
    };
  }

  const missing = Array.isArray(decision?.missing_information)
    ? decision.missing_information
    : [];

  if (missing.length > 0) {
    return {
      shouldCreate: true,
      reason: `Referral/correspondence needs follow-up: ${missing.join(", ")}.`,
    };
  }

  if (decision?.requires_clinical_review === true) {
    return {
      shouldCreate: true,
      reason: "Clinical review required.",
    };
  }

  return {
    shouldCreate: false,
    reason:
      "No automatic Trello trigger matched. This appears to be routine correspondence/referral.",
  };
}

function cleanPatientName(value: string | null | undefined) {
  const name = String(value || "").trim();

  if (!name || name.toLowerCase() === "unknown") return "";

  return name;
}

function buildCardTitle({
  item,
  decision,
  routing,
}: {
  item: any;
  decision: any;
  routing: any;
}) {
  const patientName =
    cleanPatientName(item.patient_name) ||
    cleanPatientName(decision?.patient_name);

  if (patientName) return patientName;

  const subject = String(
    item.email_subject || item.subject || item.file_name || "Unknown patient"
  ).trim();

  if (subject.length <= 80) return subject;

  return subject.slice(0, 77) + "...";
}

function getSenderDisplay(item: any) {
  if (item.sender_name && item.sender_email) {
    return `${item.sender_name} <${item.sender_email}>`;
  }

  return item.sender_name || item.sender_email || "Unknown sender";
}

function buildHumanTaskSentence({
  item,
  decision,
  routing,
}: {
  item: any;
  decision: any;
  routing: any;
}) {
  const patientName =
    cleanPatientName(item.patient_name) ||
    cleanPatientName(decision?.patient_name) ||
    "this patient";

  const senderName =
    item.sender_name ||
    item.sender_email ||
    "the sender";

  if (routing.routing_key === "radiology_review") {
    return `Radiology correspondence received from ${senderName} regarding ${patientName}.`;
  }

  if (routing.routing_key === "pathology_review") {
    return `Pathology correspondence received from ${senderName} regarding ${patientName}.`;
  }

  if (routing.routing_key === "urgent_clinical") {
    return `Urgent clinical correspondence received from ${senderName} regarding ${patientName}.`;
  }

  return `Correspondence received from ${senderName} regarding ${patientName}.`;
}

function buildCardDescription({
  item,
  decision,
  routing,
  eligibilityReason,
}: {
  item: any;
  decision: any;
  routing: any;
  eligibilityReason: string;
}) {
  const missingInformation = Array.isArray(decision?.missing_information)
    ? decision.missing_information.join(", ")
    : "";

  const taskSentence = buildHumanTaskSentence({
    item,
    decision,
    routing,
  });

  const summary =
    item.summary ||
    decision?.summary ||
    "No AI summary available. Please review the attached correspondence.";

  const suggestedAction =
    item.suggested_action ||
    decision?.suggested_action ||
    decision?.recommended_next_step ||
    "Review the correspondence and attached files.";

  return [
    taskSentence,
    "",
    "AI summary:",
    summary,
    "",
    "Suggested action:",
    suggestedAction,
    "",
    "Workflow:",
    `- Bucket: ${routing.display_name || routing.routing_key}`,
    `- Trello trigger: ${eligibilityReason}`,
    `- Urgency: ${routing.urgency || "unknown"}`,
    `- Routing confidence: ${routing.confidence ?? "unknown"}`,
    "",
    "Patient:",
    `- Name: ${item.patient_name || decision?.patient_name || "Unknown"}`,
    `- DOB: ${item.patient_dob || decision?.patient_dob || "Unknown"}`,
    "",
    "Sender:",
    `- ${getSenderDisplay(item)}`,
    "",
    missingInformation ? "Missing information:" : "",
    missingInformation ? `- ${missingInformation}` : "",
    "",
    item.source_email_url ? `Outlook email: ${item.source_email_url}` : "",
    item.outlook_web_link ? `Outlook draft/email: ${item.outlook_web_link}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function getImportedAttachments(item: any): ImportedAttachment[] {
  const attachmentDebug = parseJsonMaybe(item.attachment_debug);
  const importedAttachments = attachmentDebug?.imported_attachments || [];

  if (Array.isArray(importedAttachments)) {
    return importedAttachments.filter(
      (attachment) => attachment?.storage_path && attachment?.imported !== false
    );
  }

  if (item.file_path) {
    return [
      {
        name: item.file_name || "Document",
        bucket: "ai-reception",
        storage_path: item.file_path,
        content_type: "application/pdf",
        imported: true,
      },
    ];
  }

  return [];
}

async function createSignedAttachmentUrl(attachment: ImportedAttachment) {
  const bucket =
    attachment.bucket ||
    process.env.OUTLOOK_ATTACHMENT_STORAGE_BUCKET ||
    "ai-reception";

  if (!attachment.storage_path) {
    throw new Error("Attachment storage_path is missing.");
  }

  const expiresInSeconds = Number(
    process.env.TRELLO_ATTACHMENT_SIGNED_URL_SECONDS || 60 * 60 * 24 * 7
  );

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(attachment.storage_path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || "Failed to create signed attachment URL.");
  }

  return data.signedUrl;
}

async function attachFilesToTrelloCard({
  cardId,
  item,
}: {
  cardId: string;
  item: any;
}) {
  const attachments = getImportedAttachments(item);

  const results: any[] = [];

  for (const attachment of attachments) {
    try {
      const signedUrl = await createSignedAttachmentUrl(attachment);

      const trelloAttachment = await addUrlAttachmentToTrelloCard({
        cardId,
        url: signedUrl,
        name: attachment.name || "Attachment",
      });

      results.push({
        success: true,
        attachment_name: attachment.name,
        trello_attachment_id: trelloAttachment.id,
      });
    } catch (error) {
      results.push({
        success: false,
        attachment_name: attachment.name,
        error:
          error instanceof Error
            ? error.message
            : "Failed to attach file to Trello card.",
      });
    }
  }

  return results;
}

async function loadInboxItem(inboxItemId: string) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(
      `
      *,
      ai_cases (
        *,
        ai_decisions (*)
      )
    `
    )
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  return item;
}

async function markAutoTaskStatus({
  inboxItemId,
  status,
  reason,
  error,
}: {
  inboxItemId: string;
  status: string;
  reason?: string | null;
  error?: string | null;
}) {
  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      trello_auto_task_status: status,
      trello_auto_task_reason: reason || null,
      trello_auto_task_error: error || null,
      trello_auto_task_attempted_at: new Date().toISOString(),
    })
    .eq("id", inboxItemId);
}

export async function ensureTrelloTaskForInboxItem({
  inboxItemId,
  reason = "Automatically created from AI Reception workflow.",
  force = false,
  minimumConfidence = Number(process.env.TRELLO_AUTO_TASK_MIN_CONFIDENCE || 0.6),
}: EnsureTrelloTaskOptions) {
  const item = await loadInboxItem(inboxItemId);

  if (!force && (item.trello_card_id || item.trello_card_url)) {
    return {
      success: true,
      skipped: true,
      reason: "Trello task already exists.",
      trello_card_id: item.trello_card_id,
      trello_card_url: item.trello_card_url,
      item,
    };
  }

  const decision = latestDecisionFromItem(item);
  const caseId = getLatestCaseId(item);

 const clinicianRouting = await routeClinicianForInboxItem({
  inboxItemId,
  persist: true,
});

const routing = {
  routing_key: clinicianRouting.workflow_kind,
  display_name:
    clinicianRouting.clinician_name ||
    clinicianRouting.workflow_kind ||
    "AI Reception routing",
  trello_board_id:
    clinicianRouting.trello_board_id || item.trello_board_id || null,
  trello_list_id:
    clinicianRouting.trello_list_id || item.trello_list_id || null,
  confidence: clinicianRouting.confidence || 0,
  urgency:
    clinicianRouting.workflow_kind === "urgent_clinical"
      ? "urgent"
      : "normal",
  reason: clinicianRouting.reason,
  clinician_key: clinicianRouting.clinician_key,
  clinician_name: clinicianRouting.clinician_name,
};

  const eligibility = shouldAutoCreateTrelloTask({
    item,
    decision,
    routing,
    minimumConfidence,
    force,
  });

  if (!eligibility.shouldCreate) {
    await markAutoTaskStatus({
      inboxItemId,
      status: "skipped",
      reason: eligibility.reason,
      error: null,
    });

    return {
      success: true,
      skipped: true,
      reason: eligibility.reason,
      routing,
      item,
    };
  }

  const config = getTrelloConfig();

  const listId =
    routing.trello_list_id ||
    item.trello_list_id ||
    config.defaultListId;

  const title = buildCardTitle({
    item,
    decision,
    routing,
  });

  const description = buildCardDescription({
    item,
    decision,
    routing,
    eligibilityReason: eligibility.reason,
  });

  const card = await createTrelloCard({
    idList: listId,
    name: title,
    desc: description,
    due: null,
    pos: "top",
  });

  let attachmentResults: any[] = [];
  let attachmentStatus = "not_attempted";
  let attachmentError: string | null = null;

  try {
    attachmentResults = await attachFilesToTrelloCard({
      cardId: card.id,
      item,
    });

    const failed = attachmentResults.filter((result) => !result.success);

    attachmentStatus =
      attachmentResults.length === 0
        ? "no_attachments"
        : failed.length === 0
        ? "attached"
        : "partially_failed";

    attachmentError =
      failed.length > 0
        ? failed.map((result) => result.error).join("; ")
        : null;
  } catch (error) {
    attachmentStatus = "failed";
    attachmentError =
      error instanceof Error
        ? error.message
        : "Failed to attach files to Trello card.";
  }

  try {
    await addCommentToTrelloCard({
      cardId: card.id,
      text: [
        "AI Reception note:",
        buildHumanTaskSentence({
          item,
          decision,
          routing,
        }),
        "",
        `Created automatically because: ${eligibility.reason}`,
      ].join("\n"),
    });
  } catch (error) {
    console.warn("Trello card was created, but comment failed:", error);
  }

  const { data: updatedItem, error: updateError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      trello_card_id: card.id,
      trello_card_url: card.shortUrl || card.url || null,
      trello_card_created_at: new Date().toISOString(),
      trello_board_id: routing.trello_board_id || null,
      trello_list_id: listId,
      specialist_routing_status: "trello_task_created",
      trello_auto_task_status: "created",
      trello_auto_task_reason: eligibility.reason,
      trello_auto_task_error: null,
      trello_auto_task_attempted_at: new Date().toISOString(),
      trello_attachment_upload_status: attachmentStatus,
      trello_attachment_upload_error: attachmentError,
    })
    .eq("id", inboxItemId)
    .select("*")
    .single();

  if (updateError) {
    await markAutoTaskStatus({
      inboxItemId,
      status: "created_but_db_update_failed",
      reason: eligibility.reason,
      error: updateError.message,
    });

    throw new Error(
      "Trello card was created but database update failed: " +
        updateError.message
    );
  }

  await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    case_id: caseId,
    actor_id: null,
    event_type: force
      ? "trello_task_created_manual"
      : "trello_task_created_auto",
    event_summary: `Trello task created: ${title}`,
    previous_values: {},
    new_values: {
      trello_card_id: card.id,
      trello_card_url: card.shortUrl || card.url || null,
      recommended_specialist: routing.clinician_name || routing.routing_key,
      trello_list_id: listId,
    },
    metadata: {
      force,
      reason,
      eligibility,
      routing,
      list_id: listId,
      card,
      attachment_results: attachmentResults,
      attachment_status: attachmentStatus,
      attachment_error: attachmentError,
    },
  });

  if (caseId) {
    await supabaseAdmin.from("ai_case_events").insert({
      case_id: caseId,
      event_type: force
        ? "trello_task_created_manual"
        : "trello_task_created_auto",
      event_summary: `Trello task created: ${title}`,
      metadata: {
        inbox_item_id: inboxItemId,
        trello_card_id: card.id,
        trello_card_url: card.shortUrl || card.url || null,
        reason,
        eligibility,
        routing,
        list_id: listId,
        attachment_results: attachmentResults,
      },
    });
  }

  return {
    success: true,
    skipped: false,
    message: "Trello task created.",
    trello_card_id: card.id,
    trello_card_url: card.shortUrl || card.url || null,
    routing,
    eligibility,
    attachment_results: attachmentResults,
    attachment_status: attachmentStatus,
    attachment_error: attachmentError,
    card,
    item: updatedItem,
  };
}
