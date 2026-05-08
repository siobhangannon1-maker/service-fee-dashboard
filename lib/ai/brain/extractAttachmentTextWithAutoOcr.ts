import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type ImportedAttachment = {
  name?: string;
  size?: number;
  bucket?: string;
  imported?: boolean;
  content_type?: string;
  storage_path?: string;
  outlook_attachment_id?: string;

  extraction_status?: string;
  extracted_text?: string;
  extracted_text_length?: number;
  needs_ocr?: boolean;
  ocr_status?: string;
  ocr_text?: string;
  ocr_text_length?: number;
  ocr_error?: string;
};

export type AttachmentExtractionResult = {
  attachment: ImportedAttachment;
  text: string;
  textLength: number;
  extractionStatus: "parsed" | "ocr_completed" | "ocr_needed" | "failed";
  needsOCR: boolean;
  error?: string;
};

const MIN_USEFUL_TEXT_LENGTH = 80;

function normaliseText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPdfAttachment(attachment: ImportedAttachment) {
  const contentType = attachment.content_type || "";
  const name = attachment.name || "";

  return (
    contentType.toLowerCase().includes("pdf") ||
    name.toLowerCase().endsWith(".pdf")
  );
}

function isImageAttachment(attachment: ImportedAttachment) {
  const contentType = attachment.content_type || "";
  const name = attachment.name || "";

  return (
    contentType.toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name)
  );
}

async function downloadAttachmentBuffer(attachment: ImportedAttachment) {
  const bucket = attachment.bucket || process.env.OUTLOOK_ATTACHMENT_STORAGE_BUCKET || "ai-reception";

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
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return normaliseText(result.text || "");
  } finally {
    await parser.destroy();
  }
}

async function runTesseractOnImageBuffer(buffer: Buffer) {
  const worker = await createWorker("eng");

  try {
    const result = await worker.recognize(buffer);
    return normaliseText(result.data.text || "");
  } finally {
    await worker.terminate();
  }
}

/**
 * Tries fast/native extraction first.
 *
 * Behaviour:
 * - Text PDFs: parsed using pdf-parse.
 * - Scanned PDFs: marked as OCR needed if parse text is too short.
 * - Images: OCR runs automatically using tesseract.js.
 *
 * Important:
 * Tesseract does not reliably OCR PDFs directly. Scanned PDFs need a PDF-to-image
 * rendering step before Tesseract can read them. This helper flags scanned PDFs
 * automatically so your import workflow can immediately call your PDF OCR route
 * when PDF rendering is available.
 */
export async function extractAttachmentTextWithAutoOcr(
  attachment: ImportedAttachment
): Promise<AttachmentExtractionResult> {
  try {
    const buffer = await downloadAttachmentBuffer(attachment);

    if (isPdfAttachment(attachment)) {
      const parsedText = await extractPdfText(buffer);

      if (parsedText.length >= MIN_USEFUL_TEXT_LENGTH) {
        return {
          attachment: {
            ...attachment,
            extraction_status: "parsed",
            extracted_text: parsedText,
            extracted_text_length: parsedText.length,
            needs_ocr: false,
            ocr_status: "not_needed",
          },
          text: parsedText,
          textLength: parsedText.length,
          extractionStatus: "parsed",
          needsOCR: false,
        };
      }

      return {
        attachment: {
          ...attachment,
          extraction_status: "parsed_too_little_text",
          extracted_text: parsedText,
          extracted_text_length: parsedText.length,
          needs_ocr: true,
          ocr_status: "needed",
        },
        text: parsedText,
        textLength: parsedText.length,
        extractionStatus: "ocr_needed",
        needsOCR: true,
      };
    }

    if (isImageAttachment(attachment)) {
      const ocrText = await runTesseractOnImageBuffer(buffer);

      return {
        attachment: {
          ...attachment,
          extraction_status: "ocr_completed",
          extracted_text: ocrText,
          extracted_text_length: ocrText.length,
          needs_ocr: ocrText.length < MIN_USEFUL_TEXT_LENGTH,
          ocr_status: "completed",
          ocr_text: ocrText,
          ocr_text_length: ocrText.length,
        },
        text: ocrText,
        textLength: ocrText.length,
        extractionStatus: "ocr_completed",
        needsOCR: ocrText.length < MIN_USEFUL_TEXT_LENGTH,
      };
    }

    return {
      attachment: {
        ...attachment,
        extraction_status: "unsupported_attachment_type",
        needs_ocr: false,
        ocr_status: "not_supported",
      },
      text: "",
      textLength: 0,
      extractionStatus: "failed",
      needsOCR: false,
      error: "Unsupported attachment type.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Attachment extraction failed.";

    return {
      attachment: {
        ...attachment,
        extraction_status: "failed",
        extracted_text: "",
        extracted_text_length: 0,
        needs_ocr: true,
        ocr_status: "failed",
        ocr_error: message,
      },
      text: "",
      textLength: 0,
      extractionStatus: "failed",
      needsOCR: true,
      error: message,
    };
  }
}

export function mergeAttachmentExtractionResult(
  importedAttachments: ImportedAttachment[],
  targetStoragePath: string,
  result: AttachmentExtractionResult
) {
  return importedAttachments.map((attachment) =>
    attachment.storage_path === targetStoragePath ? result.attachment : attachment
  );
}
