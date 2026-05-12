import { supabaseAdmin } from "@/lib/supabase/admin";
import { autoFileInboxItemToPraktika } from "@/lib/ai/brain/praktikaAutoFile";
import { createPraktikaReferralFromInboxItem } from "@/lib/ai/brain/praktikaReferral";
import {
  archiveOutlookMessage,
  findSentMessageByConversationId,
  outlookSharedMailbox,
  sendOutlookDraft,
} from "@/lib/microsoft/graph";

type Actor = {
  userId?: string | null;
  email?: string | null;
  fullName?: string | null;
  initials?: string | null;
};

function getReferrerPartyId(item: any) {
  return (
    item.praktika_referrer_party_id ||
    item.praktika_matched_referrer_party_id ||
    item.referrer_party_id ||
    item.praktika_referral_party_id ||
    null
  );
}

function buildReferralReason(item: any) {
  return String(
    item.extracted_referral_reason ||
      item.classification_v2_summary ||
      item.summary ||
      "Referral received",
  ).trim();
}

function buildReferralNotes(item: any) {
  const lines = [
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
    item.extracted_referrer_address
      ? `Address: ${item.extracted_referrer_address}`
      : null,
    item.email_subject ? `Source email: ${item.email_subject}` : null,
  ];

  return lines.filter(Boolean).join("\n");
}

async function writeAuditEvent({
  inboxItemId,
  eventType,
  eventLabel,
  actor,
  details,
}: {
  inboxItemId: string;
  eventType: string;
  eventLabel: string;
  actor?: Actor;
  details?: Record<string, any>;
}) {
  const { error } = await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    event_type: eventType,
    event_label: eventLabel,
    actor_user_id: actor?.userId || null,
    actor_email: actor?.email || null,
    actor_full_name: actor?.fullName || null,
    actor_initials: actor?.initials || null,
    details: details || {},
    metadata: details || {},
  });

  if (error) {
    console.error("Referral workflow audit insert failed:", error);
  }
}

function filingLooksComplete(item: any, filingResult: any) {
  return (
    item.praktika_filing_status === "completed" ||
    filingResult?.ok === true ||
    Boolean(filingResult?.filedAt)
  );
}

function isLowRiskSafeReply(item: any) {
  const workflowKind = String(
    item.classification_v2_workflow_kind || item.workflow_kind || "",
  );

  const isAllowedWorkflow = [
    "new_referral",
    "existing_patient_correspondence",
  ].includes(workflowKind);

  const noClinicalReview =
    item.classification_v2_requires_clinical_review !== true &&
    item.workflow_kind !== "urgent_clinical" &&
    item.classification_v2_workflow_kind !== "urgent_clinical";

  const lowRisk =
    !item.latest_decision?.risk_level ||
    String(item.latest_decision?.risk_level || "low").toLowerCase() === "low";

  return isAllowedWorkflow && noClinicalReview && lowRisk;
}

