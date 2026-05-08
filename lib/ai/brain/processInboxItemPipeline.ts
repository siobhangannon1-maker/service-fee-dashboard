import { ensureTrelloTaskForInboxItem } from "@/lib/ai/brain/ensureTrelloTask";
import { reanalyseInboxItem } from "@/lib/ai/brain/reanalyseInboxItem";
import {
  ImportedAttachment,
  attachmentNeedsOcr,
  isOcrSupportedAttachment,
  parseAttachmentDebug,
  runAttachmentOcr,
} from "@/lib/ai/brain/runAttachmentOcr";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MIN_USEFUL_PDF_TEXT_LENGTH = Number(
  process.env.MIN_USEFUL_PDF_TEXT_LENGTH || 80
);

type PipelineResult = {
  success: boolean;
  inboxItemId: string;
  stage:
    | "skipped"
    | "pdf_parsed"
    | "ocr_started"
    | "ocr_completed"
    | "reanalysed"
    | "trello_created_or_skipped"
    | "completed";
  message: string;
  item?: any;
  details?: any;
};

function normaliseText(value: string) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getContentType(attachment: ImportedAttachment) {
  return attachment.content_type || "application/octet-stream";
}

function getFileName(attachment: ImportedAttachment) {
  return attachment.name || "attachment";
}

function isPdfAttachment(attachment: ImportedAttachment) {
  const contentType = getContentType(attachment).toLowerCase();
  const fileName = getFileName(attachment).toLowerCase();

  return contentType.includes("pdf") || fileName.endsWith(".pdf");
}

function isImageAttachment(attachment: ImportedAttachment) {
  const contentType = getContentType(attachment).toLowerCase();
  const fileName = getFileName(attachment).toLowerCase();

  return (
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(fileName)
  );
}

function buildAttachmentTextBlock({
  attachment,
  text,
  method,
}: {
  attachment: ImportedAttachment;
  text: string;
  method: string;
}) {
  return `\n\n--- Attachment Text (${method}): ${getFileName(
    attachment
  )} ---\n\n${text}`;
}

function removePreviousAttachmentBlock({
  text,
  attachmentName,
}: {
  text: string;
  attachmentName: string;
}) {
  if (!text) return "";

  const escapedName = attachmentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(
    `\\n*--- Attachment Text \\([^)]*\\): ${escapedName} ---\\n\\n[\\s\\S]*?(?=\\n\\n--- Attachment Text \\([^)]*\\):|\\n\\n--- OCR Attachment:|$)`,
    "g"
  );

  return text.replace(regex, "").trim();
}

async function downloadAttachmentBuffer(attachment: ImportedAttachment) {
  const bucket =
    attachment.bucket ||
    process.env.OUTLOOK_ATTACHMENT_STORAGE_BUCKET ||
    "ai-reception";

  if (!attachment.storage_path) {
    throw new Error("Attachment storage_path is missing.");
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .download(attachment.storage_path);

  if (error) {
    throw new Error(error.message);
  }

  const arrayBuffer = await data.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

async function extractPdfText(buffer: Buffer) {
  try {
    const pdfParseModule = await import("pdf-parse");
    const pdfParse =
      (pdfParseModule as any).default || (pdfParseModule as any);

    const parsed = await pdfParse(buffer);

    return normaliseText(parsed?.text || "");
  } catch (error) {
    console.warn("PDF text parsing failed:", error);
    return "";
  }
}

function updateImportedAttachment({
  importedAttachments,
  storagePath,
  updatedAttachment,
}: {
  importedAttachments: ImportedAttachment[];
  storagePath: string;
  updatedAttachment: ImportedAttachment;
}) {
  return importedAttachments.map((attachment) =>
    attachment.storage_path === storagePath ? updatedAttachment : attachment
  );
}

function attachmentAlreadyTextParsed(attachment: ImportedAttachment) {
  return (
    attachment.text_extracted === true &&
    Number(attachment.extracted_character_count || 0) >=
      MIN_USEFUL_PDF_TEXT_LENGTH &&
    Boolean(attachment.extracted_text)
  );
}

function attachmentMarkedCompleteNoText(attachment: ImportedAttachment) {
  return (
    attachment.ocr_status === "completed_no_readable_text" ||
    attachment.ocr_status === "completed" ||
    attachment.ocr_status === "failed_unreadable"
  );
}

async function markPipelineStatus({
  inboxItemId,
  status,
  error,
}: {
  inboxItemId: string;
  status: string;
  error?: string | null;
}) {
  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      automation_pipeline_status: status,
      automation_pipeline_error: error || null,
      automation_pipeline_last_run_at: new Date().toISOString(),
    })
    .eq("id", inboxItemId);
}

