import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { matchPraktikaPatientForInboxItem } from "@/lib/ai/brain/praktikaPatientMatch";
import { runAttachmentOcr } from "@/lib/ai/brain/runAttachmentOcr";

export const runtime = "nodejs";
export const maxDuration = 120;

const MIN_USEFUL_TEXT_LENGTH = 80;

type ImportedAttachment = {
  name?: string | null;
  content_type?: string | null;
  storage_path?: string | null;
  bucket?: string | null;
  size?: number | null;
};

function parseAttachmentDebug(raw: any) {
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

function getImportedAttachments(attachmentDebug: any): ImportedAttachment[] {
  const parsed = parseAttachmentDebug(attachmentDebug);

  if (Array.isArray(parsed.imported_attachments)) {
    return parsed.imported_attachments.filter((attachment: ImportedAttachment) =>
      Boolean(attachment?.storage_path),
    );
  }

  return [];
}

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

function isImageAttachment(attachment: ImportedAttachment) {
  const type = String(attachment.content_type || "").toLowerCase();
  const name = String(attachment.name || "").toLowerCase();

  return (
    type.startsWith("image/") ||
    /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name)
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

async function parsePdfTextWithUnpdf(buffer: Buffer) {
  try {
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
  } catch (error) {
    console.error("unpdf extraction failed:", error);
    return "";
  }
}

async function extractAttachmentText({
  item,
  attachment,
}: {
  item: any;
  attachment: ImportedAttachment;
}) {
  const storagePath = String(attachment.storage_path || "").trim();

  if (!storagePath) {
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
        fallbackUsed: false,
        message: "PDF text extracted using unpdf.",
      };
    }

    const ocrResult = await runAttachmentOcr({
      inboxItemId: item.id,
      storagePath,
      reanalyseAfterOcr: false,
    });

    return {
      method: "openai_ocr_fallback",
      text: normaliseText(ocrResult.extractedText || ""),
      textLength: ocrResult.textLength || 0,
      fallbackUsed: true,
      message:
        pdfText.length > 0
          ? "PDF text was too short, so OpenAI OCR fallback was used."
          : "PDF text extraction failed or returned no text, so OpenAI OCR fallback was used.",
    };
  }

  if (isImageAttachment(attachment)) {
    const ocrResult = await runAttachmentOcr({
      inboxItemId: item.id,
      storagePath,
      reanalyseAfterOcr: false,
    });

    return {
      method: "openai_ocr",
      text: normaliseText(ocrResult.extractedText || ""),
      textLength: ocrResult.textLength || 0,
      fallbackUsed: false,
      message: ocrResult.message || "Image OCR completed.",
    };
  }

  return {
    method: "unsupported",
    text: "",
    textLength: 0,
    fallbackUsed: false,
    message: "Unsupported attachment type.",
  };
}

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();
    const batchId = String(body.batchId || "").trim();

    if (!batchId) {
      return NextResponse.json(
        { ok: false, error: "Missing batchId." },
        { status: 400 },
      );
    }

    const { data: items, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("bulk_upload_batch_id", batchId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const results: any[] = [];

    for (const item of items || []) {
      try {
        const attachmentDebug = parseAttachmentDebug(item.attachment_debug);
        const attachments = getImportedAttachments(attachmentDebug);

        if (attachments.length === 0) {
          throw new Error("No imported attachments found for extraction.");
        }

        const extractionResults: any[] = [];
        const extractedTexts: string[] = [];

        for (const attachment of attachments) {
          const extraction = await extractAttachmentText({
            item,
            attachment,
          });

          extractionResults.push({
            storagePath: attachment.storage_path,
            fileName: attachment.name || null,
            method: extraction.method,
            textLength: extraction.textLength,
            fallbackUsed: extraction.fallbackUsed,
            message: extraction.message,
          });

          if (extraction.text) {
            extractedTexts.push(
              `--- Attachment: ${attachment.name || "attachment"} ---\n\n${extraction.text}`,
            );
          }
        }

        const combinedText = normaliseText(extractedTexts.join("\n\n"));

        const updatedAttachmentDebug = {
          ...attachmentDebug,
          bulk_extraction_results: extractionResults,
          extraction_last_checked_at: new Date().toISOString(),
        };

        await supabaseAdmin
          .from("ai_inbox_items")
          .update({
            attachment_debug: updatedAttachmentDebug,
            extracted_text: combinedText || item.extracted_text || null,
            raw_text: combinedText || item.raw_text || null,
            body: combinedText || item.body || null,
            attachment_extraction_status: combinedText
              ? "extracted"
              : "failed",
            attachment_needs_ocr: false,
          })
          .eq("id", item.id);

        await supabaseAdmin.from("ai_workbench_audit_events").insert({
          inbox_item_id: item.id,
          event_type: "bulk_document_text_extracted",
          event_label: "Bulk document text extracted",
          details: {
            batchId,
            fileName: item.file_name,
            textLength: combinedText.length,
            extractionResults,
          },
        });

        const matchResult = await matchPraktikaPatientForInboxItem({
          inboxItemId: item.id,
        });

        results.push({
          inboxItemId: item.id,
          fileName: item.file_name,
          ok: true,
          textLength: combinedText.length,
          extractionResults,
          matchResult,
        });
      } catch (error: any) {
        await supabaseAdmin
          .from("ai_inbox_items")
          .update({
            attachment_extraction_status: "failed",
            praktika_match_status: "failed",
            praktika_match_reason:
              error?.message || "Bulk document processing failed.",
          })
          .eq("id", item.id);

        await supabaseAdmin.from("ai_workbench_audit_events").insert({
          inbox_item_id: item.id,
          event_type: "bulk_document_processing_failed",
          event_label: "Bulk document processing failed",
          details: {
            batchId,
            fileName: item.file_name,
            error: error?.message || "Bulk document processing failed.",
          },
        });

        results.push({
          inboxItemId: item.id,
          fileName: item.file_name,
          ok: false,
          error: error?.message || "Bulk document processing failed.",
        });
      }
    }

    const { data: updatedItems, error: listError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select(
        `
        id,
        created_at,
        file_name,
        file_path,
        extracted_text,
        raw_text,
        extracted_patient_first_name,
        extracted_patient_last_name,
        extracted_patient_dob,
        praktika_patient_id,
        praktika_patient_number,
        praktika_match_status,
        praktika_match_confidence,
        praktika_match_reason,
        praktika_match_candidates,
        praktika_filing_status,
        praktika_filing_error,
        praktika_filed_at,
        attachment_extraction_status,
        attachment_needs_ocr,
        bulk_uploaded_by,
        bulk_uploaded_by_email,
        bulk_uploaded_by_name
      `,
      )
      .eq("bulk_upload_batch_id", batchId)
      .order("created_at", { ascending: true });

    if (listError) {
      throw new Error(listError.message);
    }

    return NextResponse.json({
      ok: true,
      results,
      items: updatedItems || [],
    });
  } catch (error: any) {
    console.error("Bulk document processing failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Bulk document processing failed.",
      },
      { status: 500 },
    );
  }
}