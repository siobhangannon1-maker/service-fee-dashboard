import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { fetchPraktikaJson } from "@/lib/praktika/fetch-praktika-json";
import { withPraktikaAutoRefresh } from "@/lib/praktika/seamless-request";

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
    if (blockedKeys.some((blocked) => compactKey.includes(blocked))) {
      cleaned[key] = "[removed]";
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

export async function POST(request: Request) {
  try {
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

    const params = new URLSearchParams();
    params.append("sReportName", "completedProcedures");
    params.append("iPracticeIds[]", practiceId);
    params.append("iProviderIds", "");
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);

    const data = await withPraktikaAutoRefresh(() =>
      fetchPraktikaJson(
        params,
        "https://praktika.praktika.net.au/v2/reports/completed-procedures",
      ),
    );

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

    const importId = importRow.id;

    const rawRows = data.map((row: any, index: number) => ({
      import_id: importId,
      row_number: index + 1,
      raw_json: sanitizeRawJson(row),
    }));

    if (rawRows.length > 0) {
      const { error } = await supabase.from("import_rows_raw").insert(rawRows);
      if (error) throw new Error(`Failed to insert raw rows: ${error.message}`);
    }

    const normalizedRows = data.map((row: any, index: number) => {
      const providerRaw = normalizeWhitespace(
        pickFirst(row, [
          "vchProvider",
          "vchProviderName",
          "provider_name",
          "provider",
          "Provider",
          "Provider Name",
        ]),
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
        ]),
      );

      const description = toNullableText(
        pickFirst(row, [
          "vchCodeDescShort",
          "vchGroupDesc",
          "vchItemDescription",
          "vchProcedureDescription",
          "description",
          "Description",
        ]),
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
        ]),
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

    return NextResponse.json({
      ok: true,
      importId,
      rowCount: normalizedRows.length,
      message: `Synced ${normalizedRows.length} production rows from Praktika.`,
    });
  } catch (error: any) {
    console.error("Praktika production sync failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Praktika production sync failed.",
      },
      { status: 500 },
    );
  }
}
