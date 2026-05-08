import { NextResponse } from "next/server";

import {
  ImportedAttachment,
  attachmentNeedsOcr,
  parseAttachmentDebug,
  runAttachmentOcr,
} from "@/lib/ai/brain/runAttachmentOcr";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function assertCronSecret(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;

  if (!configuredSecret) {
    return true;
  }

  const authHeader = request.headers.get("authorization") || "";
  const querySecret = new URL(request.url).searchParams.get("secret") || "";

  return (
    authHeader === `Bearer ${configuredSecret}` ||
    querySecret === configuredSecret
  );
}

function findFirstPendingAttachment(
  attachments: ImportedAttachment[]
): ImportedAttachment | null {
  return attachments.find((attachment) => attachmentNeedsOcr(attachment)) || null;
}

async function processOnePendingOcr(request: Request) {
  if (!assertCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);

  const itemLimit = Math.min(Number(url.searchParams.get("items") || 25), 50);

  const { data: items, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("id, file_name, created_at, attachment_debug, attachment_needs_ocr")
    .eq("attachment_needs_ocr", true)
    .order("created_at", { ascending: true })
    .limit(itemLimit);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }

  for (const item of items || []) {
    const attachmentDebug = parseAttachmentDebug(item.attachment_debug);

    const attachments: ImportedAttachment[] =
      attachmentDebug.imported_attachments || [];

    const pendingAttachment = findFirstPendingAttachment(attachments);

    if (!pendingAttachment) {
      // Repair stale parent OCR flag if the item says OCR is needed but no child
      // attachment is actually pending.
      await supabaseAdmin
        .from("ai_inbox_items")
        .update({
          attachment_needs_ocr: false,
          attachment_extraction_status: "ocr_completed",
        })
        .eq("id", item.id);

      continue;
    }

    if (!pendingAttachment.storage_path) {
      return NextResponse.json({
        success: false,
        processed: false,
        checked_items: items?.length || 0,
        inbox_item_id: item.id,
        file_name: item.file_name,
        attachment_name: pendingAttachment.name,
        error: "Pending attachment is missing storage_path.",
      });
    }

    try {
      const result = await runAttachmentOcr({
        inboxItemId: item.id,
        storagePath: pendingAttachment.storage_path,
        reanalyseAfterOcr: true,
      });

      return NextResponse.json({
        success: true,
        processed: true,
        mode: "one_attachment_per_run",
        checked_items: items?.length || 0,
        inbox_item_id: item.id,
        file_name: item.file_name,
        attachment_name: pendingAttachment.name,
        storage_path: pendingAttachment.storage_path,
        result,
      });
    } catch (error) {
      console.error("Auto pending OCR failed:", error);

      return NextResponse.json(
        {
          success: false,
          processed: false,
          mode: "one_attachment_per_run",
          checked_items: items?.length || 0,
          inbox_item_id: item.id,
          file_name: item.file_name,
          attachment_name: pendingAttachment.name,
          storage_path: pendingAttachment.storage_path,
          error:
            error instanceof Error
              ? error.message
              : "Failed to process pending OCR attachment.",
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    processed: false,
    mode: "one_attachment_per_run",
    checked_items: items?.length || 0,
    message: "No pending OCR attachments found.",
  });
}

export async function GET(request: Request) {
  return processOnePendingOcr(request);
}

export async function POST(request: Request) {
  return processOnePendingOcr(request);
}
