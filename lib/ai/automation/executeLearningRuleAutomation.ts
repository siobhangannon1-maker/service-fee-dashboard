import { supabaseAdmin } from "@/lib/supabase/admin";
import { autoFileInboxItemToPraktika } from "@/lib/ai/brain/praktikaAutoFile";
import { previewLearningRuleAutomationForInboxItem } from "@/lib/ai/automation/learningRuleAutomationPreview";

type Actor = {
  userId?: string | null;
  email?: string | null;
  fullName?: string | null;
  initials?: string | null;
};

function getInitials(name?: string | null, email?: string | null) {
  const cleanName = String(name || "").trim();

  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  const cleanEmail = String(email || "").trim();
  if (cleanEmail) return cleanEmail.slice(0, 2).toUpperCase();

  return "AI";
}

async function writeAuditEvent({
  inboxItemId,
  eventType,
  eventLabel,
  actor,
  details,
}: {
  inboxItemId: string;
  eventType: string;
  eventLabel: string;
  actor?: Actor;
  details?: Record<string, any>;
}) {
  const { error } = await supabaseAdmin.from("ai_workbench_audit_events").insert({
    inbox_item_id: inboxItemId,
    event_type: eventType,
    event_label: eventLabel,
    actor_user_id: actor?.userId || null,
    actor_email: actor?.email || null,
    actor_full_name: actor?.fullName || null,
    actor_initials: actor?.initials || getInitials(actor?.fullName, actor?.email),
    details: details || {},
    metadata: details || {},
  });

  if (error) {
    console.error("Automation audit insert failed:", error);
  }
}

async function archiveInboxItemSafely({
  inboxItemId,
  actor,
  reason,
  details,
}: {
  inboxItemId: string;
  actor?: Actor;
  reason: string;
  details?: Record<string, any>;
}) {
  const archivedAt = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      archived_at: archivedAt,
      archive_reason: reason,
      status: "archived",
    })
    .eq("id", inboxItemId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await writeAuditEvent({
    inboxItemId,
    eventType: "automation_archived",
    eventLabel: "Automation archived inbox item",
    actor,
    details: {
      reason,
      archived_at: archivedAt,
      ...(details || {}),
    },
  });

  return data;
}

function appendExecutionLog(existing: any, entry: Record<string, any>) {
  const existingArray = Array.isArray(existing) ? existing : [];
  return [...existingArray, entry].slice(-50);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeLearningRuleAutomationForInboxItem({
  inboxItemId,
  actor,
}: {
  inboxItemId: string;
  actor?: Actor;
}) {
  const startedAt = new Date().toISOString();

  const { data: beforeItem, error: beforeError } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (beforeError || !beforeItem) {
    return {
      ok: false,
      status: "failed",
      error: beforeError?.message || "Inbox item not found.",
    };
  }

  await supabaseAdmin
    .from("ai_inbox_items")
    .update({
      automation_execution_status: "running",
    })
    .eq("id", inboxItemId);

  try {
    const preview = await previewLearningRuleAutomationForInboxItem({
      inboxItemId,
    });

    const executedActions: string[] = [];
    const skippedActions: Array<{ action: string; reason: string }> = [];
    let latestItem: any = beforeItem;

    await writeAuditEvent({
      inboxItemId,
      eventType: "automation_execution_started",
      eventLabel: "Learning-rule automation execution started",
      actor,
      details: {
        preview,
        started_at: startedAt,
      },
    });

    if (preview.allowedActions.includes("file_to_praktika")) {
      const filingResult = await autoFileInboxItemToPraktika({
        inboxItemId,
        force: false,
      });

      if (!filingResult?.ok) {
  throw new Error("Praktika filing failed.");
}

      executedActions.push("file_to_praktika");

      await writeAuditEvent({
        inboxItemId,
        eventType: "automation_praktika_filing_completed",
        eventLabel: "Automation filed item to Praktika",
        actor,
        details: {
          filingResult,
        },
      });

      // Give Praktika + Supabase updates a brief moment to settle before
      // recalculating the preview. This reduces the need to click twice.
      await wait(1200);
    } else {
      skippedActions.push({
        action: "file_to_praktika",
        reason:
          preview.blockedActions.find(
            (blocked) => blocked.action === "file_to_praktika",
          )?.reason || "Not allowed by preview.",
      });
    }

    /*
      Recalculate preview after filing.

      This is important because archive is only allowed once filing has actually
      completed and the latest ai_inbox_items row reflects that.
    */
    const afterFilingPreview = await previewLearningRuleAutomationForInboxItem({
      inboxItemId,
    });

    if (afterFilingPreview.allowedActions.includes("archive")) {
      latestItem = await archiveInboxItemSafely({
        inboxItemId,
        actor,
        reason: "Auto-archived after safe learning-rule automation completion.",
        details: {
          preview: afterFilingPreview,
          executed_actions_before_archive: executedActions,
        },
      });

      executedActions.push("archive");
    } else {
      skippedActions.push({
        action: "archive",
        reason:
          afterFilingPreview.blockedActions.find(
            (blocked) => blocked.action === "archive",
          )?.reason || "Archive gates not met.",
      });

      const { data: refreshedItem } = await supabaseAdmin
        .from("ai_inbox_items")
        .select("*")
        .eq("id", inboxItemId)
        .single();

      latestItem = refreshedItem || latestItem;
    }

    // One last refresh before writing the final execution status, so the
    // returned item reflects filing/archive changes as accurately as possible.
    const { data: finalRefreshedItem } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (finalRefreshedItem) {
      latestItem = finalRefreshedItem;
    }

    const completedAt = new Date().toISOString();

    const executionEntry = {
      at: completedAt,
      status: "completed",
      executedActions,
      skippedActions,
      preview_before: preview,
      preview_after: afterFilingPreview,
    };

    const finalLog = appendExecutionLog(
      latestItem?.automation_execution_log || beforeItem.automation_execution_log,
      executionEntry,
    );

    const { data: finalItem, error: finalUpdateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        automation_execution_status:
          executedActions.length > 0 ? "completed" : "no_action",
        automation_executed_at: completedAt,
        automation_execution_log: finalLog,
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (finalUpdateError) {
      throw new Error(finalUpdateError.message);
    }

    await writeAuditEvent({
      inboxItemId,
      eventType: "automation_execution_completed",
      eventLabel: "Learning-rule automation execution completed",
      actor,
      details: executionEntry,
    });

    return {
      ok: true,
      status: executedActions.length > 0 ? "completed" : "no_action",
      message:
        executedActions.length > 0
          ? `Automation completed: ${executedActions.join(", ")}.`
          : "Automation ran but no actions were allowed.",
      executedActions,
      skippedActions,
      preview,
      afterFilingPreview,
      item: finalItem,
    };
  } catch (error: any) {
    const failedAt = new Date().toISOString();
    const message = error?.message || "Automation execution failed.";

    const executionEntry = {
      at: failedAt,
      status: "failed",
      error: message,
    };

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        automation_execution_status: "failed",
        automation_executed_at: failedAt,
        automation_execution_log: appendExecutionLog(
          beforeItem.automation_execution_log,
          executionEntry,
        ),
      })
      .eq("id", inboxItemId);

    await writeAuditEvent({
      inboxItemId,
      eventType: "automation_execution_failed",
      eventLabel: "Learning-rule automation execution failed",
      actor,
      details: executionEntry,
    });

    return {
      ok: false,
      status: "failed",
      error: message,
    };
  }
}
