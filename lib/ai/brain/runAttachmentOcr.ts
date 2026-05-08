import OpenAI from "openai";

import { reanalyseInboxItem } from "@/lib/ai/brain/reanalyseInboxItem";
import { supabaseAdmin } from "@/lib/supabase/admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ImportedAttachment = {
  name?: string | null;
  size?: number | null;
  bucket?: string | null;
  imported?: boolean | null;
  content_type?: string | null;
  storage_path?: string | null;
  outlook_attachment_id?: string | null;

  text_extracted?: boolean | null;
  extracted_character_count?: number | null;
  extracted_text?: string | null;

  needs_ocr?: boolean | null;
  ocr_status?: string | null;
  ocr_text?: string | null;
  ocr_text_length?: number | null;
  ocr_error?: string | null;
  ocr_completed_at?: string | null;
  ocr_method?: string | null;
};

export function parseAttachmentDebug(raw: any) {
  if (!raw) return {};

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return raw;
}

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
  const name = getFileName(attachment).toLowerCase();

  return contentType.includes("pdf") || name.endsWith(".pdf");
}

function isImageAttachment(attachment: ImportedAttachment) {
  const contentType = getContentType(attachment).toLowerCase();
  const name = getFileName(attachment).toLowerCase();

  return (
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name)
  );
}

export function isOcrSupportedAttachment(attachment: ImportedAttachment) {
  return isPdfAttachment(attachment) || isImageAttachment(attachment);
}

export function attachmentNeedsOcr(attachment: ImportedAttachment) {
  if (!isOcrSupportedAttachment(attachment)) return false;

  return (
    attachment.needs_ocr === true ||
    attachment.ocr_status === "needed" ||
    attachment.ocr_status === "failed" ||
    attachment.ocr_status === "failed_unreadable"
  );
}

function buildAttachmentTextBlock({
  attachment,
  text,
}: {
  attachment: ImportedAttachment;
  text: string;
}) {
  return `\n\n--- OCR Attachment: ${getFileName(attachment)} ---\n\n${text}`;
}

function removePreviousOcrBlock({
  text,
  attachmentName,
}: {
  text: string;
  attachmentName: string;
}) {
  if (!text) return "";

  const marker = `--- OCR Attachment: ${attachmentName} ---`;
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(
    `\\n*${escapedMarker}\\n\\n[\\s\\S]*?(?=\\n\\n--- OCR Attachment:|$)`,
    "g"
  );

  return text.replace(regex, "").trim();
}

