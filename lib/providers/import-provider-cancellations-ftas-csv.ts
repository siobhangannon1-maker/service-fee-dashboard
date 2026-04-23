import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { normalizeProviderName } from "@/lib/providers/normalize-provider-name";

type RawRow = Record<string, string | undefined>;

type ImportProviderCancellationsFtasCsvParams = {
  filePath: string;
  sourceFileName?: string;
};

type ImportProviderCancellationsFtasCsvResult = {
  sourceFileName: string;
  importBatchId: string;
  insertedCount: number;
  unmatchedProviders: Array<{
    providerNameRaw: string;
    providerNameNormalized: string;
    occurrences: number;
  }>;
};

type ProviderNameMappingRow = {
  provider_id: string;
  normalized_provider_name: string;
  source_type: "appointments_csv" | "provider_performance_csv" | "cancellations_ftas_csv";
};

type InsertRow = {
  source_file_name: string;
  import_batch_id: string;
  provider_id: string | null;
  provider_name_raw: string;
  provider_name_normalized: string;
  event_date: string;
  event_time: string | null;
  patient_name_raw: string | null;
  treatment_type: string | null;
  status_raw: string | null;
  next_appointment_raw: string | null;
  has_next_appointment: boolean;
  is_fta: boolean;
  is_cancellation: boolean;
  raw_json: RawRow;
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

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function toNullable(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function parseDdMmYyyyToIsoDate(input: string): string {
  const value = input.trim();
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) {
    throw new Error(`Invalid date: "${input}"`);
  }

  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function isCompletelyBlankRow(row: RawRow): boolean {
  return Object.values(row).every((value) => !(value ?? "").trim());
}

async function loadProviderMappings() {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, normalized_provider_name, source_type")
    .eq("source_type", "cancellations_ftas_csv");

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

function buildUnmatchedProvidersSummary(rows: InsertRow[]) {
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

export async function importProviderCancellationsFtasCsv(
  params: ImportProviderCancellationsFtasCsvParams
): Promise<ImportProviderCancellationsFtasCsvResult> {
  const supabase = getServiceRoleSupabaseClient();
  const sourceFileName =
    params.sourceFileName ??
    params.filePath.split("/").pop() ??
    "provider-cancellations-ftas.csv";

  const importBatchId = randomUUID();
  const fileContents = await fs.readFile(params.filePath, "utf8");

  const rows = parse(fileContents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawRow[];

  if (!rows.length) {
    return {
      sourceFileName,
      importBatchId,
      insertedCount: 0,
      unmatchedProviders: [],
    };
  }

  const providerMappings = await loadProviderMappings();

  const inserts: InsertRow[] = [];

  for (const row of rows) {
    if (isCompletelyBlankRow(row)) {
      continue;
    }

    const providerNameRaw = (row["Provider"] ?? row["Provider Name"] ?? "").trim();
    const appointmentDateRaw = (row["Appointment Date"] ?? row["Date"] ?? "").trim();

    if (!providerNameRaw) {
      continue;
    }

    if (!appointmentDateRaw) {
      continue;
    }

    const providerNameNormalized = normalizeProviderName(providerNameRaw);
    const providerId = providerMappings.get(providerNameNormalized) ?? null;

    const statusRaw = toNullable(row["Status"]);
    const nextAppointmentRaw = toNullable(row["Next Appointment"]);
    const statusNormalized = normalizeText(statusRaw);

    inserts.push({
      source_file_name: sourceFileName,
      import_batch_id: importBatchId,

      provider_id: providerId,
      provider_name_raw: providerNameRaw,
      provider_name_normalized: providerNameNormalized,

      event_date: parseDdMmYyyyToIsoDate(appointmentDateRaw),
      event_time: toNullable(row["Appointment Time"]),

      patient_name_raw: toNullable(row["Patient Name"]),
      treatment_type: toNullable(row["Tx Type"]),

      status_raw: statusRaw,
      next_appointment_raw: nextAppointmentRaw,

      has_next_appointment: Boolean(nextAppointmentRaw),
      is_fta: statusNormalized === "fta",
      is_cancellation: statusNormalized === "cancelled",

      raw_json: row,
    });
  }

  if (!inserts.length) {
    return {
      sourceFileName,
      importBatchId,
      insertedCount: 0,
      unmatchedProviders: [],
    };
  }

  const chunks = chunkArray(inserts, 500);

  for (const chunk of chunks) {
    const { error } = await supabase
      .from("provider_cancellations_ftas_raw")
      .insert(chunk);

    if (error) {
      throw new Error(`Failed to insert provider cancellations/FTAs rows: ${error.message}`);
    }
  }

  return {
    sourceFileName,
    importBatchId,
    insertedCount: inserts.length,
    unmatchedProviders: buildUnmatchedProvidersSummary(inserts),
  };
}