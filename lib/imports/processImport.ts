import Papa from "papaparse";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RawCsvRow = Record<string, string>;

function parseMoney(value: string | null | undefined): number {
  if (!value) return 0;

  const cleaned = value
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .trim();

  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = trimmed.split("/");
  if (parts.length !== 3) return null;

  const day = parts[0].padStart(2, "0");
  const month = parts[1].padStart(2, "0");
  const year = parts[2];

  return `${year}-${month}-${day}`;
}

function normalizeWhitespace(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function cleanProviderName(value: string | null | undefined): string {
  const trimmed = normalizeWhitespace(value);
  return trimmed.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

function makeReviewReason(reasons: string[]): string | null {
  if (reasons.length === 0) return null;
  return reasons.join("; ");
}

type ProviderSummary = {
  provider_id: string;
  gross_production: number;
  collections: number;
  merchant_fees: number;
  lab_fees: number;
  incorrect_provider_amount: number;
  adjustments: number;
  service_fee_base: number;
};

type ProviderItemTotal = {
  provider_id: string;
  item_number: string;
  total_gross_production: number;
  total_collections: number;
  row_count: number;
};

export async function processImport(importId: string) {
  try {
    console.log("STEP A: processImport started", { importId });

    const supabase = supabaseAdmin;

    console.log("STEP B: loading import record");
    const { data: importRecord, error: importError } = await supabase
      .from("imports")
      .select("*")
      .eq("id", importId)
      .single();

    if (importError || !importRecord) {
      throw new Error(`Import record not found: ${importError?.message}`);
    }

    const storagePath = importRecord.storage_path;

    if (!storagePath) {
      throw new Error("Import record is missing storage_path");
    }

    console.log("STEP C: updating import status to processing");
    const { error: processingStatusError } = await supabase
      .from("imports")
      .update({ status: "processing" })
      .eq("id", importId);

    if (processingStatusError) {
      throw new Error(
        `Failed to update import to processing: ${processingStatusError.message}`
      );
    }

    console.log("STEP D: clearing old rows and summaries for re-run");

    const { error: deleteProviderItemTotalsError } = await supabase
      .from("provider_item_totals")
      .delete()
      .eq("import_id", importId);

    if (deleteProviderItemTotalsError) {
      throw new Error(
        `Failed to clear provider item totals: ${deleteProviderItemTotalsError.message}`
      );
    }

    const { error: deleteProviderSummariesError } = await supabase
      .from("provider_monthly_summaries")
      .delete()
      .eq("import_id", importId);

    if (deleteProviderSummariesError) {
      throw new Error(
        `Failed to clear provider summaries: ${deleteProviderSummariesError.message}`
      );
    }

    const { error: deleteNormalizedError } = await supabase
      .from("import_rows_normalized")
      .delete()
      .eq("import_id", importId);

    if (deleteNormalizedError) {
      throw new Error(
        `Failed to clear normalized rows: ${deleteNormalizedError.message}`
      );
    }

    const { error: deleteRawError } = await supabase
      .from("import_rows_raw")
      .delete()
      .eq("import_id", importId);

    if (deleteRawError) {
      throw new Error(`Failed to clear raw rows: ${deleteRawError.message}`);
    }

    console.log("STEP E: downloading CSV from storage", { storagePath });
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("imports")
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new Error(`CSV download failed: ${downloadError?.message}`);
    }

    const csvText = await fileData.text();

    const parsed = Papa.parse<RawCsvRow>(csvText, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
      throw new Error(`CSV parse failed: ${parsed.errors[0].message}`);
    }

    const rawRows = parsed.data;

    if (rawRows.length === 0) {
      throw new Error("No rows found in CSV");
    }

    console.log("STEP F: saving raw rows");
    const rawRowsToInsert = rawRows.map((row, index) => ({
      import_id: importId,
      row_number: index + 1,
      raw_json: row,
    }));

    const { error: rawInsertError } = await supabase
      .from("import_rows_raw")
      .insert(rawRowsToInsert);

    if (rawInsertError) {
      throw new Error(`Failed to insert raw rows: ${rawInsertError.message}`);
    }

    console.log("STEP G: loading providers");
    const { data: providers, error: providersError } = await supabase
      .from("providers")
      .select("id, name");

    if (providersError) {
      throw new Error(`Failed to load providers: ${providersError.message}`);
    }

    const providerMap = new Map<string, string>();

    for (const provider of providers ?? []) {
      const exactKey = normalizeWhitespace(provider.name).toLowerCase();
      const cleanedKey = cleanProviderName(provider.name).toLowerCase();

      if (exactKey) providerMap.set(exactKey, provider.id);
      if (cleanedKey) providerMap.set(cleanedKey, provider.id);
    }

    console.log("STEP H: normalizing rows");
    const normalizedRowsToInsert = rawRows.map((row, index) => {
      const rowNumber = index + 1;

      const serviceDate = parseDate(row["Date"]);
      const patientName = normalizeWhitespace(row["Patient"]);
      const providerRaw = normalizeWhitespace(row["Provider"]);
      const providerClean = cleanProviderName(providerRaw);

      const providerId =
        providerMap.get(providerRaw.toLowerCase()) ??
        providerMap.get(providerClean.toLowerCase()) ??
        null;

      const itemNumber =
        normalizeWhitespace(row["ADA Code"]) || normalizeWhitespace(row["Code"]);

      const description = normalizeWhitespace(row["Description"]);

      const grossProduction = parseMoney(
        row["Billed Fee"] ?? row["Total Fee"] ?? row["Scheduled Fee"]
      );

      const collections = parseMoney(row["Benefits Claimed"]);

      const reviewReasons: string[] = [];

      if (!providerRaw) {
        reviewReasons.push("Missing provider");
      }

      if (providerRaw && !providerId) {
        reviewReasons.push(`Provider not matched: ${providerRaw}`);
      }

      if (!itemNumber) {
        reviewReasons.push("Missing item number");
      }

      if (!serviceDate) {
        reviewReasons.push("Missing or invalid service date");
      }

      return {
        import_id: importId,
        row_number: rowNumber,

        service_date: serviceDate,
        posted_date: null,
        patient_name: patientName || null,

        provider_raw: providerRaw || null,
        provider_id: providerId,

        item_number: itemNumber || null,
        description: description || null,

        gross_production: grossProduction,
        collections,
        merchant_fees: 0,
        lab_fees: 0,
        incorrect_provider_amount: 0,
        adjustments: 0,

        is_excluded: false,
        exclusion_reason: null,

        needs_review: reviewReasons.length > 0,
        review_reason: makeReviewReason(reviewReasons),

        normalized_json: row,
      };
    });

    const { error: normalizedInsertError } = await supabase
      .from("import_rows_normalized")
      .insert(normalizedRowsToInsert);

    if (normalizedInsertError) {
      throw new Error(
        `Failed to insert normalized rows: ${normalizedInsertError.message}`
      );
    }

    console.log("STEP I: building provider summaries");

    const providerSummaryMap = new Map<string, ProviderSummary>();
    const providerItemTotalsMap = new Map<string, ProviderItemTotal>();

    for (const row of normalizedRowsToInsert) {
      if (!row.provider_id) continue;
      if (row.is_excluded) continue;

      const providerId = row.provider_id;
      const itemNumber = row.item_number ?? "";

      if (!providerSummaryMap.has(providerId)) {
        providerSummaryMap.set(providerId, {
          provider_id: providerId,
          gross_production: 0,
          collections: 0,
          merchant_fees: 0,
          lab_fees: 0,
          incorrect_provider_amount: 0,
          adjustments: 0,
          service_fee_base: 0,
        });
      }

      const providerSummary = providerSummaryMap.get(providerId)!;

      const rowGrossProduction = Number(row.gross_production || 0);
      const rowCollections = Number(row.collections || 0);
      const rowMerchantFees = Number(row.merchant_fees || 0);
      const rowLabFees = Number(row.lab_fees || 0);
      const rowIncorrectProviderAmount = Number(row.incorrect_provider_amount || 0);
      const rowAdjustments = Number(row.adjustments || 0);

      providerSummary.gross_production += rowGrossProduction;
      providerSummary.collections += rowCollections;
      providerSummary.merchant_fees += rowMerchantFees;
      providerSummary.lab_fees += rowLabFees;
      providerSummary.incorrect_provider_amount += rowIncorrectProviderAmount;
      providerSummary.adjustments += rowAdjustments;
      providerSummary.service_fee_base += rowGrossProduction;

      if (itemNumber) {
        const itemKey = `${providerId}::${itemNumber}`;

        if (!providerItemTotalsMap.has(itemKey)) {
          providerItemTotalsMap.set(itemKey, {
            provider_id: providerId,
            item_number: itemNumber,
            total_gross_production: 0,
            total_collections: 0,
            row_count: 0,
          });
        }

        const itemTotals = providerItemTotalsMap.get(itemKey)!;
        itemTotals.total_gross_production += Number(row.gross_production || 0);
        itemTotals.total_collections += Number(row.collections || 0);
        itemTotals.row_count += 1;
      }
    }

    const providerSummariesToInsert = Array.from(providerSummaryMap.values()).map(
      (summary) => ({
        import_id: importId,
        provider_id: summary.provider_id,
        gross_production: Number(summary.gross_production.toFixed(2)),
        collections: Number(summary.collections.toFixed(2)),
        merchant_fees: Number(summary.merchant_fees.toFixed(2)),
        lab_fees: Number(summary.lab_fees.toFixed(2)),
        incorrect_provider_amount: Number(
          summary.incorrect_provider_amount.toFixed(2)
        ),
        adjustments: Number(summary.adjustments.toFixed(2)),
        service_fee_base: Number(summary.service_fee_base.toFixed(2)),
      })
    );

    const providerItemTotalsToInsert = Array.from(
      providerItemTotalsMap.values()
    ).map((itemTotal) => ({
      import_id: importId,
      provider_id: itemTotal.provider_id,
      item_number: itemTotal.item_number,
      total_gross_production: Number(
        itemTotal.total_gross_production.toFixed(2)
      ),
      total_collections: Number(itemTotal.total_collections.toFixed(2)),
      row_count: itemTotal.row_count,
    }));

    console.log("STEP J: inserting provider summaries", {
      count: providerSummariesToInsert.length,
    });

    if (providerSummariesToInsert.length > 0) {
      const { error: providerSummariesInsertError } = await supabase
        .from("provider_monthly_summaries")
        .insert(providerSummariesToInsert);

      if (providerSummariesInsertError) {
        throw new Error(
          `Failed to insert provider summaries: ${providerSummariesInsertError.message}`
        );
      }
    }

    console.log("STEP K: inserting provider item totals", {
      count: providerItemTotalsToInsert.length,
    });

    if (providerItemTotalsToInsert.length > 0) {
      const { error: providerItemTotalsInsertError } = await supabase
        .from("provider_item_totals")
        .insert(providerItemTotalsToInsert);

      if (providerItemTotalsInsertError) {
        throw new Error(
          `Failed to insert provider item totals: ${providerItemTotalsInsertError.message}`
        );
      }
    }

    console.log("STEP K2: auto-saving provider monthly records");

    if (importRecord.billing_period_id && providerSummariesToInsert.length > 0) {
      const providerMonthlyRecordsPayload = providerSummariesToInsert.map((summary) => ({
        provider_id: summary.provider_id,
        billing_period_id: importRecord.billing_period_id,
        gross_production: summary.gross_production,
        adjustments: summary.adjustments,
        incorrect_payments: 0,
        iv_facility_fees: 0,
        other_deductions: 0,
      }));

      for (const row of providerMonthlyRecordsPayload) {
        const { data: existingRecord, error: existingRecordError } = await supabase
          .from("provider_monthly_records")
          .select("id")
          .eq("provider_id", row.provider_id)
          .eq("billing_period_id", row.billing_period_id)
          .maybeSingle();

        if (existingRecordError) {
          throw new Error(
            `Failed checking provider monthly record: ${existingRecordError.message}`
          );
        }

        if (existingRecord?.id) {
          const { error: updateError } = await supabase
            .from("provider_monthly_records")
            .update({
              gross_production: row.gross_production,
              adjustments: row.adjustments,
            })
            .eq("id", existingRecord.id);

          if (updateError) {
            throw new Error(
              `Failed updating provider monthly record: ${updateError.message}`
            );
          }
        } else {
          const { error: insertMonthlyRecordError } = await supabase
            .from("provider_monthly_records")
            .insert(row);

          if (insertMonthlyRecordError) {
            throw new Error(
              `Failed inserting provider monthly record: ${insertMonthlyRecordError.message}`
            );
          }
        }
      }
    }

    console.log("STEP L: linking billing period to import");

    if (importRecord.billing_period_id) {
      const { error: billingLinkError } = await supabase
        .from("billing_period_imports")
        .upsert(
          {
            billing_period_id: importRecord.billing_period_id,
            import_id: importId,
          },
          {
            onConflict: "billing_period_id",
          }
        );

      if (billingLinkError) {
        throw new Error(
          `Failed to link billing period to import: ${billingLinkError.message}`
        );
      }
    }

    console.log("STEP M: updating import status to processed");
    const { error: processedStatusError } = await supabase
      .from("imports")
      .update({ status: "processed" })
      .eq("id", importId);

    if (processedStatusError) {
      throw new Error(
        `Failed to update import status: ${processedStatusError.message}`
      );
    }

    const matchedProviderCount = normalizedRowsToInsert.filter(
      (row) => !!row.provider_id
    ).length;

    const needsReviewCount = normalizedRowsToInsert.filter(
      (row) => row.needs_review
    ).length;

    const total949 = providerItemTotalsToInsert
      .filter((row) => row.item_number === "949")
      .reduce((sum, row) => sum + row.total_gross_production, 0);

    return {
      success: true,
      rowCount: rawRowsToInsert.length,
      normalizedCount: normalizedRowsToInsert.length,
      matchedProviderCount,
      needsReviewCount,
      providerSummaryCount: providerSummariesToInsert.length,
      providerItemTotalCount: providerItemTotalsToInsert.length,
      providerMonthlyRecordCount: providerSummariesToInsert.length,
      total949: Number(total949.toFixed(2)),
    };
  } catch (error) {
    console.error("processImport FULL ERROR:", error);
    throw error;
  }
}