async function maybeSendSafeOutlookDraft({
  inboxItemId,
  actor,
}: {
  inboxItemId: string;
  actor?: Actor;
}) {
  const now = new Date().toISOString();

  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    return { ok: false, sent: false, reason: error?.message || "Item not found." };
  }

  if (!isLowRiskSafeReply(item)) {
    return {
      ok: true,
      sent: false,
      reason: "Reply was not automatically sent because safety gates did not pass.",
    };
  }

  if (!item.outlook_draft_id) {
    return {
      ok: true,
      sent: false,
      reason: "No Outlook draft exists to send.",
    };
  }

  if (item.outlook_auto_send_status === "sent" || item.sent_detected_at) {
    return {
      ok: true,
      sent: false,
      reason: "Email already appears to have been sent.",
    };
  }

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      outlook_auto_send_status: "running",
      outlook_auto_send_error: null,
    })
    .eq("id", inboxItemId);

  try {
    const sendResult = await sendOutlookDraft({
      mailbox: outlookSharedMailbox,
      draftMessageId: item.outlook_draft_id,
    });

    let sentMessage = null;

    if (item.outlook_conversation_id) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      sentMessage = await findSentMessageByConversationId({
        mailbox: outlookSharedMailbox,
        conversationId: item.outlook_conversation_id,
      });
    }

    const result = {
      sendResult,
      sentMessage,
      sentAt: now,
    };

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        outlook_auto_send_status: "sent",
        outlook_auto_sent_at: now,
        outlook_auto_send_error: null,
        outlook_auto_send_result: result,
        email_status: "sent",
        sent_detected_at: sentMessage?.sentDateTime || now,
        sent_detection_method: "automatic_graph_draft_send",
        outlook_sent_message_id: sentMessage?.id || null,
        outlook_sent_web_link: sentMessage?.webLink || null,
      })
      .eq("id", inboxItemId);

    await writeAuditEvent({
      inboxItemId,
      eventType: "outlook_auto_reply_sent",
      eventLabel: "Outlook reply sent automatically",
      actor,
      details: result,
    });

    return { ok: true, sent: true, result };
  } catch (error: any) {
    const message = error?.message || "Failed to send Outlook draft.";

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        outlook_auto_send_status: "failed",
        outlook_auto_send_error: message,
      })
      .eq("id", inboxItemId);

    await writeAuditEvent({
      inboxItemId,
      eventType: "outlook_auto_reply_send_failed",
      eventLabel: "Outlook automatic reply failed",
      actor,
      details: { error: message },
    });

    return { ok: false, sent: false, error: message };
  }
}

async function archiveCompletedReferralItem({
  inboxItemId,
  actor,
  filingResult,
  archiveOutlook = true,
}: {
  inboxItemId: string;
  actor?: Actor;
  filingResult: any;
  archiveOutlook?: boolean;
}) {
  const now = new Date().toISOString();

  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    return {
      ok: false,
      archived: false,
      blockers: [error?.message || "Inbox item not found."],
    };
  }

  const blockers: string[] = [];

  if (item.archived_at) blockers.push("Already archived.");
  if (!item.praktika_patient_id) blockers.push("No Praktika patient.");
  if (!item.praktika_referral_id) blockers.push("No Praktika referral created.");
  if (!filingLooksComplete(item, filingResult)) {
    blockers.push("Attachments have not been filed.");
  }
  if (
    item.classification_v2_requires_clinical_review === true ||
    item.workflow_kind === "urgent_clinical"
  ) {
    blockers.push("Clinical review is required.");
  }

  if (blockers.length > 0) {
    return { ok: false, archived: false, blockers };
  }

  let outlookArchiveResult: any = null;
  let outlookArchiveError: string | null = null;

  if (archiveOutlook && item.source_email_message_id) {
    try {
      outlookArchiveResult = await archiveOutlookMessage({
        mailbox: outlookSharedMailbox,
        messageId: item.source_email_message_id,
      });
    } catch (error: any) {
      outlookArchiveError = error?.message || "Outlook archive failed.";
    }
  }

  const { data: updatedItem, error: updateError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      archived_at: now,
      archived_by: actor?.userId || null,
      archive_reason: "Completed referral workflow archived automatically.",
      status: "archived",
      praktika_filing_status: item.praktika_filing_status || "completed",
      praktika_filed_at: item.praktika_filed_at || filingResult?.filedAt || now,
      praktika_filing_error: null,
      outlook_archive_status: outlookArchiveError
        ? "failed"
        : outlookArchiveResult
          ? "archived"
          : "skipped",
      outlook_archive_error: outlookArchiveError,
      outlook_archived_at: outlookArchiveResult ? now : null,
      outlook_archive_result: outlookArchiveResult || {},
    })
    .eq("id", inboxItemId)
    .select("*")
    .single();

  if (updateError) {
    return { ok: false, archived: false, blockers: [updateError.message] };
  }

  await writeAuditEvent({
    inboxItemId,
    eventType: "completed_referral_auto_archived",
    eventLabel: "Completed referral item archived",
    actor,
    details: {
      archived_at: now,
      outlookArchiveResult,
      outlookArchiveError,
    },
  });

  return {
    ok: true,
    archived: true,
    item: updatedItem,
    blockers: [],
    outlookArchiveResult,
    outlookArchiveError,
  };
}

