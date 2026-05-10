import { NextResponse } from "next/server";

import { processImportedInboxItem } from "@/lib/ai/brain/processImportedInboxItem";
import { requireRole } from "@/lib/auth";
import {
  getMessageAttachment,
  listMessageAttachments,
  listRecentInboxMessages,
  outlookSharedMailbox,
} from "@/lib/microsoft/graph";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const attachmentBucket =
  process.env.OUTLOOK_ATTACHMENT_STORAGE_BUCKET || "ai-reception";

const MIN_USEFUL_ATTACHMENT_TEXT_LENGTH = Number(
  process.env.MIN_USEFUL_ATTACHMENT_TEXT_LENGTH || 80
);

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: string) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getMessageText(message: any) {
  const bodyContent = message.body?.content || "";

  const bodyText =
    message.body?.contentType?.toLowerCase() === "html"
      ? stripHtml(bodyContent)
      : bodyContent;

  return cleanText(bodyText || message.bodyPreview || "");
}

function safeFileName(value: string) {
  return (
    value
      .replace(/[^\w.\-() ]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 160) || "attachment"
  );
}

function getFileExtension(path: string) {
  const cleanPath = path.split("?")[0] || "";
  const parts = cleanPath.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "";
}

function isPdfFile({
  filePath,
  contentType,
}: {
  filePath: string;
  contentType: string | null;
}) {
  const extension = getFileExtension(filePath);
  return Boolean(contentType?.includes("pdf") || extension === "pdf");
}

function isImageFile({
  filePath,
  contentType,
}: {
  filePath: string;
  contentType: string | null;
}) {
  const extension = getFileExtension(filePath);
  return Boolean(
    contentType?.startsWith("image/") ||
      ["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp"].includes(extension)
  );
}

async function extractPdfText(buffer: Buffer) {
  try {
    // Prefer unpdf because it works better with Next/serverless than pdf-parse.
    const { extractText, getDocumentProxy } = await import("unpdf");

    const pdf = await getDocumentProxy(new Uint8Array(buffer));

    const result = await extractText(pdf, {
      mergePages: true,
    });

    return cleanText(result.text || "");
  } catch (error) {
    console.warn("PDF parse during Outlook import failed:", error);
    return "";
  }
}

async function extractTextFromBuffer({
  buffer,
  filePath,
  contentType,
}: {
  buffer: Buffer;
  filePath: string;
  contentType: string | null;
}) {
  const extension = getFileExtension(filePath);

  if (contentType?.includes("pdf") || extension === "pdf") {
    return extractPdfText(buffer);
  }

  if (
    contentType?.includes("text/plain") ||
    extension === "txt" ||
    extension === "csv"
  ) {
    return cleanText(buffer.toString("utf8"));
  }

  return "";
}

function buildImportedAttachment({
  attachment,
  storagePath,
  contentType,
  extractedText,
  attachmentNeedsOcr,
  isImageAttachment,
}: {
  attachment: any;
  storagePath: string;
  contentType: string | null;
  extractedText: string;
  attachmentNeedsOcr: boolean;
  isImageAttachment: boolean;
}) {
  return {
    outlook_attachment_id: attachment.id,
    name: attachment.name || null,
    content_type: contentType,
    size: attachment.size || null,
    bucket: attachmentBucket,
    storage_path: storagePath,
    imported: true,
    text_extracted: Boolean(extractedText),
    extracted_text: extractedText || null,
    extracted_character_count: extractedText.length,
    extraction_status: attachmentNeedsOcr
      ? isImageAttachment
        ? "ocr_needed_image"
        : "parsed_too_little_text_ocr_needed"
      : Boolean(extractedText)
      ? "text_extracted"
      : "no_extractable_text",
    needs_ocr: attachmentNeedsOcr,
    ocr_status: attachmentNeedsOcr ? "needed" : "not_needed",
    ocr_error: attachmentNeedsOcr
      ? isImageAttachment
        ? "Image attachment requires OCR."
        : `PDF/text parse extracted fewer than ${MIN_USEFUL_ATTACHMENT_TEXT_LENGTH} useful characters. OCR fallback required.`
      : null,
  };
}

