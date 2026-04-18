import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("xero_imports")
      .select(`
        id,
        source_file_name,
        storage_path,
        status,
        billing_period_id,
        month,
        year,
        created_at,
        processed_at,
        billing_periods (
          id,
          label
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const imports = (data || []).map((row: any) => ({
      id: row.id,
      file_name: row.source_file_name,
      storage_path: row.storage_path,
      status: row.status || "uploaded",
      created_at: row.created_at,
      processed_at: row.processed_at,
      billing_period_id: row.billing_period_id ?? null,
      billing_period_label: row.billing_periods?.label ?? null,
      month: row.month ?? null,
      year: row.year ?? null,
      linked: !!row.billing_period_id,
      is_processed: row.status === "processed",
    }));

    return NextResponse.json({ imports });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load Xero imports" },
      { status: 500 }
    );
  }
}