export async function completeReferralWorkflowForInboxItem({
  inboxItemId,
  actor,
  forceFile = false,
  createReferral = true,
  fileAttachments = true,
  autoSendSafeEmail = false,
  archiveOutlook = true,
}: {
  inboxItemId: string;
  actor?: Actor;
  forceFile?: boolean;
  createReferral?: boolean;
  fileAttachments?: boolean;
  autoSendSafeEmail?: boolean;
  archiveOutlook?: boolean;
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
      "Create or confirm the Praktika patient before completing the referral workflow.",
    );
  }

  const partyId = getReferrerPartyId(item);

  if (createReferral && !item.praktika_referral_id && !partyId) {
    throw new Error("Match/select a Praktika referrer before creating the referral.");
  }

  const startedAt = new Date().toISOString();

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      referral_workflow_status: "running",
      referral_workflow_started_at: startedAt,
      referral_workflow_error: null,
    })
    .eq("id", inboxItemId);

  await writeAuditEvent({
    inboxItemId,
    eventType: "referral_workflow_started",
    eventLabel: "Referral workflow started",
    actor,
    details: {
      patientId: item.praktika_patient_id,
      partyId,
      createReferral,
      fileAttachments,
      autoSendSafeEmail,
      archiveOutlook,
      startedAt,
    },
  });

  try {
    let referralResult: any = null;
    let filingResult: any = null;

    if (createReferral) {
      if (item.praktika_referral_id) {
        referralResult = {
          ok: true,
          skipped: true,
          reason: "Referral already exists.",
          referralId: item.praktika_referral_id,
        };
      } else {
        referralResult = await createPraktikaReferralFromInboxItem({
          inboxItemId,
          partyId: String(partyId),
          reason: buildReferralReason(item),
          notes: buildReferralNotes(item),
        });
      }
    }

    if (fileAttachments) {
      filingResult = await autoFileInboxItemToPraktika({
        inboxItemId,
        force: forceFile,
      });
    }

    const emailResult = autoSendSafeEmail
      ? await maybeSendSafeOutlookDraft({ inboxItemId, actor })
      : {
          ok: true,
          sent: false,
          reason: "Automatic email sending was not requested.",
        };

    const completedAt = new Date().toISOString();

    const result = {
      referralResult,
      filingResult,
      emailResult,
      completedAt,
      autoArchiveResult: null as any,
    };

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        referral_workflow_status: "completed",
        referral_workflow_completed_at: completedAt,
        referral_workflow_error: null,
        referral_workflow_result: result,
      })
      .eq("id", inboxItemId);

    const autoArchiveResult = await archiveCompletedReferralItem({
      inboxItemId,
      actor,
      filingResult,
      archiveOutlook,
    });

    result.autoArchiveResult = autoArchiveResult;

    const { data: finalItem, error: finalItemError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        referral_workflow_status: "completed",
        referral_workflow_completed_at: completedAt,
        referral_workflow_error: null,
        referral_workflow_result: result,
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (finalItemError) {
      throw new Error(finalItemError.message);
    }

    await writeAuditEvent({
      inboxItemId,
      eventType: "referral_workflow_completed",
      eventLabel: "Referral workflow completed",
      actor,
      details: result,
    });

    return {
      ok: true,
      status: "completed",
      result,
      item: finalItem,
      archived: autoArchiveResult.archived === true,
      emailSent: emailResult.sent === true,
    };
  } catch (error: any) {
    const message = error?.message || "Referral workflow failed.";

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        referral_workflow_status: "failed",
        referral_workflow_error: message,
      })
      .eq("id", inboxItemId);

    await writeAuditEvent({
      inboxItemId,
      eventType: "referral_workflow_failed",
      eventLabel: "Referral workflow failed",
      actor,
      details: { error: message },
    });

    throw error;
  }
}
