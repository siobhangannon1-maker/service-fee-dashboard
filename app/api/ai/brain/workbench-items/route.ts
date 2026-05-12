import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIVE_STATUSES = [
  "uploaded",
  "processing",
  "classified",
  "classification_failed",
  "pending",
  "drafted",
  "ready_to_send",
  "outlook_draft_created",
];

function cleanSearch(value: string | null) {
  return String(value || "")
    .trim()
    .replace(/[%_]/g, "")
    .slice(0, 120);
}

export async function GET(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 75), 150);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const status = String(url.searchParams.get("status") || "active");
    const search = cleanSearch(url.searchParams.get("q"));

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
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status === "archived") {
      query = query.not("archived_at", "is", null);
    } else if (!includeArchived) {
      query = query.is("archived_at", null).in("status", ACTIVE_STATUSES);
    }

    if (search) {
      const pattern = `%${search}%`;
      query = query.or(
        [
          `patient_name.ilike.${pattern}`,
          `file_name.ilike.${pattern}`,
          `email_subject.ilike.${pattern}`,
          `subject.ilike.${pattern}`,
          `sender_name.ilike.${pattern}`,
          `sender_email.ilike.${pattern}`,
          `summary.ilike.${pattern}`,
          `suggested_action.ilike.${pattern}`,
          `praktika_patient_id.ilike.${pattern}`,
          `praktika_patient_number.ilike.${pattern}`,
          `extracted_patient_first_name.ilike.${pattern}`,
          `extracted_patient_last_name.ilike.${pattern}`,
          `extracted_patient_dob.ilike.${pattern}`,
          `archive_reason.ilike.${pattern}`,
        ].join(","),
      );
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      items: data || [],
      meta: {
        limit,
        includeArchived,
        status,
        search,
      },
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
