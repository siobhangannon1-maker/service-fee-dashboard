import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const uploadId = body.uploadId as string | undefined;
    const billingPeriodId = body.billingPeriodId as string | undefined;

    if (!uploadId || !billingPeriodId) {
      return NextResponse.json(
        { error: "uploadId and billingPeriodId are required." },
        { status: 400 }
      );
    }

    const { data: billingPeriod, error: billingPeriodError } = await supabaseAdmin
      .from("billing_periods")
      .select("id, month, year")
      .eq("id", billingPeriodId)
      .single();

    if (billingPeriodError || !billingPeriod) {
      return NextResponse.json(
        { error: billingPeriodError?.message || "Billing period not found." },
        { status: 500 }
      );
    }

    const { data: existingImport, error: existingImportError } = await supabaseAdmin
      .from("xero_imports")
      .select("id")
      .eq("billing_period_id", billingPeriodId)
      .neq("id", uploadId)
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
            "Another Xero import is already linked to that billing month. Unlink or delete it first.",
        },
        { status: 409 }
      );
    }

    const { error } = await supabaseAdmin
      .from("xero_imports")
      .update({
        billing_period_id: billingPeriodId,
        month: billingPeriod.month,
        year: billingPeriod.year,
      })
      .eq("id", uploadId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to link import" },
      { status: 500 }
    );
  }
}