import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  createOutlookDraftMessage,
  createOutlookReplyDraft,
  outlookSharedMailbox,
} from "@/lib/microsoft/graph";

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

    if (!item.sender_email) {
      return NextResponse.json(
        { error: "No sender email found for this inbox item." },
        { status: 400 }
      );
    }

    const { data: latestDraft, error: draftError } = await supabaseAdmin
      .from("ai_email_drafts")
      .select("*")
      .eq("inbox_item_id", inboxItemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftError) {
      return NextResponse.json({ error: draftError.message }, { status: 500 });
    }

    const subject = String(
      latestDraft?.subject ||
        item.draft_reply_subject ||
        `Re: ${item.email_subject || item.file_name || ""}`
    ).trim();

    const body = String(
      latestDraft?.body || item.draft_reply_body || ""
    ).trim();

    if (!body) {
      return NextResponse.json(
        { error: "No draft body found. Generate or save a draft first." },
        { status: 400 }
      );
    }

    let outlookDraft;

    if (item.source_email_message_id) {
      outlookDraft = await createOutlookReplyDraft({
        mailbox: outlookSharedMailbox,
        sourceMessageId: item.source_email_message_id,
        body,
      });
    } else {
      outlookDraft = await createOutlookDraftMessage({
        mailbox: outlookSharedMailbox,
        to: item.sender_email,
        subject,
        body,
      });
    }

    const now = new Date().toISOString();

    if (latestDraft?.id) {
      await supabaseAdmin
        .from("ai_email_drafts")
        .update({
          subject,
          body,
          status: "outlook_draft_created",
          outlook_draft_id: outlookDraft.id,
          outlook_message_id: outlookDraft.id,
          outlook_conversation_id: outlookDraft.conversationId || null,
          outlook_web_link: outlookDraft.webLink || null,
          outlook_draft_created_at: now,
          updated_at: now,
        })
        .eq("id", latestDraft.id);
    }

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        draft_reply_subject: subject,
        draft_reply_body: body,
        draft_status: "outlook_draft_created",
        email_status: "outlook_draft_created",
        outlook_draft_id: outlookDraft.id,
        outlook_message_id: outlookDraft.id,
        outlook_conversation_id: outlookDraft.conversationId || null,
        outlook_web_link: outlookDraft.webLink || null,
        outlook_draft_created_at: now,
      })
      .eq("id", inboxItemId);

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      case_id: latestDraft?.case_id || null,
      draft_id: latestDraft?.id || null,
      actor_id: user.id,
      event_type: "outlook_draft_created",
      event_summary: "Outlook draft was created in the shared reception mailbox.",
      previous_values: {
        email_status: item.email_status,
        draft_status: item.draft_status,
      },
      new_values: {
        email_status: "outlook_draft_created",
        draft_status: "outlook_draft_created",
        outlook_draft_id: outlookDraft.id,
        outlook_web_link: outlookDraft.webLink || null,
      },
      metadata: {
        mailbox: outlookSharedMailbox,
        recipient: item.sender_email,
        subject,
        used_source_message_id: item.source_email_message_id || null,
      },
    });

    return NextResponse.json({
      success: true,
      outlookDraft,
    });
  } catch (error: any) {
    console.error("Create Outlook draft error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to create Outlook draft." },
      { status: 500 }
    );
  }
}