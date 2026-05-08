import { NextResponse } from "next/server";

import { processInboxItemPipeline } from "@/lib/ai/brain/processInboxItemPipeline";
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

function hasPendingOcrStatus(item: any) {
  return (
    item.attachment_needs_ocr === true ||
    item.attachment_extraction_status === "ocr_needed" ||
    item.attachment_extraction_status === "ocr_partially_completed"
  );
}

function hasNoTrelloTask(item: any) {
  return !item.trello_card_id && !item.trello_card_url;
}

function isProcessable(item: any) {
  if (item.archived_at) return false;
  if (item.status === "archived") return false;
  if (item.email_status === "archived") return false;
  if (item.source === "manual_upload") return false;
  if (item.source_type === "manual_upload") return false;
  if (item.status === "classification_failed") return false;

  return true;
}

async function processPipelineWorker(request: Request) {
  if (!assertCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);

  const inboxItemId = url.searchParams.get("inboxItemId");
  const forceTrello = url.searchParams.get("forceTrello") === "true";
  const scanLimit = Math.min(Number(url.searchParams.get("scan") || 50), 100);
  const processLimit = Math.min(Number(url.searchParams.get("process") || 1), 5);

  if (inboxItemId) {
    const result = await processInboxItemPipeline({
      inboxItemId,
      forceTrello,
    });

    return NextResponse.json({
      success: true,
      mode: "single_item",
      result,
    });
  }

  const { data: items, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(
      `
      id,
      created_at,
      file_name,
      patient_name,
      sender_email,
      source,
      source_type,
      status,
      email_status,
      category,
      email_subject,
      subject,
      summary,
      attachment_needs_ocr,
      attachment_extraction_status,
      archived_at,
      trello_card_id,
      trello_card_url,
      automation_pipeline_status
      `
    )
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

  const candidates = scanned.filter((item) => {
    if (!isProcessable(item)) return false;

    return hasPendingOcrStatus(item) || hasNoTrelloTask(item);
  });

  const results: any[] = [];

  for (const item of candidates.slice(0, processLimit)) {
    try {
      const result = await processInboxItemPipeline({
        inboxItemId: item.id,
        forceTrello,
      });

      results.push({
        inbox_item_id: item.id,
        file_name: item.file_name,
        email_subject: item.email_subject || item.subject,
        patient_name: item.patient_name,
        success: true,
        result,
      });
    } catch (error) {
      results.push({
        inbox_item_id: item.id,
        file_name: item.file_name,
        email_subject: item.email_subject || item.subject,
        patient_name: item.patient_name,
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Pipeline failed for this item.",
      });
    }
  }

  return NextResponse.json({
    success: true,
    mode: "pipeline_worker",
    scanned_items: scanned.length,
    candidate_items: candidates.length,
    processed_results: results.length,
    results,
    candidate_preview: candidates.slice(0, 10).map((item) => ({
      inbox_item_id: item.id,
      file_name: item.file_name,
      email_subject: item.email_subject || item.subject,
      patient_name: item.patient_name,
      created_at: item.created_at,
      category: item.category,
      attachment_extraction_status: item.attachment_extraction_status,
      trello_card_url: item.trello_card_url,
      automation_pipeline_status: item.automation_pipeline_status,
    })),
  });
}

export async function GET(request: Request) {
  return processPipelineWorker(request);
}

export async function POST(request: Request) {
  return processPipelineWorker(request);
}