async function parsePdfAttachmentsBeforeOcr(inboxItemId: string) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(
      "id, attachment_debug, attachment_needs_ocr, attachment_extraction_status, extracted_text, raw_text, body"
    )
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const attachmentDebug = parseAttachmentDebug(item.attachment_debug);
  const importedAttachments: ImportedAttachment[] =
    attachmentDebug.imported_attachments || [];

  if (importedAttachments.length === 0) {
    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        attachment_extraction_status: "no_attachments",
        attachment_needs_ocr: false,
      })
      .eq("id", inboxItemId);

    return {
      parsedCount: 0,
      needsOcrCount: 0,
      message: "No attachments found.",
    };
  }

  let updatedAttachments = importedAttachments;
  let parsedCount = 0;
  let needsOcrCount = 0;
  let existingExtractedText = String(item.extracted_text || "");
  let existingRawText = String(item.raw_text || item.body || "");

  for (const attachment of importedAttachments) {
    if (!attachment.storage_path) continue;

    if (attachmentAlreadyTextParsed(attachment)) {
      continue;
    }

    if (attachmentMarkedCompleteNoText(attachment)) {
      continue;
    }

    if (isPdfAttachment(attachment)) {
      const buffer = await downloadAttachmentBuffer(attachment);
      const extractedText = await extractPdfText(buffer);

      if (extractedText.length >= MIN_USEFUL_PDF_TEXT_LENGTH) {
        const updatedAttachment: ImportedAttachment = {
          ...attachment,
          text_extracted: true,
          extracted_text: extractedText,
          extracted_character_count: extractedText.length,
          needs_ocr: false,
          ocr_status: attachment.ocr_status || "not_needed_pdf_text_extracted",
          ocr_error: null,
        };

        updatedAttachments = updateImportedAttachment({
          importedAttachments: updatedAttachments,
          storagePath: attachment.storage_path,
          updatedAttachment,
        });

        const attachmentName = getFileName(attachment);

        existingExtractedText = removePreviousAttachmentBlock({
          text: existingExtractedText,
          attachmentName,
        });

        existingRawText = removePreviousAttachmentBlock({
          text: existingRawText,
          attachmentName,
        });

        const block = buildAttachmentTextBlock({
          attachment,
          text: extractedText,
          method: "pdf-parse",
        });

        existingExtractedText = normaliseText(
          [existingExtractedText, block].filter(Boolean).join("\n\n")
        );

        existingRawText = normaliseText(
          [existingRawText, block].filter(Boolean).join("\n\n")
        );

        parsedCount += 1;
      } else {
        const updatedAttachment: ImportedAttachment = {
          ...attachment,
          text_extracted: false,
          extracted_text: "",
          extracted_character_count: extractedText.length,
          needs_ocr: true,
          ocr_status: "needed",
          ocr_error:
            extractedText.length > 0
              ? `PDF parse only extracted ${extractedText.length} characters, so OCR fallback is needed.`
              : "PDF text parse found no usable text, so OCR fallback is needed.",
        };

        updatedAttachments = updateImportedAttachment({
          importedAttachments: updatedAttachments,
          storagePath: attachment.storage_path,
          updatedAttachment,
        });

        needsOcrCount += 1;
      }

      continue;
    }

    if (isImageAttachment(attachment)) {
      const updatedAttachment: ImportedAttachment = {
        ...attachment,
        text_extracted: false,
        needs_ocr: true,
        ocr_status: "needed",
        ocr_error: "Image attachment requires OCR.",
      };

      updatedAttachments = updateImportedAttachment({
        importedAttachments: updatedAttachments,
        storagePath: attachment.storage_path,
        updatedAttachment,
      });

      needsOcrCount += 1;
    }
  }

  const anyNeedsOcr = updatedAttachments.some(
    (attachment) =>
      attachment.needs_ocr === true ||
      attachment.ocr_status === "needed" ||
      attachment.ocr_status === "failed" ||
      attachment.ocr_status === "failed_unreadable"
  );

  const updatedAttachmentDebug = {
    ...attachmentDebug,
    imported_attachments: updatedAttachments,
    last_pdf_parse_before_ocr_at: new Date().toISOString(),
    min_useful_pdf_text_length: MIN_USEFUL_PDF_TEXT_LENGTH,
  };

  const { error: updateError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      attachment_debug: updatedAttachmentDebug,
      attachment_needs_ocr: anyNeedsOcr,
      attachment_extraction_status: anyNeedsOcr
        ? parsedCount > 0
          ? "ocr_partially_completed"
          : "ocr_needed"
        : "text_extracted",
      extracted_text: existingExtractedText || item.extracted_text || null,
      raw_text: existingRawText || item.raw_text || null,
      body: existingRawText || item.body || null,
    })
    .eq("id", inboxItemId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    parsedCount,
    needsOcrCount,
    anyNeedsOcr,
    message: anyNeedsOcr
      ? "PDF parsing completed; at least one attachment still needs OCR."
      : "PDF parsing completed; no OCR needed.",
  };
}

