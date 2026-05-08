import { NextResponse } from "next/server";

import { ensureTrelloTaskForInboxItem } from "@/lib/ai/brain/ensureTrelloTask";
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

function hasUsableContent(item: any) {
  return Boolean(
    item.summary ||
      item.suggested_action ||
      item.raw_text ||
      item.body ||
      item.extracted_text ||
      item.email_body ||
      item.email_subject ||
      item.subject
  );
}

function hasPendingOcr(item: any) {
  return (
    item.attachment_needs_ocr === true ||
    item.attachment_extraction_status === "ocr_needed" ||
    item.attachment_extraction_status === "ocr_partially_completed"
  );
}

function isArchived(item: any) {
  return Boolean(
    item.archived_at ||
      item.status === "archived" ||
      item.email_status === "archived"
  );
}

function isOldManualUpload(item: any) {
  return item.source === "manual_upload" || item.source_type === "manual_upload";
}

function isPromotionalOrSystemEmail(item: any) {
  const sender = String(item.sender_email || "").toLowerCase();
  const subject = String(item.email_subject || item.subject || "").toLowerCase();
  const summary = String(item.summary || "").toLowerCase();

  if (sender.includes("microsoft365@communication.microsoft.com")) return true;
  if (sender.includes("no-reply") && summary.includes("promotional")) return true;
  if (subject.includes("power up your productivity")) return true;
  if (summary.includes("promotional email")) return true;
  if (summary.includes("marketing email")) return true;

  return false;
}

function candidateSkipReason(item: any) {
  if (item.trello_card_id || item.trello_card_url) {
    return "Trello card already exists.";
  }

  if (isArchived(item)) {
    return "Item is archived.";
  }

  if (isOldManualUpload(item)) {
    return "Manual upload items are excluded from automatic Trello creation.";
  }

  if (hasPendingOcr(item)) {
    return "OCR still pending.";
  }

  if (!hasUsableContent(item)) {
    return "No usable email/body/OCR/summary content.";
  }

  if (isPromotionalOrSystemEmail(item)) {
    return "Promotional/system email excluded.";
  }

  return null;
}

async function processAutoTrelloTasks(request: Request) {
  if (!assertCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);

  const scanLimit = Math.min(Number(url.searchParams.get("scan") || 50), 100);
  const processLimit = Math.min(Number(url.searchParams.get("process") || 1), 10);
  const minimumConfidence = Number(
    url.searchParams.get("minimumConfidence") ||
      process.env.TRELLO_AUTO_TASK_MIN_CONFIDENCE ||
      0.6
  );

  const { data: items, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(
      `
      id,
      created_at,
      file_name,
      patient_name,
      patient_dob,
      sender_email,
      sender_name,
      source,
      source_type,
      status,
      email_status,
      category,
      email_subject,
      subject,
      summary,
      suggested_action,
      raw_text,
      body,
      extracted_text,
      email_body,
      attachment_needs_ocr,
      attachment_extraction_status,
      archived_at,
      trello_card_id,
      trello_card_url,
      trello_auto_task_status,
      trello_auto_task_reason
      `
    )
    .is("trello_card_id", null)
    .is("trello_card_url", null)
    .order("created_at", { ascending: false })
    .limit(scanLimit);

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }

  const scanned = items || [];
  const skippedBeforeProcessing: any[] = [];
  const eligible: any[] = [];

  for (const item of scanned) {
    const reason = candidateSkipReason(item);

    if (reason) {
      skippedBeforeProcessing.push({
        inbox_item_id: item.id,
        file_name: item.file_name,
        email_subject: item.email_subject || item.subject,
        created_at: item.created_at,
        skipped: true,
        reason,
      });
    } else {
      eligible.push(item);
    }
  }

  const results: any[] = [];

  for (const item of eligible.slice(0, processLimit)) {
    try {
      const result = await ensureTrelloTaskForInboxItem({
        inboxItemId: item.id,
        reason: "Automatically created by smart Trello task worker.",
        force: false,
        minimumConfidence,
      });

      results.push({
        inbox_item_id: item.id,
        file_name: item.file_name,
        email_subject: item.email_subject || item.subject,
        patient_name: item.patient_name,
        success: result.success,
        skipped: result.skipped || false,
        reason: result.reason || result.eligibility?.reason || null,
        trello_card_url: result.trello_card_url || null,
        routing: result.routing || null,
        attachment_status: result.attachment_status || null,
        attachment_error: result.attachment_error || null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to auto-create Trello task.";

      await supabaseAdmin
        .from("ai_inbox_items")
        .update({
          trello_auto_task_status: "failed",
          trello_auto_task_error: errorMessage,
          trello_auto_task_attempted_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      results.push({
        inbox_item_id: item.id,
        file_name: item.file_name,
        email_subject: item.email_subject || item.subject,
        success: false,
        error: errorMessage,
      });
    }
  }

  return NextResponse.json({
    success: true,
    mode: "filtered_recent_processed_correspondence",
    scanned_items: scanned.length,
    eligible_items: eligible.length,
    processed_results: results.length,
    minimum_confidence: minimumConfidence,
    results,
    skipped_preview: skippedBeforeProcessing.slice(0, 15),
    eligible_preview: eligible.slice(0, 10).map((item) => ({
      inbox_item_id: item.id,
      file_name: item.file_name,
      email_subject: item.email_subject || item.subject,
      patient_name: item.patient_name,
      created_at: item.created_at,
      category: item.category,
      attachment_extraction_status: item.attachment_extraction_status,
    })),
  });
}

export async function GET(request: Request) {
  return processAutoTrelloTasks(request);
}

export async function POST(request: Request) {
  return processAutoTrelloTasks(request);
}
