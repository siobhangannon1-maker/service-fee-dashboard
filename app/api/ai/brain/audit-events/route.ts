import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const { inboxItemId } = await req.json();

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("ai_workbench_audit_events")
      .select("*")
      .eq("inbox_item_id", inboxItemId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      events: data || [],
    });
  } catch (error: any) {
    console.error("Audit events error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to load audit events." },
      { status: 500 }
    );
  }
}