async function importAttachmentsForMessage({
  message,
}: {
  message: any;
}) {
  const importedAttachments: any[] = [];
  const attachmentImportDiagnostics: any[] = [];

  let extractedAttachmentText = "";
  let firstStoragePath: string | null = null;
  let anyAttachmentNeedsOcr = false;
  let anyAttachmentHadTextExtracted = false;
  let graphAttachmentCount = 0;

  const attachments = await listMessageAttachments({
    mailbox: outlookSharedMailbox,
    messageId: message.id,
  }).catch((error) => {
    attachmentImportDiagnostics.push({
      stage: "listMessageAttachments",
      skipped: true,
      reason:
        error instanceof Error ? error.message : "Failed to list attachments",
    });

    return [];
  });

  graphAttachmentCount = attachments.length;

  for (const attachmentSummary of attachments) {
    const diagnosticBase = {
      outlook_attachment_id: attachmentSummary.id || null,
      name: attachmentSummary.name || null,
      content_type: attachmentSummary.contentType || null,
      size: attachmentSummary.size || null,
      odata_type: attachmentSummary["@odata.type"] || null,
      is_inline: Boolean(attachmentSummary.isInline),
    };

    if (
      attachmentSummary["@odata.type"] !== "#microsoft.graph.fileAttachment"
    ) {
      attachmentImportDiagnostics.push({
        ...diagnosticBase,
        skipped: true,
        reason: "not_file_attachment",
      });
      continue;
    }

    if (attachmentSummary.isInline) {
      attachmentImportDiagnostics.push({
        ...diagnosticBase,
        skipped: true,
        reason: "inline_attachment",
      });
      continue;
    }

    const attachment = await getMessageAttachment({
      mailbox: outlookSharedMailbox,
      messageId: message.id,
      attachmentId: attachmentSummary.id,
    }).catch((error) => {
      attachmentImportDiagnostics.push({
        ...diagnosticBase,
        skipped: true,
        reason:
          error instanceof Error
            ? error.message
            : "Failed to fetch attachment content",
      });

      return null;
    });

    if (!attachment) continue;

    if (!attachment.contentBytes) {
      attachmentImportDiagnostics.push({
        ...diagnosticBase,
        skipped: true,
        reason: "missing_contentBytes",
      });
      continue;
    }

    const fileName = safeFileName(attachment.name || "attachment");
    const storagePath = `outlook/${message.id}/${attachment.id}/${fileName}`;
    const buffer = Buffer.from(attachment.contentBytes, "base64");

    const uploadResult = await supabaseAdmin.storage
      .from(attachmentBucket)
      .upload(storagePath, buffer, {
        contentType: attachment.contentType || "application/octet-stream",
        upsert: true,
      });

    if (uploadResult.error) {
      attachmentImportDiagnostics.push({
        ...diagnosticBase,
        skipped: true,
        reason: `storage_upload_failed: ${uploadResult.error.message}`,
      });
      continue;
    }

    if (!firstStoragePath) firstStoragePath = storagePath;

    const contentType = attachment.contentType || null;

    const extractedText = await extractTextFromBuffer({
      buffer,
      filePath: storagePath,
      contentType,
    });

    const isPdfAttachment = isPdfFile({
      filePath: storagePath,
      contentType,
    });

    const isImageAttachment = isImageFile({
      filePath: storagePath,
      contentType,
    });

    const attachmentNeedsOcr =
      (isPdfAttachment &&
        extractedText.length < MIN_USEFUL_ATTACHMENT_TEXT_LENGTH) ||
      isImageAttachment;

    if (attachmentNeedsOcr) {
      anyAttachmentNeedsOcr = true;
    }

    if (extractedText) {
      anyAttachmentHadTextExtracted = true;

      extractedAttachmentText += `\n\n--- Attachment: ${
        attachment.name || "attachment"
      } ---\n\n${extractedText}`;
    }

    importedAttachments.push(
      buildImportedAttachment({
        attachment,
        storagePath,
        contentType,
        extractedText,
        attachmentNeedsOcr,
        isImageAttachment,
      })
    );

    attachmentImportDiagnostics.push({
      ...diagnosticBase,
      skipped: false,
      imported: true,
      storage_path: storagePath,
      extracted_character_count: extractedText.length,
      needs_ocr: attachmentNeedsOcr,
      text_extracted: Boolean(extractedText),
    });
  }

  return {
    importedAttachments,
    attachmentImportDiagnostics,
    extractedAttachmentText: cleanText(extractedAttachmentText),
    firstStoragePath,
    anyAttachmentNeedsOcr,
    anyAttachmentHadTextExtracted,
    graphAttachmentCount,
  };
}

