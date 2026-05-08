import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ImportedAttachment,
  extractAttachmentTextWithAutoOcr,
  mergeAttachmentExtractionResult,
} from "@/lib/ai/brain/extractAttachmentTextWithAutoOcr";

function parseAttachmentDebug(raw: any) {
  if (!raw) {
    return {};
  }

  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  return raw;
}

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;
    const storagePath = body.storagePath as string | undefined;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    if (!storagePath) {
      return NextResponse.json(
        { error: "Missing storagePath." },
        { status: 400 }
      );
    }

    const { data: inboxItem, error: inboxError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("id, attachment_debug, attachment_needs_ocr")
      .eq("id", inboxItemId)
      .single();

    if (inboxError || !inboxItem) {
      return NextResponse.json(
        { error: inboxError?.message || "Inbox item not found." },
        { status: 404 }
      );
    }

    const attachmentDebug = parseAttachmentDebug(inboxItem.attachment_debug);
    const importedAttachments: ImportedAttachment[] =
      attachmentDebug.imported_attachments || [];

    const attachment = importedAttachments.find(
      (entry) => entry.storage_path === storagePath
    );

    if (!attachment) {
      return NextResponse.json(
        { error: "Attachment not found in attachment_debug.imported_attachments." },
        { status: 404 }
      );
    }

    const result = await extractAttachmentTextWithAutoOcr(attachment);

    const updatedAttachments = mergeAttachmentExtractionResult(
      importedAttachments,
      storagePath,
      result
    );

    const anyNeedsOcr = updatedAttachments.some(
      (entry) => entry.needs_ocr || entry.ocr_status === "needed"
    );

    const updatedAttachmentDebug = {
      ...attachmentDebug,
      imported_attachments: updatedAttachments,
      extraction_last_checked_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        attachment_debug: updatedAttachmentDebug,
        attachment_needs_ocr: anyNeedsOcr,
        attachment_extraction_status: anyNeedsOcr
          ? "ocr_needed"
          : "extracted",
      })
      .eq("id", inboxItemId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "attachment_text_extracted",
      event_label: "Attachment text extracted",
      details: {
        storage_path: storagePath,
        extraction_status: result.extractionStatus,
        text_length: result.textLength,
        needs_ocr: result.needsOCR,
        error: result.error || null,
      },
    });

    return NextResponse.json({
      success: true,
      result,
      attachment_debug: updatedAttachmentDebug,
      attachment_needs_ocr: anyNeedsOcr,
      attachment_extraction_status: anyNeedsOcr ? "ocr_needed" : "extracted",
    });
  } catch (error) {
    console.error("Extract attachment text route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to extract attachment text.",
      },
      { status: 500 }
    );
  }
}
