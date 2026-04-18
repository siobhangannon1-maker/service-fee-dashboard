import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getProviderMetrics(
  importId: string,
  providerId: string
) {
  const supabase = supabaseAdmin;

  // 1. Get provider summary
  const { data: summary, error: summaryError } = await supabase
    .from("provider_monthly_summaries")
    .select("*")
    .eq("import_id", importId)
    .eq("provider_id", providerId)
    .single();

  if (summaryError) {
    throw new Error(`Failed to load provider summary: ${summaryError.message}`);
  }

  // 2. Get item 949 total (IV Facility Fees)
  const { data: item949, error: itemError } = await supabase
    .from("provider_item_totals")
    .select("*")
    .eq("import_id", importId)
    .eq("provider_id", providerId)
    .eq("item_number", "949")
    .single();

  if (itemError && itemError.code !== "PGRST116") {
    // PGRST116 = no rows found → OK (means zero)
    throw new Error(`Failed to load item 949: ${itemError.message}`);
  }

  return {
    grossProduction: summary?.gross_production ?? 0,
    collections: summary?.collections ?? 0,
    serviceFeeBase: summary?.service_fee_base ?? 0,
    ivFacilityFees: item949?.total_gross_production ?? 0,
  };
}