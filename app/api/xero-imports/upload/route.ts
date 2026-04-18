import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const billingPeriodId = formData.get("billing_period_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (!billingPeriodId) {
      return NextResponse.json(
        { error: "Please select a billing month." },
        { status: 400 }
      );
    }

    const { data: existingImport, error: existingImportError } = await supabaseAdmin
      .from("xero_imports")
      .select("id, billing_period_id, status, source_file_name, created_at")
      .eq("billing_period_id", billingPeriodId)
      .order("created_at", { ascending: false })
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
            "A Xero import already exists for this billing month. Unlink or delete it first if you want to replace it.",
        },
        { status: 409 }
      );
    }

    const { data: billingPeriod, error: billingPeriodError } = await supabaseAdmin
      .from("billing_periods")
      .select("id, month, year")
      .eq("id", billingPeriodId)
      .single();

    if (billingPeriodError || !billingPeriod) {
      return NextResponse.json(
        {
          error:
            billingPeriodError?.message || "Selected billing period not found",
        },
        { status: 500 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const safeFileName = `${Date.now()}-${file.name}`;
    const storagePath = safeFileName;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("xero-imports")
      .upload(storagePath, buffer, {
        contentType: file.type || "text/csv",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      );
    }

    const insertPayload = {
      storage_path: storagePath,
      source_file_name: file.name,
      status: "uploaded",
      billing_period_id: billingPeriodId,
      month: billingPeriod.month,
      year: billingPeriod.year,
    };

    const { data: importRow, error: insertError } = await supabaseAdmin
      .from("xero_imports")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !importRow) {
      return NextResponse.json(
        { error: insertError?.message || "Failed to create Xero import row" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      importId: importRow.id,
      message: "CSV uploaded successfully for the selected billing month.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Upload failed" },
      { status: 500 }
    );
  }
}