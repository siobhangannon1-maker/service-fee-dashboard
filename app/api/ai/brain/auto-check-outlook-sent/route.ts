import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findSentMessageByConversationId,
  outlookSharedMailbox,
} from "@/lib/microsoft/graph";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const expectedToken = process.env.AI_WORKBENCH_CRON_SECRET;

    if (!expectedToken) {
      return NextResponse.json(
        { error: "Missing AI_WORKBENCH_CRON_SECRET" },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: items, error: itemsError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("email_status", "outlook_draft_created")
      .not("outlook_conversation_id", "is", null)
      .order("outlook_draft_created_at", { ascending: false })
      .limit(25);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    const results: any[] = [];

    for (const item of items || []) {
      try {
        const sentMessage = await findSentMessageByConversationId({
          mailbox: outlookSharedMailbox,
          conversationId: item.outlook_conversation_id,
        });

        if (!sentMessage) {
          results.push({
            inbox_item_id: item.id,
            sent: false,
          });

          continue;
        }

        const detectedAt = new Date().toISOString();
        const sentAt = sentMessage.sentDateTime || detectedAt;

        const { data: latestDraft } = await supabaseAdmin
          .from("ai_email_drafts")
          .select("*")
          .eq("inbox_item_id", item.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        await supabaseAdmin
          .from("ai_inbox_items")
          .update({
            email_status: "sent_manually",
            draft_status: "sent",
            sent_at: sentAt,
            sent_detected_at: detectedAt,
            sent_detection_method: "auto_outlook_sent_items_conversation_id",
            outlook_sent_message_id: sentMessage.id,
            outlook_sent_web_link: sentMessage.webLink || null,
          })
          .eq("id", item.id);

        if (latestDraft?.id) {
          await supabaseAdmin
            .from("ai_email_drafts")
            .update({
              status: "sent",
              sent_detected_at: detectedAt,
              sent_detection_method: "auto_outlook_sent_items_conversation_id",
              outlook_sent_message_id: sentMessage.id,
              outlook_sent_web_link: sentMessage.webLink || null,
              updated_at: detectedAt,
            })
            .eq("id", latestDraft.id);
        }

        await supabaseAdmin.from("ai_workbench_audit_events").insert({
          inbox_item_id: item.id,
          case_id: latestDraft?.case_id || null,
          draft_id: latestDraft?.id || null,
          actor_id: null,
          event_type: "outlook_sent_auto_detected",
          event_summary:
            "Automated check detected a matching sent email in Outlook Sent Items.",
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

        results.push({
          inbox_item_id: item.id,
          sent: true,
          outlook_sent_message_id: sentMessage.id,
        });
      } catch (itemError: any) {
        results.push({
          inbox_item_id: item.id,
          sent: false,
          error: itemError.message || "Failed to check item.",
        });
      }
    }

    return NextResponse.json({
      success: true,
      checked: results.length,
      results,
    });
  } catch (error: any) {
    console.error("Auto check Outlook sent error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to auto-check sent items." },
      { status: 500 }
    );
  }
}