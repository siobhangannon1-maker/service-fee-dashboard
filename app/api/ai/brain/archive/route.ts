import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);

    const { inboxItemId, reason } = await req.json();

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

    const { data: latestDraft } = await supabaseAdmin
      .from("ai_email_drafts")
      .select("*")
      .eq("inbox_item_id", inboxItemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const now = new Date().toISOString();
    const archiveReason = String(reason || "Archived from AI Reception Workbench").trim();

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        status: "archived",
        email_status: "archived",
        archived_at: now,
        archived_by: user.id,
        archive_reason: archiveReason,
      })
      .eq("id", inboxItemId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      case_id: latestDraft?.case_id || null,
      draft_id: latestDraft?.id || null,
      actor_id: user.id,
      event_type: "archived",
      event_summary: "Item was archived from the AI Reception Workbench.",
      previous_values: {
        status: item.status,
        email_status: item.email_status,
        archived_at: item.archived_at || null,
      },
      new_values: {
        status: "archived",
        email_status: "archived",
        archived_at: now,
        archive_reason: archiveReason,
      },
      metadata: {
        sender_email: item.sender_email || null,
        subject: item.email_subject || item.subject || null,
      },
    });

    return NextResponse.json({
      success: true,
      item: updatedItem,
    });
  } catch (error: any) {
    console.error("Archive workbench item error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to archive item." },
      { status: 500 }
    );
  }
}