async function getFirstPendingOcrAttachment(inboxItemId: string) {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("id, attachment_debug")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const attachmentDebug = parseAttachmentDebug(item.attachment_debug);
  const importedAttachments: ImportedAttachment[] =
    attachmentDebug.imported_attachments || [];

  return (
    importedAttachments.find(
      (attachment) =>
        attachment.storage_path &&
        isOcrSupportedAttachment(attachment) &&
        attachmentNeedsOcr(attachment)
    ) || null
  );
}

async function hasPendingOcrAttachments(inboxItemId: string) {
  const pending = await getFirstPendingOcrAttachment(inboxItemId);
  return Boolean(pending);
}

export async function processInboxItemPipeline({
  inboxItemId,
  forceTrello = false,
}: {
  inboxItemId: string;
  forceTrello?: boolean;
}): Promise<PipelineResult> {
  await markPipelineStatus({
    inboxItemId,
    status: "running",
  });

  try {
    const parseResult = await parsePdfAttachmentsBeforeOcr(inboxItemId);

    const pendingOcrAttachment = await getFirstPendingOcrAttachment(inboxItemId);

    if (pendingOcrAttachment?.storage_path) {
      const ocrResult = await runAttachmentOcr({
        inboxItemId,
        storagePath: pendingOcrAttachment.storage_path,
        reanalyseAfterOcr: true,
      });

      const stillHasPendingOcr = await hasPendingOcrAttachments(inboxItemId);

      await markPipelineStatus({
        inboxItemId,
        status: stillHasPendingOcr ? "ocr_in_progress" : "ocr_completed",
      });

      return {
        success: true,
        inboxItemId,
        stage: ocrResult.successful ? "ocr_completed" : "ocr_started",
        message: stillHasPendingOcr
          ? "One attachment OCR completed. More OCR attachments remain."
          : "OCR completed for the final pending attachment.",
        details: {
          parseResult,
          ocrResult,
          stillHasPendingOcr,
        },
        item: ocrResult.item,
      };
    }

    const reanalysisResult = await reanalyseInboxItem({
      inboxItemId,
      source: "automation_pipeline",
      regenerateDraft: true,
    });

    const trelloResult = await ensureTrelloTaskForInboxItem({
      inboxItemId,
      reason: "Automatically processed after PDF parse/OCR pipeline.",
      force: forceTrello,
    });

    await markPipelineStatus({
      inboxItemId,
      status: "completed",
    });

    return {
      success: true,
      inboxItemId,
      stage: "completed",
      message:
        "PDF parsing/OCR fallback, AI reanalysis, routing and Trello automation completed.",
      details: {
        parseResult,
        reanalysisResult,
        trelloResult,
      },
      item: trelloResult.item || reanalysisResult.item,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Pipeline failed.";

    await markPipelineStatus({
      inboxItemId,
      status: "failed",
      error: errorMessage,
    });

    throw error;
  }
}
