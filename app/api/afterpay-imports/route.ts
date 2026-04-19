import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("afterpay_imports")
      .select(`
        id,
        source_file_name,
        storage_path,
        provider_id,
        billing_period_id,
        status,
        row_count,
        total_fee_excl_tax,
        imported_entry_id,
        created_at,
        processed_at,
        providers (
          id,
          name
        ),
        billing_periods (
          id,
          label
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const imports = await Promise.all(
      (data || []).map(async (row: any) => {
        let download_url: string | null = null;

        if (row.storage_path) {
          const { data: signedUrlData } = await supabaseAdmin.storage
            .from("afterpay-imports")
            .createSignedUrl(row.storage_path, 60 * 10);

          download_url = signedUrlData?.signedUrl || null;
        }

        return {
          id: row.id,
          file_name: row.source_file_name,
          storage_path: row.storage_path,
          provider_id: row.provider_id,
          provider_name: row.providers?.name ?? null,
          billing_period_id: row.billing_period_id,
          billing_period_label: row.billing_periods?.label ?? null,
          status: row.status,
          row_count: row.row_count,
          total_fee_excl_tax: Number(row.total_fee_excl_tax || 0),
          imported_entry_id: row.imported_entry_id,
          created_at: row.created_at,
          processed_at: row.processed_at,
          download_url,
        };
      })
    );

    return NextResponse.json({ imports });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load Afterpay imports" },
      { status: 500 }
    );
  }
}