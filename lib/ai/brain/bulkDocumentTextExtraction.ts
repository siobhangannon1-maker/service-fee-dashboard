import { extractText, getDocumentProxy } from "unpdf";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runAttachmentOcr } from "@/lib/ai/brain/runAttachmentOcr";

type ImportedAttachment = {
  name?: string;
  content_type?: string;
  storage_path?: string;
  bucket?: string;
};

const MIN_USEFUL_TEXT_LENGTH = 80;

function normaliseText(value: string) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPdfAttachment(attachment: ImportedAttachment) {
  const type = String(attachment.content_type || "").toLowerCase();
  const name = String(attachment.name || "").toLowerCase();

  return type.includes("pdf") || name.endsWith(".pdf");
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

async function parsePdfTextWithUnpdf(buffer: Buffer) {
  const uint8Array = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(uint8Array);
  const result = await extractText(pdf, { mergePages: false });

  const text = result.text;

  if (Array.isArray(text)) {
    return normaliseText(
      text
        .map((pageText, index) => `Page ${index + 1}:\n${pageText}`)
        .join("\n\n"),
    );
  }

  return normaliseText(String(text || ""));
}

export async function extractBulkAttachmentText({
  inboxItemId,
  attachment,
}: {
  inboxItemId: string;
  attachment: ImportedAttachment;
}) {
  if (!attachment.storage_path) {
    throw new Error("Attachment storage_path is missing.");
  }

  if (isPdfAttachment(attachment)) {
    const buffer = await downloadAttachmentBuffer(attachment);
    const pdfText = await parsePdfTextWithUnpdf(buffer);

    if (pdfText.length >= MIN_USEFUL_TEXT_LENGTH) {
      return {
        method: "unpdf",
        text: pdfText,
        textLength: pdfText.length,
        needsOcr: false,
        ocrResult: null,
      };
    }
  }

  const ocrResult = await runAttachmentOcr({
    inboxItemId,
    storagePath: attachment.storage_path,
    reanalyseAfterOcr: false,
  });

  return {
    method: "openai_ocr",
    text: ocrResult.extractedText || "",
    textLength: ocrResult.textLength || 0,
    needsOcr: false,
    ocrResult,
  };
}