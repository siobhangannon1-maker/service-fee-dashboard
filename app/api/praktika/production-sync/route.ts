import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { fetchPraktikaJson } from "@/lib/praktika/fetch-praktika-json";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeProviderName(value: unknown): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[–—]/g, "-");
}

function normalizeProviderNameCompact(value: unknown): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createBaseProviderName(value: unknown): string {
  return normalizeProviderName(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: unknown): number {
  const num = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function toNullableText(value: unknown): string | null {
  const text = normalizeWhitespace(value);
  return text ? text : null;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

async function loadProviderLookup() {
  const supabase = getClient();

  const [providersResult, mappingsResult] = await Promise.all([
    supabase.from("providers").select("id, name"),
    supabase
      .from("provider_name_mappings")
      .select("provider_id, raw_provider_name, normalized_provider_name, source_type"),
  ]);

  if (providersResult.error) {
    throw new Error(`Failed to load providers: ${providersResult.error.message}`);
  }

  if (mappingsResult.error) {
    throw new Error(`Failed to load provider mappings: ${mappingsResult.error.message}`);
  }

  const lookup = new Map<string, string>();

  for (const provider of providersResult.data ?? []) {
    lookup.set(normalizeProviderName(provider.name), provider.id);
    lookup.set(normalizeProviderNameCompact(provider.name), provider.id);
    lookup.set(createBaseProviderName(provider.name), provider.id);
  }

  for (const mapping of mappingsResult.data ?? []) {
    lookup.set(String(mapping.normalized_provider_name ?? ""), mapping.provider_id);
    lookup.set(normalizeProviderName(mapping.raw_provider_name), mapping.provider_id);
    lookup.set(normalizeProviderNameCompact(mapping.raw_provider_name), mapping.provider_id);
    lookup.set(createBaseProviderName(mapping.raw_provider_name), mapping.provider_id);
  }

  return lookup;
}

function pickFirst(row: any, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }

  return null;
}

function getCompletedDate(row: any): string | null {
  const value = pickFirst(row, [
    "dCompleted",
    "dtCompleted",
    "dtCompletedDate",
    "completed_date",
    "service_date",
    "date",
    "vchCompletedDate",
  ]);

  const text = normalizeWhitespace(value);
  if (!text) return null;

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  const auMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (auMatch) {
    const day = auMatch[1].padStart(2, "0");
    const month = auMatch[2].padStart(2, "0");
    const year = auMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

function sanitizeRawJson(row: any) {
  const blockedKeys = [
    "patient",
    "patientname",
    "vchpatientname",
    "firstname",
    "lastname",
    "dob",
    "dateofbirth",
    "phone",
    "mobile",
    "email",
    "address",
    "medicare",
    "allergies",
    "notes",
  ];

  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const compactKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    cleaned[key] = blockedKeys.some((blocked) => compactKey.includes(blocked))
      ? "[removed]"
      : value;
  }

  return cleaned;
}

type NormalizedProductionRow = {
  import_id: string;
  row_number: number;
  service_date: string | null;
  posted_date: string | null;
  patient_name: null;
  provider_raw: string | null;
  provider_id: string | null;
  item_number: string | null;
  description: string | null;
  gross_production: number;
  collections: number;
  merchant_fees: number;
  lab_fees: number;
  incorrect_provider_amount: number;
  adjustments: number;
  is_excluded: boolean;
  exclusion_reason: string | null;
  needs_review: boolean;
  review_reason: string | null;
  normalized_json: Record<string, unknown>;
};

type BillingPeriodStatusRow = {
  id: string;
  status: string | null;
  label: string | null;
};

async function assertBillingPeriodIsOpen({
  supabase,
  billingPeriodId,
}: {
  supabase: any;
  billingPeriodId: string;
}) {
  const { data, error } = await supabase
    .from("billing_periods")
    .select("id, status, label")
    .eq("id", billingPeriodId)
    .single();

  if (error || !data) {
    throw new Error("Billing period not found.");
  }

  const billingPeriod = data as {
    id: string;
    status: string | null;
    label: string | null;
  };

  if (billingPeriod.status === "locked") {
    throw new Error(
      `This billing period is locked${
        billingPeriod.label ? ` (${billingPeriod.label})` : ""
      }. Unlock it before syncing production.`
    );
  }
}

async function syncProviderMonthlyRecordsFromImport({
  supabase,
  billingPeriodId,
  normalizedRows,
}: {
  supabase: any;
  billingPeriodId: string;
  normalizedRows: NormalizedProductionRow[];
}) {
  const totalsByProvider = new Map<
    string,
    {
      grossProductionRaw: number;
      ivFacilityFeesRaw: number;
    }
  >();

  for (const row of normalizedRows) {
    if (!row.provider_id || row.is_excluded) continue;

    const current = totalsByProvider.get(row.provider_id) ?? {
      grossProductionRaw: 0,
      ivFacilityFeesRaw: 0,
    };

    current.grossProductionRaw += Number(row.gross_production || 0);

    if (String(row.item_number || "").trim() === "949") {
      current.ivFacilityFeesRaw += Number(row.gross_production || 0);
    }

    totalsByProvider.set(row.provider_id, current);
  }

  const providerIds = Array.from(totalsByProvider.keys());

  if (providerIds.length === 0) {
    return {
      providerRecordCount: 0,
      providerRecordsUpdated: 0,
      providerRecordsInserted: 0,
      totalGrossProduction: 0,
      totalIvFacilityFees: 0,
    };
  }

  const { data: existingRecords, error: existingError } = await supabase
    .from("provider_monthly_records")
    .select("id, provider_id")
    .eq("billing_period_id", billingPeriodId)
    .in("provider_id", providerIds);

  if (existingError) {
    throw new Error(`Failed to load provider monthly records: ${existingError.message}`);
  }

  const existingByProvider = new Map<string, string>();

  const existingProviderRecords = (existingRecords ?? []) as Array<{ id: string; provider_id: string }>;

for (const record of existingProviderRecords) {
    existingByProvider.set(String(record.provider_id), String(record.id));
  }

  let providerRecordsUpdated = 0;
  let providerRecordsInserted = 0;
  let totalGrossProduction = 0;
  let totalIvFacilityFees = 0;

  for (const [providerId, totals] of totalsByProvider.entries()) {
    const grossProduction = roundMoney(totals.grossProductionRaw / 100);
    const ivFacilityFees = roundMoney(totals.ivFacilityFeesRaw / 100);

    totalGrossProduction += grossProduction;
    totalIvFacilityFees += ivFacilityFees;

    const existingId = existingByProvider.get(providerId);

    if (existingId) {
      const { error } = await supabase
        .from("provider_monthly_records")
        .update({
          gross_production: grossProduction,
          iv_facility_fees: ivFacilityFees,
        })
        .eq("id", existingId);

      if (error) {
        throw new Error(`Failed to update provider monthly record: ${error.message}`);
      }

      providerRecordsUpdated += 1;
    } else {
      const { error } = await supabase.from("provider_monthly_records").insert({
        provider_id: providerId,
        billing_period_id: billingPeriodId,
        gross_production: grossProduction,
        adjustments: 0,
        incorrect_payments: 0,
        iv_facility_fees: ivFacilityFees,
        other_deductions: 0,
      });

      if (error) {
        throw new Error(`Failed to insert provider monthly record: ${error.message}`);
      }

      providerRecordsInserted += 1;
    }
  }

  return {
    providerRecordCount: providerIds.length,
    providerRecordsUpdated,
    providerRecordsInserted,
    totalGrossProduction: roundMoney(totalGrossProduction),
    totalIvFacilityFees: roundMoney(totalIvFacilityFees),
  };
}

export async function POST(request: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await request.json();

    const billingPeriodId = String(body.billingPeriodId ?? "").trim();
    const fromDate = String(body.fromDate ?? "").trim();
    const toDate = String(body.toDate ?? "").trim();

    if (!billingPeriodId) {
      throw new Error("Missing billing period.");
    }

    if (!isValidIsoDate(fromDate) || !isValidIsoDate(toDate)) {
      throw new Error("Invalid date range.");
    }

    if (fromDate > toDate) {
      throw new Error("From date must be before To date.");
    }

    const practiceId = process.env.PRAKTIKA_PRACTICE_ID;
    if (!practiceId) throw new Error("Missing PRAKTIKA_PRACTICE_ID.");

    const supabase = getClient();

    await assertBillingPeriodIsOpen({
      supabase,
      billingPeriodId,
    });

    const params = new URLSearchParams();
    params.append("sReportName", "completedProcedures");
    params.append("iPracticeIds[]", practiceId);
    params.append("iProviderIds", "");
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);

    const data = await withPraktikaAutoRefresh(
      () =>
        fetchPraktikaJson(
          params,
          "https://praktika.praktika.net.au/v2/reports/completed-procedures",
          mode
        ),
      { mode }
    );

    if (!Array.isArray(data)) {
      throw new Error("Praktika production response was not an array.");
    }

    const providerLookup = await loadProviderLookup();
    const sourceFileName = `Praktika Production Sync ${fromDate} to ${toDate}`;

    const { data: importRow, error: importError } = await supabase
      .from("imports")
      .insert({
        source_file_name: sourceFileName,
        storage_path: `praktika-sync/${fromDate}_${toDate}.json`,
        status: "processed",
        billing_period_id: billingPeriodId,
        month: Number(fromDate.slice(5, 7)),
      })
      .select("id")
      .single();

    if (importError) {
      throw new Error(`Failed to create import: ${importError.message}`);
    }

    const importId = importRow.id as string;

    const rawRows = data.map((row: any, index: number) => ({
      import_id: importId,
      row_number: index + 1,
      raw_json: sanitizeRawJson(row),
    }));

    if (rawRows.length > 0) {
      const { error } = await supabase.from("import_rows_raw").insert(rawRows);
      if (error) throw new Error(`Failed to insert raw rows: ${error.message}`);
    }

    const normalizedRows: NormalizedProductionRow[] = data.map((row: any, index: number) => {
      const providerRaw = normalizeWhitespace(
        pickFirst(row, [
          "vchProvider",
          "vchProviderName",
          "provider_name",
          "provider",
          "Provider",
          "Provider Name",
        ])
      );

      const providerId =
        providerLookup.get(normalizeProviderNameCompact(providerRaw)) ??
        providerLookup.get(normalizeProviderName(providerRaw)) ??
        providerLookup.get(createBaseProviderName(providerRaw)) ??
        null;

      const serviceDate = getCompletedDate(row);

      const itemNumber = toNullableText(
        pickFirst(row, [
          "vchCode",
          "vchADACodeRef",
          "vchItemCode",
          "vchProcedureCode",
          "procedure_code",
          "item_number",
          "Item",
          "Code",
        ])
      );

      const description = toNullableText(
        pickFirst(row, [
          "vchCodeDescShort",
          "vchGroupDesc",
          "vchItemDescription",
          "vchProcedureDescription",
          "description",
          "Description",
        ])
      );

      const productionAmount = toNumber(
        pickFirst(row, [
          "iTotalFee",
          "iScheduledFee",
          "iCost",
          "nActualFee",
          "nActualFees",
          "nFee",
          "nTotal",
          "production",
          "gross_production",
          "amount",
          "Amount",
          "Fee",
        ])
      );

      return {
        import_id: importId,
        row_number: index + 1,
        service_date: serviceDate,
        posted_date: serviceDate,
        patient_name: null,
        provider_raw: providerRaw || null,
        provider_id: providerId,
        item_number: itemNumber,
        description,
        gross_production: productionAmount,
        collections: 0,
        merchant_fees: 0,
        lab_fees: 0,
        incorrect_provider_amount: 0,
        adjustments: 0,
        is_excluded: false,
        exclusion_reason: null,
        needs_review: providerId ? false : true,
        review_reason: providerId ? null : "Provider could not be matched",
        normalized_json: {
          source: "praktika_completedProcedures",
          originalRowKeys: Object.keys(row),
        },
      };
    });

    if (normalizedRows.length > 0) {
      const { error } = await supabase
        .from("import_rows_normalized")
        .insert(normalizedRows);

      if (error) {
        throw new Error(`Failed to insert normalized rows: ${error.message}`);
      }
    }

    await supabase
      .from("billing_period_imports")
      .delete()
      .eq("billing_period_id", billingPeriodId);

    const { error: linkError } = await supabase.from("billing_period_imports").insert({
      billing_period_id: billingPeriodId,
      import_id: importId,
    });

    if (linkError) {
      throw new Error(`Failed to link import to billing period: ${linkError.message}`);
    }

    const providerRecordSummary = await syncProviderMonthlyRecordsFromImport({
      supabase,
      billingPeriodId,
      normalizedRows,
    });

    return NextResponse.json({
      ok: true,
      importId,
      rowCount: normalizedRows.length,
      providerRecords: providerRecordSummary,
      message: `Synced ${normalizedRows.length} production rows from Praktika and updated ${providerRecordSummary.providerRecordCount} provider monthly records.`,
    });
  } catch (error: any) {
    console.error("Praktika production sync failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Praktika production sync failed.",
      },
      { status: 500 }
    );
  }
}