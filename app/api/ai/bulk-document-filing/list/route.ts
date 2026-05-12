import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const batchId = String(url.searchParams.get("batchId") || "").trim();

    if (!batchId) {
      return NextResponse.json(
        { ok: false, error: "Missing batchId." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .select(
        `
        id,
        created_at,
        file_name,
        file_path,
        extracted_patient_first_name,
        extracted_patient_last_name,
        extracted_patient_dob,
        praktika_patient_id,
        praktika_patient_number,
        praktika_match_status,
        praktika_match_confidence,
        praktika_match_reason,
        praktika_match_candidates,
        praktika_filing_status,
        praktika_filing_error,
        praktika_filed_at
      `,
      )
      .eq("bulk_upload_batch_id", batchId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      items: data || [],
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to load bulk filing batch.",
      },
      { status: 500 },
    );
  }
}