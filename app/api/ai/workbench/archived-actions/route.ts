import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 100), 200);

    const { data, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .select(
        `
        *,
        ai_cases (
          *,
          ai_decisions (*)
        ),
        ai_email_drafts (*),
        ai_patient_match_candidates (*)
        `
      )
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      items: data || [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load archived Workbench items.",
      },
      { status: 500 }
    );
  }
}