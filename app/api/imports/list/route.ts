import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey);
}

function detectSource(name: string | null): "CSV" | "Praktika" {
  if (!name) return "CSV";
  return name.toLowerCase().includes("praktika") ? "Praktika" : "CSV";
}

export async function GET() {
  try {
    const supabase = getClient();

    // 1. Load imports
    const { data: imports, error } = await supabase
      .from("imports")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!imports || imports.length === 0) {
      return NextResponse.json({ imports: [] });
    }

    const importIds = imports.map((i) => i.id);

    // 2. Get row counts
    const { data: rowCountsData } = await supabase
      .from("import_rows_normalized")
      .select("import_id")
      .in("import_id", importIds);

    const rowCountMap: Record<string, number> = {};

    for (const row of rowCountsData || []) {
      rowCountMap[row.import_id] =
        (rowCountMap[row.import_id] || 0) + 1;
    }

    // 3. Get linked imports
    const { data: linkedData } = await supabase
      .from("billing_period_imports")
      .select("import_id");

    const linkedSet = new Set(
      (linkedData || []).map((r) => r.import_id)
    );

    // 4. Build final response
    const enhanced = imports.map((imp) => {
      return {
        id: imp.id,
        source_file_name: imp.source_file_name,
        storage_path: imp.storage_path,
        status: imp.status,
        created_at: imp.created_at,
        billing_period_id: imp.billing_period_id,
        month: imp.month,

        // FIXED FIELDS
        row_count: rowCountMap[imp.id] || 0,
        linked: linkedSet.has(imp.id),
        source: detectSource(imp.source_file_name),
      };
    });

    return NextResponse.json({ imports: enhanced });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load imports" },
      { status: 500 }
    );
  }
}