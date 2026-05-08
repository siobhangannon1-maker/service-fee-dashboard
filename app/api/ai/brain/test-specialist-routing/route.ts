import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireRole(["super_admin"]);

    const { data: rules, error } = await supabaseAdmin
      .from("ai_specialist_routing_rules")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      rules,
      message:
        "Specialist routing rules loaded. Replace REPLACE_WITH_* list IDs in Supabase before creating Trello tasks.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to test specialist routing.",
      },
      { status: 500 }
    );
  }
}
