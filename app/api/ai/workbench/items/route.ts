import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 75), 150);
    const includeArchived = url.searchParams.get("includeArchived") === "true";

    let query = supabaseAdmin
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
        `,
      )
      // Hide bulk document filing rows from normal AI Reception Workbench
      .not("source", "eq", "bulk_document_upload")
      .not("workflow_kind", "eq", "bulk_patient_document_filing")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!includeArchived) {
      query = query.is("archived_at", null);
    }

    const { data, error } = await query;

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
            : "Failed to load Workbench items.",
      },
      { status: 500 },
    );
  }
}