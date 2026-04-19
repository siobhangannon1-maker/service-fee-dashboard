import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ParsedAfterpayRow = Record<string, string>;

function parseCsv(text: string): ParsedAfterpayRow[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(current);
      current = "";

      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    if (row.some((cell) => cell.trim() !== "")) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  return dataRows.map((values) => {
    const record: ParsedAfterpayRow = {};
    headers.forEach((header, index) => {
      record[header] = (values[index] ?? "").trim();
    });
    return record;
  });
}

function parseCurrency(value: string) {
  const cleaned = value.replace(/\$/g, "").replace(/,/g, "").trim();
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

export async function POST(request: Request) {
  let importId: string | null = null;

  try {
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const providerId = formData.get("provider_id") as string | null;
    const billingPeriodId = formData.get("billing_period_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (!providerId || !billingPeriodId) {
      return NextResponse.json(
        { error: "Provider and billing month are required." },
        { status: 400 }
      );
    }

    const { data: billingPeriod, error: billingPeriodError } = await supabaseAdmin
      .from("billing_periods")
      .select("id, label, status")
      .eq("id", billingPeriodId)
      .single();

    if (billingPeriodError || !billingPeriod) {
      return NextResponse.json(
        { error: billingPeriodError?.message || "Billing period not found" },
        { status: 500 }
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
      .eq("provider_id", providerId)
      .eq("billing_period_id", billingPeriodId)
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
            "An Afterpay import already exists for this provider and billing month. Unlink or delete it first.",
        },
        { status: 409 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const safeFileName = `${Date.now()}-${file.name}`;
    const storagePath = safeFileName;

    const { error: uploadError } = await supabaseAdmin.storage
      .from("afterpay-imports")
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

    const { data: importRow, error: insertImportError } = await supabaseAdmin
      .from("afterpay_imports")
      .insert({
        source_file_name: file.name,
        storage_path: storagePath,
        provider_id: providerId,
        billing_period_id: billingPeriodId,
        status: "uploaded",
      })
      .select("id")
      .single();

    if (insertImportError || !importRow) {
      return NextResponse.json(
        { error: insertImportError?.message || "Failed to create import log row" },
        { status: 500 }
      );
    }

    importId = importRow.id;

    const text = buffer.toString("utf8");
    const parsedRows = parseCsv(text);

    if (parsedRows.length === 0) {
      await supabaseAdmin
        .from("afterpay_imports")
        .update({ status: "failed" })
        .eq("id", importId);

      return NextResponse.json(
        { error: "The CSV appears to be empty." },
        { status: 400 }
      );
    }

    if (!("Merchant Fee excl Tax" in parsedRows[0])) {
      await supabaseAdmin
        .from("afterpay_imports")
        .update({ status: "failed" })
        .eq("id", importId);

      return NextResponse.json(
        { error: 'The CSV is missing the "Merchant Fee excl Tax" column.' },
        { status: 400 }
      );
    }

    const totalFeeExclTax = parsedRows.reduce((sum, row) => {
      return sum + parseCurrency(row["Merchant Fee excl Tax"] || "");
    }, 0);

    if (totalFeeExclTax <= 0) {
      await supabaseAdmin
        .from("afterpay_imports")
        .update({ status: "failed" })
        .eq("id", importId);

      return NextResponse.json(
        { error: "The total Merchant Fee excl Tax is zero." },
        { status: 400 }
      );
    }

    const distinctStoreNames = Array.from(
      new Set(
        parsedRows
          .map((row) => row["Store Name"] || "")
          .map((name) => name.trim())
          .filter(Boolean)
      )
    );

    const notesParts = [
      `Imported from Afterpay reconciliation CSV`,
      `File: ${file.name}`,
      `Rows: ${parsedRows.length}`,
    ];

    if (distinctStoreNames.length > 0) {
      notesParts.push(`Store Name: ${distinctStoreNames.join(", ")}`);
    }

    const { data: detailEntry, error: detailError } = await supabaseAdmin
      .from("billing_detail_entries")
      .insert({
        provider_id: providerId,
        billing_period_id: billingPeriodId,
        patient_name: null,
        entry_date: new Date().toISOString().slice(0, 10),
        category: "afterpay_fee",
        amount: Number(totalFeeExclTax.toFixed(2)),
        notes: notesParts.join(" | "),
      })
      .select("id")
      .single();

    if (detailError || !detailEntry) {
      await supabaseAdmin
        .from("afterpay_imports")
        .update({ status: "failed" })
        .eq("id", importId);

      return NextResponse.json(
        { error: detailError?.message || "Failed to insert billing detail entry" },
        { status: 500 }
      );
    }

    const { error: finishError } = await supabaseAdmin
      .from("afterpay_imports")
      .update({
        status: "processed",
        row_count: parsedRows.length,
        total_fee_excl_tax: Number(totalFeeExclTax.toFixed(2)),
        imported_entry_id: detailEntry.id,
        processed_at: new Date().toISOString(),
      })
      .eq("id", importId);

    if (finishError) {
      return NextResponse.json(
        { error: finishError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      importId,
      importedEntryId: detailEntry.id,
      rowCount: parsedRows.length,
      totalFeeExclTax: Number(totalFeeExclTax.toFixed(2)),
      message: "Afterpay CSV uploaded and imported successfully.",
    });
  } catch (error: any) {
    if (importId) {
      await supabaseAdmin
        .from("afterpay_imports")
        .update({ status: "failed" })
        .eq("id", importId);
    }

    return NextResponse.json(
      { error: error?.message || "Upload failed" },
      { status: 500 }
    );
  }
}