function getAttachmentExtractionStatus({
  importedAttachmentCount,
  anyAttachmentNeedsOcr,
  anyAttachmentHadTextExtracted,
}: {
  importedAttachmentCount: number;
  anyAttachmentNeedsOcr: boolean;
  anyAttachmentHadTextExtracted: boolean;
}) {
  if (importedAttachmentCount === 0) return "no_attachments";
  if (anyAttachmentNeedsOcr && anyAttachmentHadTextExtracted) {
    return "ocr_partially_completed";
  }
  if (anyAttachmentNeedsOcr) return "ocr_needed";
  if (anyAttachmentHadTextExtracted) return "text_extracted";
  return "no_extractable_text";
}

/**
 * Fire-and-forget local background trigger.
 *
 * This intentionally does NOT await the processing route.
 * The Workbench should show the imported row quickly, then realtime updates
 * should show OCR/AI/Trello progress as the background worker finishes.
 */
function kickBackgroundProcessing(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  const secret = process.env.CRON_SECRET;
  const targetUrl = secret
    ? `${origin}/api/ai/brain/process-recent-imports?secret=${encodeURIComponent(
        secret
      )}&scan=25&process=2`
    : `${origin}/api/ai/brain/process-recent-imports?scan=25&process=2`;

  fetch(targetUrl, {
    method: "POST",
    cache: "no-store",
  }).catch((error) => {
    console.warn("Background processing trigger failed:", error);
  });
}

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);

    const body = await req.json().catch(() => ({}));
    const limit = Number(body?.limit || 10);

    /**
     * Important behaviour change:
     *
     * Default = fast import only.
     * The import button returns quickly after emails/attachments are saved.
     * Full AI processing runs via background/fallback worker.
     *
     * Set runEventChainInline=true only for debugging a single item.
     */
    const runEventChainInline = body?.runEventChainInline === true;
    const kickBackground =
      typeof body?.kickBackground === "boolean" ? body.kickBackground : true;

    const maxEventChainItems = Number(body?.maxEventChainItems || 1);

    const messages = await listRecentInboxMessages({
      mailbox: outlookSharedMailbox,
      limit,
    });

    const results: any[] = [];
    let inlineEventChainCount = 0;
    let importedCount = 0;

    for (const message of messages) {
      const { data: existing } = await supabaseAdmin
        .from("ai_inbox_items")
        .select("id")
        .eq("source_email_message_id", message.id)
        .maybeSingle();

      if (existing?.id) {
        results.push({
          outlook_message_id: message.id,
          imported: false,
          reason: "already_exists",
          inbox_item_id: existing.id,
        });

        continue;
      }

      const emailBody = getMessageText(message);

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("ai_inbox_items")
        .insert({
          source: "outlook_shared_mailbox",
          source_type: "email",
          source_email_provider: "outlook",

          source_email_message_id: message.id,
          source_email_thread_id: message.conversationId || null,
          source_email_url: message.webLink || null,

          sender_email: message.from?.emailAddress?.address || null,
          sender_name: message.from?.emailAddress?.name || null,

          email_subject: message.subject || null,
          email_body: emailBody,

          subject: message.subject || null,
          body: emailBody,
          raw_text: emailBody,

          file_name: message.subject || "Imported Outlook Email",

          status: "uploaded",
          category: "unknown",
          email_status: "processing",
          draft_status: "not_started",

          attachment_extraction_status: message.hasAttachments
            ? "processing_attachments"
            : "no_attachments",

          received_at: message.receivedDateTime || null,

          outlook_message_id: message.id,
          outlook_conversation_id: message.conversationId || null,
          outlook_web_link: message.webLink || null,

          event_chain_status: "queued",
          automation_pipeline_status: "queued",
        })
        .select()
        .single();

      if (insertError || !inserted) {
        results.push({
          outlook_message_id: message.id,
          imported: false,
          error: insertError?.message || "Insert failed",
        });

        continue;
      }

      importedCount += 1;

      const {
        importedAttachments,
        attachmentImportDiagnostics,
        extractedAttachmentText,
        firstStoragePath,
        anyAttachmentNeedsOcr,
        anyAttachmentHadTextExtracted,
        graphAttachmentCount,
      } = await importAttachmentsForMessage({
        message,
      });

      const combinedText = cleanText(
        [emailBody, extractedAttachmentText].filter(Boolean).join("\n\n---\n\n")
      );

      const attachmentExtractionStatus = getAttachmentExtractionStatus({
        importedAttachmentCount: importedAttachments.length,
        anyAttachmentNeedsOcr,
        anyAttachmentHadTextExtracted,
      });

      await supabaseAdmin
        .from("ai_inbox_items")
        .update({
          file_path: firstStoragePath,
          extracted_text: extractedAttachmentText || null,
          raw_text: combinedText,
          body: combinedText,
          attachment_debug: {
            outlook_message_id: message.id,
            graph_has_attachments: Boolean(message.hasAttachments),
            graph_attachment_count: graphAttachmentCount,
            imported_attachment_count: importedAttachments.length,
            imported_attachments: importedAttachments,
            attachment_import_diagnostics: attachmentImportDiagnostics,
            event_chain_mode: runEventChainInline
              ? "inline_debug"
              : "background",
            background_processing_requested: kickBackground,
          },
          attachment_extraction_status: attachmentExtractionStatus,
          attachment_needs_ocr: anyAttachmentNeedsOcr,
        })
        .eq("id", inserted.id);

      let inlinePipelineResult: any = null;

      if (runEventChainInline && inlineEventChainCount < maxEventChainItems) {
        inlinePipelineResult = await processImportedInboxItem({
          inboxItemId: inserted.id,
          source: "import_outlook_inbox_inline_debug",
        });

        inlineEventChainCount += 1;
      }

      await supabaseAdmin.from("ai_workbench_audit_events").insert({
        inbox_item_id: inserted.id,
        actor_id: user.id,
        event_type: runEventChainInline
          ? "outlook_imported_inline_event_chain"
          : "outlook_imported_background_queued",
        event_summary: runEventChainInline
          ? "Outlook email was imported and processed inline."
          : "Outlook email was imported and queued for background processing.",
        metadata: {
          attachment_count: importedAttachments.length,
          attachment_needs_ocr: anyAttachmentNeedsOcr,
          attachment_extraction_status: attachmentExtractionStatus,
          event_chain_mode: runEventChainInline ? "inline_debug" : "background",
          background_processing_requested: kickBackground,
          inline_pipeline_result: inlinePipelineResult,
        },
      });

      results.push({
        imported: true,
        outlook_message_id: message.id,
        inbox_item_id: inserted.id,
        attachment_count: importedAttachments.length,
        attachments_imported: importedAttachments.length,
        attachment_needs_ocr: anyAttachmentNeedsOcr,
        attachment_extraction_status: attachmentExtractionStatus,
        event_chain_status: runEventChainInline ? "inline_started" : "queued",
        automation_pipeline_status: runEventChainInline
          ? "inline_started"
          : "queued",
        inline_event_chain_ran: Boolean(inlinePipelineResult),
        inline_event_chain_result: inlinePipelineResult,
      });
    }

    if (kickBackground && importedCount > 0 && !runEventChainInline) {
      kickBackgroundProcessing(req);
    }

    return NextResponse.json({
      success: true,
      mode: runEventChainInline
        ? "inline_event_chain_debug"
        : "fast_import_background_processing",
      checked: messages.length,
      imported_count: importedCount,
      inline_event_chain_count: inlineEventChainCount,
      background_processing_requested:
        kickBackground && importedCount > 0 && !runEventChainInline,
      message:
        importedCount > 0
          ? "Emails imported quickly. Background processing has been requested; realtime updates should show progress."
          : "No new emails imported.",
      results,
    });
  } catch (error: any) {
    console.error("Import Outlook inbox error:", error);

    return NextResponse.json(
      {
        error: error.message || "Failed to import Outlook inbox.",
      },
      { status: 500 }
    );
  }
}
