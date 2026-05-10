import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { archiveOutlookMessage } from "@/lib/microsoft/graph";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json().catch(() => ({}));

    const inboxItemId = body.inboxItemId as string | undefined;
    const reason =
      (body.reason as string | undefined) || "Archived from AI Workbench";

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    const { data: existingItem, error: existingItemError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (existingItemError || !existingItem) {
      return NextResponse.json(
        {
          error:
            existingItemError?.message ||
            "Could not find the Workbench item to archive.",
        },
        { status: 404 },
      );
    }

    let outlookArchiveResult: any = null;
    let outlookArchiveError: string | null = null;

    const sourceMessageId =
      existingItem.source_email_message_id ||
      existingItem.outlook_message_id ||
      null;

    /*
      Archive in Outlook as a non-blocking side effect.

      If Microsoft Graph fails, the Workbench archive still succeeds and the
      error is saved for diagnostics.
    */
    if (sourceMessageId) {
      try {
        outlookArchiveResult = await archiveOutlookMessage({
          messageId: sourceMessageId,
        });
      } catch (error) {
        outlookArchiveError =
          error instanceof Error
            ? error.message
            : "Unknown Outlook archive error.";

        console.warn("Outlook archive failed:", outlookArchiveError);
      }
    } else {
      outlookArchiveError =
        "No source Outlook message id was saved for this Workbench item.";
    }

    const now = new Date().toISOString();

    const updatePayload: any = {
      archived_at: now,
      archive_reason: reason,
      email_status: "archived",
      status: "archived",
    };

    if (outlookArchiveResult?.id) {
      updatePayload.outlook_message_id = outlookArchiveResult.id;
      updatePayload.outlook_web_link = outlookArchiveResult.webLink || null;
      updatePayload.outlook_conversation_id =
        outlookArchiveResult.conversationId || existingItem.outlook_conversation_id;
    }

    if (outlookArchiveError) {
      updatePayload.outlook_archive_error = outlookArchiveError;
    }

    const { data: item, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update(updatePayload)
      .eq("id", inboxItemId)
      .select("*")
      .single();

    /*
      If your ai_inbox_items table does not have outlook_archive_error yet,
      retry without that column so archiving still works.
    */
    if (
      updateError &&
      outlookArchiveError &&
      updateError.message.toLowerCase().includes("outlook_archive_error")
    ) {
      delete updatePayload.outlook_archive_error;

      const retry = await supabaseAdmin
        .from("ai_inbox_items")
        .update(updatePayload)
        .eq("id", inboxItemId)
        .select("*")
        .single();

      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }

      await supabaseAdmin.from("ai_workbench_audit_events").insert({
        inbox_item_id: inboxItemId,
        event_type: "archived",
        event_label: "Item archived",
        details: {
          reason,
          archived_at: now,
          outlook_archive_result: outlookArchiveResult,
          outlook_archive_error: outlookArchiveError,
          note: "outlook_archive_error column was not present, so the field was not saved on ai_inbox_items.",
        },
      });

      return NextResponse.json({
        success: true,
        item: retry.data,
        outlook_archive: {
          success: Boolean(outlookArchiveResult?.id),
          result: outlookArchiveResult,
          error: outlookArchiveError,
        },
      });
    }

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { error: auditError } = await supabaseAdmin
      .from("ai_workbench_audit_events")
      .insert({
        inbox_item_id: inboxItemId,
        event_type: "archived",
        event_label: "Item archived",
        details: {
          reason,
          archived_at: now,
          outlook_archive_result: outlookArchiveResult,
          outlook_archive_error: outlookArchiveError,
        },
      });

    if (auditError) {
      console.warn("Archive saved, but audit event failed:", auditError.message);
    }

    return NextResponse.json({
      success: true,
      item,
      outlook_archive: {
        success: Boolean(outlookArchiveResult?.id),
        result: outlookArchiveResult,
        error: outlookArchiveError,
      },
    });
  } catch (error) {
    console.error("Archive item route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to archive item.",
      },
      { status: 500 },
    );
  }
}
