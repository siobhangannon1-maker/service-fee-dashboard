import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function detectSource(sourceFileName: string | null): "CSV" | "Praktika" {
  if (!sourceFileName) return "CSV";
  return sourceFileName.toLowerCase().includes("praktika") ? "Praktika" : "CSV";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const billingPeriodId = url.searchParams.get("billingPeriodId");

    if (!billingPeriodId) {
      return NextResponse.json(
        { error: "Missing billingPeriodId" },
        { status: 400 }
      );
    }

    const supabase = getClient();

    const { data: link, error: linkError } = await supabase
      .from("billing_period_imports")
      .select("import_id")
      .eq("billing_period_id", billingPeriodId)
      .maybeSingle();

    if (linkError) {
      throw new Error(linkError.message);
    }

    if (!link?.import_id) {
      return NextResponse.json({ import: null });
    }

    const { data: importRow, error: importError } = await supabase
      .from("imports")
      .select("id, source_file_name, status, created_at, billing_period_id, month")
      .eq("id", link.import_id)
      .maybeSingle();

    if (importError) {
      throw new Error(importError.message);
    }

    if (!importRow) {
      return NextResponse.json({ import: null });
    }

    const { count, error: countError } = await supabase
      .from("import_rows_normalized")
      .select("id", { count: "exact", head: true })
      .eq("import_id", importRow.id);

    if (countError) {
      throw new Error(countError.message);
    }

    return NextResponse.json({
      import: {
        id: importRow.id,
        source_file_name: importRow.source_file_name,
        status: importRow.status,
        created_at: importRow.created_at,
        billing_period_id: importRow.billing_period_id,
        month: importRow.month,
        row_count: count || 0,
        source: detectSource(importRow.source_file_name),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load linked production import" },
      { status: 500 }
    );
  }
}