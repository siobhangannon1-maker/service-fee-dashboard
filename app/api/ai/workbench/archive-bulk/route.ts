import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const inboxItemIds = Array.isArray(body.inboxItemIds)
      ? body.inboxItemIds.map(String).filter(Boolean)
      : [];

    const reason = String(
      body.reason || "Archived from AI Reception Workbench",
    ).trim();

    if (inboxItemIds.length === 0) {
      return NextResponse.json(
        { error: "No inbox items selected." },
        { status: 400 },
      );
    }

    let actorUserId: string | null = null;
    let actorEmail: string | null = null;
    let actorFullName: string | null = null;

    try {
      const supabase = await createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      actorUserId = user?.id || null;
      actorEmail = user?.email || null;

      if (user?.id) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle();

        actorFullName = profile?.full_name || null;
      }
    } catch {
      // Continue without actor data.
    }

    const archivedAt = new Date().toISOString();
    const actorInitials = getInitials(actorFullName, actorEmail);

    const { data: items, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        archived_at: archivedAt,
        archive_reason: reason,
        status: "archived",
      })
      .in("id", inboxItemIds)
      .select("*");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

   const auditRows = inboxItemIds.map((inboxItemId: string) => ({
      inbox_item_id: inboxItemId,
      event_type:
        inboxItemIds.length === 1 ? "workbench_archived" : "bulk_archived",
      event_label:
        inboxItemIds.length === 1
          ? "Inbox item archived"
          : "Inbox item archived by bulk action",
      details: {
        reason,
        archived_at: archivedAt,
        bulk_count: inboxItemIds.length,
        archived_in_workbench: true,
        actor: {
          id: actorUserId,
          email: actorEmail,
          full_name: actorFullName,
          initials: actorInitials,
        },
      },
    }));

    const { error: auditError } = await supabaseAdmin
      .from("ai_workbench_audit_events")
      .insert(auditRows);

    if (auditError) {
      console.error("Archive audit insert failed:", auditError.message);
    }

    return NextResponse.json({
      ok: true,
      message:
        inboxItemIds.length === 1
          ? "Item archived."
          : `${inboxItemIds.length} items archived.`,
      items: items || [],
      auditInserted: !auditError,
      auditError: auditError?.message || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Bulk archive failed." },
      { status: 500 },
    );
  }
}