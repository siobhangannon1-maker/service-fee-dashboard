import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findSentMessageByConversationId,
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

    if (!item.outlook_conversation_id) {
      return NextResponse.json(
        {
          error:
            "No Outlook conversation ID found. Create an Outlook draft first.",
        },
        { status: 400 }
      );
    }

    const { data: latestDraft } = await supabaseAdmin
      .from("ai_email_drafts")
      .select("*")
      .eq("inbox_item_id", inboxItemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const sentMessage = await findSentMessageByConversationId({
      mailbox: outlookSharedMailbox,
      conversationId: item.outlook_conversation_id,
    });

    if (!sentMessage) {
      await supabaseAdmin.from("ai_workbench_audit_events").insert({
        inbox_item_id: inboxItemId,
        case_id: latestDraft?.case_id || null,
        draft_id: latestDraft?.id || null,
        actor_id: user.id,
        event_type: "sent_check_no_match",
        event_summary:
          "Checked Outlook Sent Items but no matching sent message was found.",
        previous_values: {
          email_status: item.email_status,
        },
        new_values: {
          email_status: item.email_status,
        },
        metadata: {
          mailbox: outlookSharedMailbox,
          outlook_conversation_id: item.outlook_conversation_id,
        },
      });

      return NextResponse.json({
        success: true,
        sent: false,
        message: "No matching sent email found yet.",
      });
    }

    const detectedAt = new Date().toISOString();
    const sentAt = sentMessage.sentDateTime || detectedAt;

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        email_status: "sent_manually",
        draft_status: "sent",
        sent_at: sentAt,
        sent_detected_at: detectedAt,
        sent_detection_method: "outlook_sent_items_conversation_id",
        outlook_sent_message_id: sentMessage.id,
        outlook_sent_web_link: sentMessage.webLink || null,
      })
      .eq("id", inboxItemId);

    if (latestDraft?.id) {
      await supabaseAdmin
        .from("ai_email_drafts")
        .update({
          status: "sent",
          sent_detected_at: detectedAt,
          sent_detection_method: "outlook_sent_items_conversation_id",
          outlook_sent_message_id: sentMessage.id,
          outlook_sent_web_link: sentMessage.webLink || null,
          updated_at: detectedAt,
        })
        .eq("id", latestDraft.id);
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      case_id: latestDraft?.case_id || null,
      draft_id: latestDraft?.id || null,
      actor_id: user.id,
      event_type: "outlook_sent_detected",
      event_summary:
        "Matching sent email was detected in Outlook Sent Items.",
      previous_values: {
        email_status: item.email_status,
        draft_status: item.draft_status,
        sent_at: item.sent_at || null,
      },
      new_values: {
        email_status: "sent_manually",
        draft_status: "sent",
        sent_at: sentAt,
        sent_detected_at: detectedAt,
        outlook_sent_message_id: sentMessage.id,
      },
      metadata: {
        mailbox: outlookSharedMailbox,
        sent_message: sentMessage,
      },
    });

    return NextResponse.json({
      success: true,
      sent: true,
      sentMessage,
    });
  } catch (error: any) {
    console.error("Check Outlook sent error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to check Outlook sent status." },
      { status: 500 }
    );
  }
}