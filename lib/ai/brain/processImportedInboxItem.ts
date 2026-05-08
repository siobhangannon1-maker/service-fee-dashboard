import { processInboxItemPipeline } from "@/lib/ai/brain/processInboxItemPipeline";
import { supabaseAdmin } from "@/lib/supabase/admin";

type EventChainOptions = {
  inboxItemId: string;
  source?: string;
  forceTrello?: boolean;
};

type EventChainResult = {
  success: boolean;
  inboxItemId: string;
  skipped?: boolean;
  reason?: string;
  pipelineResult?: any;
  error?: string;
};

function shouldSkipItem(item: any) {
  if (!item) return "Inbox item not found.";

  if (item.archived_at || item.status === "archived" || item.email_status === "archived") {
    return "Item is archived.";
  }

  if (item.status === "classification_failed") {
    return "Item classification failed.";
  }

  if (item.source === "manual_upload" || item.source_type === "manual_upload") {
    return "Manual uploads are not event-chained from Outlook import.";
  }

  if (item.event_chain_status === "running") {
    return "Event chain is already running.";
  }

  if (item.event_chain_status === "completed" && item.trello_card_id) {
    return "Event chain already completed and Trello card exists.";
  }

  return null;
}

async function markEventChain({
  inboxItemId,
  status,
  source,
  error,
  completed,
}: {
  inboxItemId: string;
  status: string;
  source?: string;
  error?: string | null;
  completed?: boolean;
}) {
  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      event_chain_status: status,
      event_chain_source: source || null,
      event_chain_error: error || null,
      event_chain_started_at:
        status === "running" ? new Date().toISOString() : undefined,
      event_chain_completed_at: completed ? new Date().toISOString() : undefined,
    })
    .eq("id", inboxItemId);
}

export async function processImportedInboxItem({
  inboxItemId,
  source = "import_outlook_inbox",
  forceTrello = false,
}: EventChainOptions): Promise<EventChainResult> {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select(
      `
      id,
      created_at,
      source,
      source_type,
      status,
      email_status,
      archived_at,
      event_chain_status,
      trello_card_id
      `
    )
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    return {
      success: false,
      inboxItemId,
      error: error?.message || "Inbox item not found.",
    };
  }

  const skipReason = shouldSkipItem(item);

  if (skipReason) {
    await markEventChain({
      inboxItemId,
      status: "skipped",
      source,
      error: skipReason,
      completed: true,
    });

    return {
      success: true,
      inboxItemId,
      skipped: true,
      reason: skipReason,
    };
  }

  await markEventChain({
    inboxItemId,
    status: "running",
    source,
    error: null,
  });

  try {
    const pipelineResult = await processInboxItemPipeline({
      inboxItemId,
      forceTrello,
    });

    await markEventChain({
      inboxItemId,
      status: "completed",
      source,
      error: null,
      completed: true,
    });

    return {
      success: true,
      inboxItemId,
      pipelineResult,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Event chain failed.";

    await markEventChain({
      inboxItemId,
      status: "failed",
      source,
      error: errorMessage,
      completed: true,
    });

    return {
      success: false,
      inboxItemId,
      error: errorMessage,
    };
  }
}

export async function processImportedInboxItems({
  inboxItemIds,
  source = "import_outlook_inbox",
  forceTrello = false,
  maxItems = 3,
}: {
  inboxItemIds: string[];
  source?: string;
  forceTrello?: boolean;
  maxItems?: number;
}) {
  const results: EventChainResult[] = [];

  for (const inboxItemId of inboxItemIds.slice(0, maxItems)) {
    const result = await processImportedInboxItem({
      inboxItemId,
      source,
      forceTrello,
    });

    results.push(result);
  }

  return results;
}
