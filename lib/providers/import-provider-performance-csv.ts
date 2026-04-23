import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import {
  ProviderPerformanceCsvRow,
  parseProviderPerformanceCsvRow,
} from "./parse-provider-performance-csv-row";

type ImportProviderPerformanceCsvParams = {
  filePath: string;
  sourceFileName?: string;
  periodStart: string; // dd/mm/yyyy
  periodEnd: string; // dd/mm/yyyy
};

type ImportProviderPerformanceCsvResult = {
  sourceFileName: string;
  importBatchId: string;
  insertedCount: number;
  unmatchedProviders: Array<{
    providerNameRaw: string;
    providerNameNormalized: string;
    occurrences: number;
  }>;
};

type ProviderPerformanceRawInsert = {
  source_file_name: string;
  import_batch_id: string;

  provider_id: string | null;
  provider_name_raw: string;
  provider_name_normalized: string;

  period_start: string;
  period_end: string;

  patients_treated: number;
  appointments_completed: number;
  hours_scheduled: number;
  hours_appointed: number;
  hours_billed: number;
  revenue: number;
  ftas: number;
  cancellations: number;

  production_per_hour_appointed: number;
  production_per_hour_billed: number;
};

type ProviderNameMappingRow = {
  provider_id: string;
  raw_provider_name: string;
  normalized_provider_name: string;
  source_type: "appointments_csv" | "provider_performance_csv";
};

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function createImportBatchId(): string {
  return randomUUID();
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildUnmatchedProvidersSummary(rows: ProviderPerformanceRawInsert[]) {
  const map = new Map<
    string,
    { providerNameRaw: string; providerNameNormalized: string; occurrences: number }
  >();

  for (const row of rows) {
    if (row.provider_id) continue;

    const existing = map.get(row.provider_name_normalized);

    if (existing) {
      existing.occurrences += 1;
      continue;
    }

    map.set(row.provider_name_normalized, {
      providerNameRaw: row.provider_name_raw,
      providerNameNormalized: row.provider_name_normalized,
      occurrences: 1,
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.providerNameRaw.localeCompare(b.providerNameRaw)
  );
}

async function loadPerformanceProviderMappings() {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, raw_provider_name, normalized_provider_name, source_type")
    .eq("source_type", "provider_performance_csv");

  if (error) {
    throw new Error(`Failed to load provider name mappings: ${error.message}`);
  }

  const rows = (data ?? []) as ProviderNameMappingRow[];
  const map = new Map<string, string>();

  for (const row of rows) {
    map.set(row.normalized_provider_name, row.provider_id);
  }

  return map;
}

export async function importProviderPerformanceCsv(
  params: ImportProviderPerformanceCsvParams
): Promise<ImportProviderPerformanceCsvResult> {
  const supabase = getServiceRoleSupabaseClient();
  const sourceFileName =
    params.sourceFileName ?? params.filePath.split("/").pop() ?? "provider-performance.csv";
  const importBatchId = createImportBatchId();

  const fileContents = await fs.readFile(params.filePath, "utf8");

  const rows = parse(fileContents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ProviderPerformanceCsvRow[];

  if (!rows.length) {
    return {
      sourceFileName,
      importBatchId,
      insertedCount: 0,
      unmatchedProviders: [],
    };
  }

  const providerMappings = await loadPerformanceProviderMappings();

  const inserts: ProviderPerformanceRawInsert[] = [];

  for (const row of rows) {
    const parsed = parseProviderPerformanceCsvRow(row, {
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    });

    const providerId = providerMappings.get(parsed.providerNameNormalized) ?? null;

    inserts.push({
      source_file_name: sourceFileName,
      import_batch_id: importBatchId,

      provider_id: providerId,
      provider_name_raw: parsed.providerNameRaw,
      provider_name_normalized: parsed.providerNameNormalized,

      period_start: parsed.periodStart,
      period_end: parsed.periodEnd,

      patients_treated: parsed.patientsTreated,
      appointments_completed: parsed.appointmentsCompleted,
      hours_scheduled: parsed.hoursScheduled,
      hours_appointed: parsed.hoursAppointed,
      hours_billed: parsed.hoursBilled,
      revenue: parsed.revenue,
      ftas: parsed.ftas,
      cancellations: parsed.cancellations,

      production_per_hour_appointed: parsed.productionPerHourAppointed,
      production_per_hour_billed: parsed.productionPerHourBilled,
    });
  }

  const chunks = chunkArray(inserts, 500);

  for (const chunk of chunks) {
    const { error } = await supabase.from("provider_performance_raw").insert(chunk);

    if (error) {
      throw new Error(`Failed to insert provider performance rows: ${error.message}`);
    }
  }

  return {
    sourceFileName,
    importBatchId,
    insertedCount: inserts.length,
    unmatchedProviders: buildUnmatchedProvidersSummary(inserts),
  };
}