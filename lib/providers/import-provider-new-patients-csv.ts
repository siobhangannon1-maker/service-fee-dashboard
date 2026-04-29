import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import { normalizeProviderName } from "@/lib/providers/normalize-provider-name";

type ImportProviderNewPatientsCsvParams = {
  filePath: string;
  sourceFileName?: string;
};

type ImportProviderNewPatientsCsvResult = {
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
  normalized_provider_name: string;
};

type ProviderNewPatientRawInsert = {
  source_file_name: string;
  import_batch_id: string;

  joined_date: string;

  patient_name_raw: string | null;

  provider_id: string | null;
  provider_name_raw: string | null;
  provider_name_normalized: string | null;

  next_appointment_raw: string | null;
  has_next_appointment: boolean;

  first_appointment_raw: string | null;
  has_first_appointment: boolean;

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

function nullableText(value: string | null | undefined): string | null {
  const trimmed = normalizeWhitespace(value);
  return trimmed ? trimmed : null;
}

function normalizeHeader(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeProviderNameForMatching(value: string | null | undefined): string {
  return normalizeProviderName(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getString(row: RawRow, possibleKeys: string[]): string {
  for (const key of possibleKeys) {
    const value = row[key];

    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  const wanted = new Set(possibleKeys.map(normalizeHeader));

  for (const [actualKey, actualValue] of Object.entries(row)) {
    if (actualValue === undefined || String(actualValue).trim() === "") continue;

    if (wanted.has(normalizeHeader(actualKey))) {
      return String(actualValue).trim();
    }
  }

  return "";
}

function parseDateToIso(value: string): string {
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

  throw new Error(`Invalid joined date "${value}". Expected dd/mm/yyyy or yyyy-mm-dd.`);
}

function hasAppointmentValue(value: string | null | undefined): boolean {
  const trimmed = normalizeWhitespace(value).toLowerCase();

  if (!trimmed) return false;

  return !["no", "n", "false", "0", "none", "null", "-", "nil"].includes(trimmed);
}

function findProviderValue(row: RawRow): string {
  return getString(row, [
    "First Provider",
    "Provider",
    "Provider Name",
    "Appointment Provider",
    "Appt Provider",
    "Clinician",
    "Clinician Name",
    "Practitioner",
    "Practitioner Name",
    "Doctor",
    "Dentist",
    "Surgeon",
    "Resource",
    "Resource Name",
  ]);
}

function buildUnmatchedProvidersSummary(rows: ProviderNewPatientRawInsert[]) {
  const map = new Map<
    string,
    { providerNameRaw: string; providerNameNormalized: string; occurrences: number }
  >();

  for (const row of rows) {
    if (row.provider_id) continue;
    if (!row.provider_name_raw || !row.provider_name_normalized) continue;

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

async function loadProviderMappings() {
  const supabase = getServiceRoleSupabaseClient();

  const { data: providers, error: providersError } = await supabase
    .from("providers")
    .select("id, name");

  if (providersError) {
    throw new Error(`Failed to load providers: ${providersError.message}`);
  }

  const { data: mappings, error: mappingsError } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, normalized_provider_name");

  if (mappingsError) {
    throw new Error(`Failed to load provider mappings: ${mappingsError.message}`);
  }

  const map = new Map<string, string>();

  for (const provider of (providers ?? []) as ProviderRow[]) {
    if (!provider.name) continue;

    map.set(normalizeProviderName(provider.name), provider.id);
    map.set(normalizeProviderNameForMatching(provider.name), provider.id);
  }

  for (const mapping of (mappings ?? []) as ProviderNameMappingRow[]) {
    map.set(normalizeProviderName(mapping.normalized_provider_name), mapping.provider_id);
    map.set(normalizeProviderNameForMatching(mapping.normalized_provider_name), mapping.provider_id);
  }

  return map;
}

function parseNewPatientCsvRow(row: RawRow): Omit<
  ProviderNewPatientRawInsert,
  "source_file_name" | "import_batch_id" | "provider_id"
> | null {
  const joinedDateRaw = getString(row, [
    "Date Joined",
    "Joined Date",
    "Join Date",
    "Created Date",
    "Date Created",
    "Referral Date",
    "Date",
  ]);

  if (!joinedDateRaw) {
    return null;
  }

  const patientNameRaw = nullableText(
    getString(row, ["Patient Name", "Patient", "Client Name", "Client"])
  );

  const providerNameRaw = nullableText(findProviderValue(row));
  const providerNameNormalized = providerNameRaw ? normalizeProviderName(providerNameRaw) : null;

  const firstAppointmentRaw = nullableText(
    getString(row, [
      "First Appointment",
      "First Appt",
      "First appointment date",
      "First Appointment Date",
      "Booked Appointment",
      "Appointment Date",
      "Initial Appointment",
    ])
  );

  return {
    joined_date: parseDateToIso(joinedDateRaw),
    patient_name_raw: patientNameRaw,

    provider_name_raw: providerNameRaw,
    provider_name_normalized: providerNameNormalized,

    // Keep old columns populated safely for compatibility.
    // Referral booking now uses first_appointment_raw / has_first_appointment.
    next_appointment_raw: null,
    has_next_appointment: false,

    first_appointment_raw: firstAppointmentRaw,
    has_first_appointment: hasAppointmentValue(firstAppointmentRaw),

    raw_json: row,
  };
}

export async function importProviderNewPatientsCsv(
  params: ImportProviderNewPatientsCsvParams
): Promise<ImportProviderNewPatientsCsvResult> {
  const supabase = getServiceRoleSupabaseClient();
  const sourceFileName =
    params.sourceFileName ?? params.filePath.split("/").pop() ?? "provider-new-patients.csv";
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

  const providerMappings = await loadProviderMappings();
  const inserts: ProviderNewPatientRawInsert[] = [];

  for (const row of rows) {
    const parsed = parseNewPatientCsvRow(row);

    if (!parsed) continue;

    const exactProviderId = parsed.provider_name_normalized
      ? providerMappings.get(parsed.provider_name_normalized) ?? null
      : null;

    const baseProviderId = parsed.provider_name_raw
      ? providerMappings.get(normalizeProviderNameForMatching(parsed.provider_name_raw)) ?? null
      : null;

    inserts.push({
      source_file_name: sourceFileName,
      import_batch_id: importBatchId,
      provider_id: exactProviderId ?? baseProviderId,
      ...parsed,
    });
  }

  if (inserts.length === 0) {
    throw new Error(
      "No valid new patient rows found. Check that the CSV has a Date Joined, Joined Date, Referral Date, or Date column."
    );
  }

  const chunks = chunkArray(inserts, 500);

  for (const chunk of chunks) {
    const { error } = await supabase.from("provider_new_patients_raw").insert(chunk);

    if (error) {
      throw new Error(`Failed to insert new patient rows: ${error.message}`);
    }
  }

  return {
    sourceFileName,
    importBatchId,
    insertedCount: inserts.length,
    unmatchedProviders: buildUnmatchedProvidersSummary(inserts),
  };
}
