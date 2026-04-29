import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { getAppointmentCategory } from "@/lib/appointmentCategories";

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

type RawRow = Record<string, string | undefined>;

type ProviderRow = {
  id: string;
  name: string | null;
};

type ProviderNameMappingRow = {
  provider_id: string;
  raw_provider_name: string;
  normalized_provider_name: string;
  source_type: "appointments_csv" | "provider_performance_csv" | "cancellations_csv";
};

type ProviderCancellationFtaRawInsert = {
  source_file_name: string;
  import_batch_id: string;

  provider_id: string | null;
  provider_name_raw: string;
  provider_name_normalized: string;

  event_date: string;
  event_time: string | null;

  patient_name_raw: string | null;
  treatment_type: string | null;
  appointment_category: string;

  status_raw: string | null;
  next_appointment_raw: string | null;

  has_next_appointment: boolean;
  is_fta: boolean;
  is_cancellation: boolean;
  is_fta_no_rebooking: boolean;
  is_cancellation_no_rebooking: boolean;
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

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeProviderName(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[–—]/g, "-");
}

function createBaseProviderName(value: string | null | undefined): string {
  return normalizeProviderName(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string | null | undefined): string {
  return normalizeWhitespace(value).toLowerCase();
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = normalizeWhitespace(value);
  return trimmed ? trimmed : null;
}

function getString(row: RawRow, possibleKeys: string[]): string {
  for (const key of possibleKeys) {
    const value = row[key];

    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function parseAustralianDateToIso(value: string): string {
  const trimmed = normalizeWhitespace(value);

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const auMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (auMatch) {
    const [, dd, mm, yyyy] = auMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  throw new Error(`Invalid cancellation/FTA date "${value}". Expected dd/mm/yyyy or yyyy-mm-dd.`);
}

function deriveHasNextAppointment(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);

  if (!normalized) return false;

  return !["no", "n", "false", "0", "none", "null", "-"].includes(normalized);
}

function deriveIsFta(status: string | null | undefined): boolean {
  return normalizeText(status) === "fta";
}

function deriveIsCancellation(status: string | null | undefined): boolean {
  const normalized = normalizeText(status);

  return (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "cancellation" ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled")
  );
}

function buildUnmatchedProvidersSummary(rows: ProviderCancellationFtaRawInsert[]) {
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

async function loadProviderLookup() {
  const supabase = getServiceRoleSupabaseClient();

  const [mappingsResult, providersResult] = await Promise.all([
    supabase
      .from("provider_name_mappings")
      .select("provider_id, raw_provider_name, normalized_provider_name, source_type")
      .in("source_type", ["appointments_csv", "cancellations_csv"]),
    supabase.from("providers").select("id, name"),
  ]);

  if (mappingsResult.error) {
    throw new Error(`Failed to load provider name mappings: ${mappingsResult.error.message}`);
  }

  if (providersResult.error) {
    throw new Error(`Failed to load providers: ${providersResult.error.message}`);
  }

  const lookup = new Map<string, string>();

  const providers = (providersResult.data ?? []) as ProviderRow[];
  for (const provider of providers) {
    if (!provider.name) continue;

    lookup.set(normalizeProviderName(provider.name), provider.id);
    lookup.set(createBaseProviderName(provider.name), provider.id);
  }

  const mappings = (mappingsResult.data ?? []) as ProviderNameMappingRow[];

  for (const mapping of mappings) {
    if (mapping.source_type !== "appointments_csv") continue;

    lookup.set(mapping.normalized_provider_name, mapping.provider_id);
    lookup.set(normalizeProviderName(mapping.raw_provider_name), mapping.provider_id);
    lookup.set(createBaseProviderName(mapping.raw_provider_name), mapping.provider_id);
  }

  for (const mapping of mappings) {
    if (mapping.source_type !== "cancellations_csv") continue;

    lookup.set(mapping.normalized_provider_name, mapping.provider_id);
    lookup.set(normalizeProviderName(mapping.raw_provider_name), mapping.provider_id);
    lookup.set(createBaseProviderName(mapping.raw_provider_name), mapping.provider_id);
  }

  return lookup;
}

function parseCancellationFtaCsvRow(row: RawRow): Omit<
  ProviderCancellationFtaRawInsert,
  "source_file_name" | "import_batch_id" | "provider_id"
> {
  const providerNameRaw = getString(row, [
    "Provider",
    "Provider Name",
    "Practitioner",
    "Practitioner Name",
    "Clinician",
    "Clinician Name",
  ]);

  if (!providerNameRaw) {
    throw new Error("Missing provider name in cancellations/FTAs CSV.");
  }

  const dateRaw = getString(row, ["Date", "Event Date", "Appointment Date", "Appt Date"]);

  if (!dateRaw) {
    throw new Error("Missing date in cancellations/FTAs CSV.");
  }

  const treatmentType = nullableText(
    getString(row, ["Treatment Type", "Appointment Type", "Type", "Reason", "Tx Type"])
  );

  const statusRaw = nullableText(getString(row, ["Status", "Appt Status", "Appointment Status"]));

  const nextAppointmentRaw = nullableText(
    getString(row, [
      "Next Appointment",
      "Following Appointment",
      "Next Appt",
      "Rebooked Appointment",
    ])
  );

  const eventDate = parseAustralianDateToIso(dateRaw);
  const providerNameNormalized = normalizeProviderName(providerNameRaw);
  const hasNextAppointment = deriveHasNextAppointment(nextAppointmentRaw);
  const isFta = deriveIsFta(statusRaw);
  const isCancellation = deriveIsCancellation(statusRaw);

  return {
    provider_name_raw: providerNameRaw,
    provider_name_normalized: providerNameNormalized,

    event_date: eventDate,
    event_time: nullableText(getString(row, ["Time", "Event Time", "Appointment Time"])),

    patient_name_raw: nullableText(
      getString(row, ["Patient", "Patient Name", "Client", "Client Name"])
    ),

    treatment_type: treatmentType,
    appointment_category: getAppointmentCategory(treatmentType),

    status_raw: statusRaw,
    next_appointment_raw: nextAppointmentRaw,

    has_next_appointment: hasNextAppointment,
    is_fta: isFta,
    is_cancellation: isCancellation,
    is_fta_no_rebooking: isFta && !hasNextAppointment,
    is_cancellation_no_rebooking: isCancellation && !hasNextAppointment,
  };
}

export async function importProviderCancellationsFtasCsv(
  params: ImportProviderCancellationsFtasCsvParams
): Promise<ImportProviderCancellationsFtasCsvResult> {
  const supabase = getServiceRoleSupabaseClient();
  const sourceFileName =
    params.sourceFileName ?? params.filePath.split("/").pop() ?? "provider-cancellations-ftas.csv";
  const importBatchId = createImportBatchId();

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

  const providerLookup = await loadProviderLookup();
  const inserts: ProviderCancellationFtaRawInsert[] = [];

  for (const row of rows) {
    const parsed = parseCancellationFtaCsvRow(row);
    const providerId =
      providerLookup.get(parsed.provider_name_normalized) ??
      providerLookup.get(createBaseProviderName(parsed.provider_name_raw)) ??
      null;

    inserts.push({
      source_file_name: sourceFileName,
      import_batch_id: importBatchId,
      provider_id: providerId,
      ...parsed,
    });
  }

  const chunks = chunkArray(inserts, 500);

  for (const chunk of chunks) {
    const { error } = await supabase.from("provider_cancellations_ftas_raw").insert(chunk);

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