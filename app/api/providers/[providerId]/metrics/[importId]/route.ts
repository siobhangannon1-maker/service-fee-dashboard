import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      providerId: string;
      importId: string;
    }>;
  }
) {
  try {
    const { providerId, importId } = await context.params;

    console.log("API params:", { providerId, importId });

    if (!providerId || !importId) {
      return NextResponse.json(
        { error: "Missing providerId or importId" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: summaryRows, error: summaryError } = await supabase
      .from("provider_monthly_summaries")
      .select("provider_id, import_id, gross_production, collections, service_fee_base")
      .eq("provider_id", providerId)
      .eq("import_id", importId);

    console.log("Summary rows:", summaryRows);
    console.log("Summary error:", summaryError);

    if (summaryError) {
      console.error("Summary query error:", summaryError);
      return NextResponse.json(
        { error: summaryError.message },
        { status: 500 }
      );
    }

    const summary = summaryRows?.[0] ?? null;

    const { data: item949Rows, error: itemError } = await supabase
      .from("provider_item_totals")
      .select("provider_id, import_id, item_number, total_gross_production")
      .eq("provider_id", providerId)
      .eq("import_id", importId)
      .eq("item_number", "949");

    console.log("Item 949 rows:", item949Rows);
    console.log("Item 949 error:", itemError);

    if (itemError) {
      console.error("Item 949 query error:", itemError);
      return NextResponse.json(
        { error: itemError.message },
        { status: 500 }
      );
    }

    const ivFacilityFees = (item949Rows || []).reduce(
      (sum, row) => sum + Number(row.total_gross_production || 0),
      0
    );

    console.log("Calculated ivFacilityFees:", ivFacilityFees);

    return NextResponse.json({
      grossProduction: Number(summary?.gross_production || 0),
      collections: Number(summary?.collections || 0),
      serviceFeeBase: Number(summary?.service_fee_base || 0),
      ivFacilityFees,
    });
  } catch (error: any) {
    console.error("Provider metrics API error:", error);

    return NextResponse.json(
      { error: error?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}