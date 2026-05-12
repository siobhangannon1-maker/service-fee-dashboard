import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

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

    if (!providerId || !importId) {
      return NextResponse.json(
        { error: "Missing providerId or importId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: rows, error } = await supabase
      .from("import_rows_normalized")
      .select("gross_production, collections, item_number, is_excluded")
      .eq("provider_id", providerId)
      .eq("import_id", importId)
      .eq("is_excluded", false);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const grossProductionRaw = (rows || []).reduce(
      (sum, row) => sum + Number(row.gross_production || 0),
      0
    );

    const collectionsRaw = (rows || []).reduce(
      (sum, row) => sum + Number(row.collections || 0),
      0
    );

    const ivFacilityFeesRaw = (rows || [])
      .filter((row) => String(row.item_number || "").trim() === "949")
      .reduce((sum, row) => sum + Number(row.gross_production || 0), 0);

    const grossProduction = grossProductionRaw / 100;
    const collections = collectionsRaw / 100;
    const ivFacilityFees = ivFacilityFeesRaw / 100;
    const serviceFeeBase = grossProduction - ivFacilityFees;

    return NextResponse.json({
      grossProduction,
      collections,
      serviceFeeBase,
      ivFacilityFees,
      debug: {
        providerId,
        importId,
        rowCount: rows?.length || 0,
        grossProductionRaw,
        ivFacilityFeesRaw,
      },
    });
  } catch (error: any) {
    console.error("Provider metrics API error:", error);

    return NextResponse.json(
      { error: error?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}