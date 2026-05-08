import { NextResponse } from "next/server";

import { processImportedInboxItems } from "@/lib/ai/brain/processImportedInboxItem";
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

function isCandidate(item: any) {
  if (item.archived_at) return false;
  if (item.status === "archived") return false;
  if (item.email_status === "archived") return false;
  if (item.status === "classification_failed") return false;
  if (item.source === "manual_upload") return false;
  if (item.source_type === "manual_upload") return false;
  if (item.event_chain_status === "running") return false;

  return true;
}

async function handle(request: Request) {
  if (!assertCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);

  const scanLimit = Math.min(Number(url.searchParams.get("scan") || 25), 100);
  const maxItems = Math.min(Number(url.searchParams.get("process") || 2), 5);
  const forceTrello = url.searchParams.get("forceTrello") === "true";

  const { data: items, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(
      `
      id,
      created_at,
      file_name,
      email_subject,
      source,
      source_type,
      status,
      email_status,
      archived_at,
      event_chain_status,
      automation_pipeline_status,
      trello_card_id,
      trello_card_url
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
  const candidates = scanned.filter(isCandidate);
  const candidateIds = candidates.slice(0, maxItems).map((item) => item.id);

  const results = await processImportedInboxItems({
    inboxItemIds: candidateIds,
    source: "recent_import_event_chain_worker",
    forceTrello,
    maxItems,
  });

  return NextResponse.json({
    success: true,
    mode: "recent_import_event_chain_worker",
    scanned_items: scanned.length,
    candidate_items: candidates.length,
    processed_results: results.length,
    results,
    candidate_preview: candidates.slice(0, 10),
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
