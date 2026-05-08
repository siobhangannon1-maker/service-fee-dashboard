import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const attachmentBucket =
  process.env.OUTLOOK_ATTACHMENT_STORAGE_BUCKET || "ai-reception";

function getFileExtension(path: string) {
  const cleanPath = path.split("?")[0] || "";
  const parts = cleanPath.split(".");
  return parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "";
}

function cleanExtractedText(value: string) {
  return value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getImportedAttachments(item: any) {
  const importedAttachments =
    item.attachment_debug?.imported_attachments ||
    item.attachment_debug?.importedAttachments ||
    [];

  return Array.isArray(importedAttachments) ? importedAttachments : [];
}

function getContentTypeFromAttachmentDebug(item: any) {
  const importedAttachments = getImportedAttachments(item);

  const matchingAttachment = importedAttachments.find(
    (attachment: any) => attachment.storage_path === item.file_path
  );

  return matchingAttachment?.content_type || null;
}

async function extractPdfText(buffer: Buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");

  const pdf = await getDocumentProxy(new Uint8Array(buffer));

  const result = await extractText(pdf, {
    mergePages: true,
  });

  return cleanExtractedText(result.text || "");
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
    return cleanExtractedText(buffer.toString("utf8"));
  }

  throw new Error(
    `Unsupported attachment type. Currently supported: PDF, TXT and CSV. File extension: ${
      extension || "unknown"
    }, content type: ${contentType || "unknown"}`
  );
}

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);

    const { inboxItemId } = await req.json();

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId" },
        { status: 400 }
      );
    }

    const { data: item, error: itemError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json(
        { error: itemError?.message || "Inbox item not found" },
        { status: 404 }
      );
    }

    if (!item.file_path) {
      return NextResponse.json(
        { error: "No imported attachment file_path found for this item." },
        { status: 400 }
      );
    }

    const contentType = getContentTypeFromAttachmentDebug(item);

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from(attachmentBucket)
      .download(item.file_path);

    if (downloadError || !fileData) {
      return NextResponse.json(
        {
          error:
            downloadError?.message ||
            `Could not download attachment from bucket ${attachmentBucket}.`,
        },
        { status: 500 }
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extractedText = await extractTextFromBuffer({
      buffer,
      filePath: item.file_path,
      contentType,
    });

    if (!extractedText) {
      return NextResponse.json(
        {
          error:
            "The attachment was downloaded, but no text could be extracted.",
        },
        { status: 422 }
      );
    }

    const combinedText = [
      item.email_body ? `Email body:\n${item.email_body}` : "",
      `Attachment text:\n${extractedText}`,
    ]
      .filter(Boolean)
      .join("\n\n---\n\n");

    const updatedAttachmentDebug = {
      ...(item.attachment_debug || {}),
      extraction: {
        processed_at: new Date().toISOString(),
        processed_by: user.id,
        bucket: attachmentBucket,
        file_path: item.file_path,
        content_type: contentType,
        extracted_character_count: extractedText.length,
      },
    };

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        extracted_text: extractedText,
        raw_text: combinedText,
        body: combinedText,
        attachment_debug: updatedAttachmentDebug,
        attachment_extraction_status: "text_extracted",
        attachment_needs_ocr: false,
        summary:
          item.summary ||
          extractedText.slice(0, 500) ||
          "Imported Outlook attachment text extracted.",
        suggested_action:
          item.suggested_action ||
          "Review imported Outlook email and extracted attachment text.",
        status: "uploaded",
      })
      .eq("id", inboxItemId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      case_id: null,
      draft_id: null,
      actor_id: user.id,
      event_type: "outlook_attachment_text_extracted",
      event_summary:
        "Text was extracted from an imported Outlook attachment and saved to the workbench item.",
      previous_values: {
        attachment_extraction_status: item.attachment_extraction_status,
        attachment_needs_ocr: item.attachment_needs_ocr,
      },
      new_values: {
        attachment_extraction_status: "text_extracted",
        attachment_needs_ocr: false,
        extracted_character_count: extractedText.length,
      },
      metadata: {
        bucket: attachmentBucket,
        file_path: item.file_path,
        content_type: contentType,
      },
    });

    return NextResponse.json({
      success: true,
      item: updatedItem,
      extracted_character_count: extractedText.length,
      preview: extractedText.slice(0, 500),
    });
  } catch (error: any) {
    console.error("Process imported Outlook attachment error:", error);

    return NextResponse.json(
      {
        error:
          error.message || "Failed to process imported Outlook attachment.",
      },
      { status: 500 }
    );
  }
}