import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("imports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("imports/list API error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const imports = (data || []).map((row: any) => ({
      id: row.id,
      file_name:
        row.source_file_name ||
        row.file_name ||
        row.filename ||
        row.name ||
        row.original_file_name ||
        row.storage_path ||
        "Untitled import",
      storage_path: row.storage_path || null,
      status: row.status || "unknown",
      created_at: row.created_at,
      billing_period_id: row.billing_period_id ?? null,
      linked: !!row.billing_period_id,
      month: row.month ?? null,
    }));

    return NextResponse.json({ imports });
  } catch (error: any) {
    console.error("imports/list API crash:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load imports" },
      { status: 500 }
    );
  }
}