function updateImportedAttachments({
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

async function extractTextWithOpenAI({
  attachment,
  buffer,
}: {
  attachment: ImportedAttachment;
  buffer: Buffer;
}) {
  const contentType = getContentType(attachment);
  const base64 = buffer.toString("base64");
  const fileName = getFileName(attachment);

  const extractionPrompt = `
Extract all readable text from this dental practice attachment.

Rules:
- Return only extracted text.
- Preserve patient names, dates of birth, dates, provider names, referral details, clinical wording, phone numbers, email addresses, addresses, practice names and radiology labels.
- Do not summarise.
- Do not add comments.
- Do not invent missing text.
- If this is a dental x-ray or OPG image with no readable text, return exactly: NO_READABLE_TEXT_IMAGE
- If the file is unreadable, return exactly: UNREADABLE_ATTACHMENT
`;

  const content: any[] = [
    {
      type: "input_text",
      text: extractionPrompt,
    },
  ];

  if (isImageAttachment(attachment)) {
    content.push({
      type: "input_image",
      image_url: `data:${contentType};base64,${base64}`,
    });
  } else {
    content.push({
      type: "input_file",
      filename: fileName,
      file_data: `data:${contentType};base64,${base64}`,
    });
  }

  const response = await openai.responses.create({
    model: process.env.OPENAI_OCR_MODEL || "gpt-4o-mini",
    input: [
      {
        role: "user",
        content,
      },
    ],
  });

  return normaliseText(response.output_text || "");
}

export async function runAttachmentOcr({
  inboxItemId,
  storagePath,
  reanalyseAfterOcr = true,
}: {
  inboxItemId: string;
  storagePath: string;
  reanalyseAfterOcr?: boolean;
}) {
  const { data: inboxItem, error: inboxError } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(
      "id, attachment_debug, attachment_needs_ocr, attachment_extraction_status, extracted_text, raw_text, body"
    )
    .eq("id", inboxItemId)
    .single();

  if (inboxError || !inboxItem) {
    throw new Error(inboxError?.message || "Inbox item not found.");
  }

  const attachmentDebug = parseAttachmentDebug(inboxItem.attachment_debug);

  const importedAttachments: ImportedAttachment[] =
    attachmentDebug.imported_attachments || [];

  const attachment = importedAttachments.find(
    (entry) => entry.storage_path === storagePath
  );

  if (!attachment) {
    throw new Error(
      "Attachment not found in attachment_debug.imported_attachments."
    );
  }

  if (!isOcrSupportedAttachment(attachment)) {
    throw new Error("This OCR route supports PDF and image attachments only.");
  }

  const buffer = await downloadAttachmentBuffer(attachment);

  const extractedText = await extractTextWithOpenAI({
    attachment,
    buffer,
  });

  const noReadableTextImage =
    isImageAttachment(attachment) && extractedText === "NO_READABLE_TEXT_IMAGE";

  const unreadable =
    !extractedText || extractedText === "UNREADABLE_ATTACHMENT";

  const successful = !unreadable && !noReadableTextImage;

  const updatedAttachment: ImportedAttachment = {
    ...attachment,
    text_extracted: successful,
    extracted_character_count: successful ? extractedText.length : 0,
    extracted_text: successful ? extractedText : "",
    needs_ocr: false,
    ocr_status: successful
      ? "completed"
      : noReadableTextImage
      ? "completed_no_readable_text"
      : "failed_unreadable",
    ocr_text: successful ? extractedText : "",
    ocr_text_length: successful ? extractedText.length : 0,
    ocr_error: successful
      ? null
      : noReadableTextImage
      ? "Image processed successfully but no readable text was found."
      : "OpenAI could not extract readable text.",
    ocr_completed_at: new Date().toISOString(),
    ocr_method: "openai_file_input",
  };

  const updatedAttachments = updateImportedAttachments({
    importedAttachments,
    storagePath,
    updatedAttachment,
  });

  const anyNeedsOcr = updatedAttachments.some(
    (entry) =>
      entry.needs_ocr === true ||
      entry.ocr_status === "needed" ||
      entry.ocr_status === "failed_unreadable"
  );

  const updatedAttachmentDebug = {
    ...attachmentDebug,
    imported_attachments: updatedAttachments,
    last_ocr_method: "openai_file_input",
    last_ocr_storage_path: storagePath,
    last_ocr_at: new Date().toISOString(),
  };

  const attachmentName = getFileName(attachment);

  const existingExtractedText = removePreviousOcrBlock({
    text: String(inboxItem.extracted_text || ""),
    attachmentName,
  });

  const existingRawText = removePreviousOcrBlock({
    text: String(inboxItem.raw_text || inboxItem.body || ""),
    attachmentName,
  });

  const attachmentTextBlock = successful
    ? buildAttachmentTextBlock({
        attachment,
        text: extractedText,
      })
    : "";

  const nextExtractedText = normaliseText(
    [existingExtractedText, attachmentTextBlock].filter(Boolean).join("\n\n")
  );

  const nextRawText = normaliseText(
    [existingRawText, attachmentTextBlock].filter(Boolean).join("\n\n")
  );

  const { data: updatedItem, error: updateError } = await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      attachment_debug: updatedAttachmentDebug,
      attachment_needs_ocr: anyNeedsOcr,
      attachment_extraction_status: anyNeedsOcr
        ? "ocr_partially_completed"
        : "ocr_completed",
      extracted_text: nextExtractedText || null,
      raw_text: nextRawText || null,
      body: nextRawText || null,
    })
    .eq("id", inboxItemId)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: auditError } = await supabaseAdmin
    .from("ai_workbench_audit_events")
    .insert({
      inbox_item_id: inboxItemId,
      actor_id: null,
      event_type: successful
        ? "attachment_ocr_completed"
        : noReadableTextImage
        ? "attachment_ocr_no_readable_text"
        : "attachment_ocr_failed",
      event_summary: successful
        ? "OpenAI OCR extracted text from the attachment."
        : noReadableTextImage
        ? "OpenAI OCR processed the image but found no readable text."
        : "OpenAI OCR could not extract readable text from the attachment.",
      metadata: {
        storage_path: storagePath,
        attachment_name: attachment.name || null,
        content_type: attachment.content_type || null,
        method: "openai_file_input",
        text_length: successful ? extractedText.length : 0,
      },
    });

  if (auditError) {
    console.warn("OCR saved, but audit event failed:", auditError.message);
  }

  let reanalysisResult: any = null;

  if (reanalyseAfterOcr && successful) {
    reanalysisResult = await reanalyseInboxItem({
      inboxItemId,
      source: "ocr_completed",
      regenerateDraft: true,
    });
  }

  return {
    success: successful || noReadableTextImage,
    successful,
    noReadableTextImage,
    unreadable,
    message: successful
      ? reanalysisResult
        ? `OCR completed and AI Brain re-analysed this item. Extracted ${extractedText.length} characters from ${attachmentName}.`
        : `OCR completed. Extracted ${extractedText.length} characters from ${attachmentName}.`
      : noReadableTextImage
      ? `Image OCR completed for ${attachmentName}. No readable text was found.`
      : `OpenAI could not extract readable text from ${attachmentName}.`,
    extractedText: successful ? extractedText : "",
    textLength: successful ? extractedText.length : 0,
    attachment: updatedAttachment,
    item: reanalysisResult?.item || updatedItem,
    reanalysisResult,
  };
}
