import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const importId = body.importId as string | undefined;
    const billingPeriodId = body.billingPeriodId as string | undefined;

    if (!importId || !billingPeriodId) {
      return NextResponse.json(
        { error: "importId and billingPeriodId are required." },
        { status: 400 }
      );
    }

    const { data: importRow, error: importFetchError } = await supabaseAdmin
      .from("afterpay_imports")
      .select("id, provider_id, imported_entry_id")
      .eq("id", importId)
      .single();

    if (importFetchError || !importRow) {
      return NextResponse.json(
        { error: importFetchError?.message || "Import not found." },
        { status: 404 }
      );
    }

    const { data: billingPeriod, error: periodError } = await supabaseAdmin
      .from("billing_periods")
      .select("id, status")
      .eq("id", billingPeriodId)
      .single();

    if (periodError || !billingPeriod) {
      return NextResponse.json(
        { error: periodError?.message || "Billing period not found." },
        { status: 404 }
      );
    }

    if (billingPeriod.status === "locked") {
      return NextResponse.json(
        { error: "This billing period is locked." },
        { status: 400 }
      );
    }

    const { data: existingImport, error: existingImportError } = await supabaseAdmin
      .from("afterpay_imports")
      .select("id")
      .eq("provider_id", importRow.provider_id)
      .eq("billing_period_id", billingPeriodId)
      .neq("id", importId)
      .limit(1)
      .maybeSingle();

    if (existingImportError) {
      return NextResponse.json(
        { error: existingImportError.message },
        { status: 500 }
      );
    }

    if (existingImport) {
      return NextResponse.json(
        {
          error:
            "Another Afterpay import already exists for this provider and billing month.",
        },
        { status: 409 }
      );
    }

    const { error: updateImportError } = await supabaseAdmin
      .from("afterpay_imports")
      .update({ billing_period_id: billingPeriodId })
      .eq("id", importId);

    if (updateImportError) {
      return NextResponse.json(
        { error: updateImportError.message },
        { status: 500 }
      );
    }

    if (importRow.imported_entry_id) {
      const { error: updateEntryError } = await supabaseAdmin
        .from("billing_detail_entries")
        .update({ billing_period_id: billingPeriodId })
        .eq("id", importRow.imported_entry_id);

      if (updateEntryError) {
        return NextResponse.json(
          { error: updateEntryError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to link import" },
      { status: 500 }
    );
  }
}