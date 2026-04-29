import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

type ImportProviderAppointmentsCsvParams = {
  filePath: string;
  sourceFileName?: string;
};

type ImportProviderAppointmentsCsvResult = {
  sourceFileName: string;
  importBatchId: string;
  insertedCount: number;
  unmatchedProviders: Array<{
    providerNameRaw: string;
    providerNameNormalized: string;
    occurrences: number;
  }>;
};

type ProviderAppointmentsCsvRow = {
  Provider?: string;
  Date?: string;
  Time?: string;
  Duration?: string | number;
  Value?: string | number;
  "Patient Name"?: string;
  "Treatment Type"?: string;
  "Appt Status"?: string;
  "Arrival Status"?: string;
  "Response Status"?: string;
  "Following Appointment"?: string;
};

type ProviderAppointmentsRawInsert = {
  source_file_name: string;
  import_batch_id: string;
  provider_id: string | null;
  provider_name_raw: string;
  provider_name_normalized: string;
  appointment_date: string;
  appointment_start: string;
  appointment_end: string;
  duration_minutes: number;
  patient_name_raw: string | null;
  treatment_type: string | null;
  appointment_value: number;
  appointment_status: string | null;
  arrival_status: string | null;
  response_status: string | null;
  following_appointment_raw: string | null;
  is_cancelled: boolean;
  is_fta: boolean;
  has_following_appointment: boolean;
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

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeProviderName(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function normalizeText(value: string | null | undefined): string {
  return normalizeWhitespace(value ?? "").toLowerCase();
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = normalizeWhitespace(value ?? "");
  return trimmed ? trimmed : null;
}

function isBlank(value: string | null | undefined): boolean {
  return normalizeText(value) === "";
}

function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = (value ?? "").toString().replace(/[$,\s]/g, "");
  if (!cleaned) return 0;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: string | number | null | undefined): number {
  return Math.round(parseNumber(value));
}

function parseAustralianDate(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) {
    throw new Error(`Invalid appointment date "${value}". Expected dd/mm/yyyy`);
  }

  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseTimePart(value: string): { hour: number; minute: number; second: number } {
  const trimmed = normalizeWhitespace(value).toUpperCase();

  const match12h = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (match12h) {
    let hour = Number(match12h[1]);
    const minute = Number(match12h[2]);
    const second = Number(match12h[3] ?? "00");
    const meridiem = match12h[4];

    if (meridiem === "AM" && hour === 12) hour = 0;
    if (meridiem === "PM" && hour !== 12) hour += 12;

    return { hour, minute, second };
  }

  const match24h = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match24h) {
    return {
      hour: Number(match24h[1]),
      minute: Number(match24h[2]),
      second: Number(match24h[3] ?? "00"),
    };
  }

  throw new Error(`Invalid Time value "${value}". Expected format like "09:30 am" or "09:30".`);
}

function buildTimestamp(isoDate: string, hour: number, minute: number, second: number): string {
  return `${isoDate} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(
    second
  ).padStart(2, "0")}`;
}

function buildAppointmentTimes(
  isoDate: string,
  startTimeRaw: string,
  durationMinutes: number
): { appointmentStart: string; appointmentEnd: string } {
  const start = parseTimePart(startTimeRaw);

  const startDate = new Date(
    Number(isoDate.slice(0, 4)),
    Number(isoDate.slice(5, 7)) - 1,
    Number(isoDate.slice(8, 10)),
    start.hour,
    start.minute,
    start.second
  );

  const safeDurationMinutes = Math.max(0, durationMinutes);
  const endDate = new Date(startDate.getTime() + safeDurationMinutes * 60_000);

  const appointmentStart = buildTimestamp(isoDate, start.hour, start.minute, start.second);
  const appointmentEnd = buildTimestamp(
    isoDate,
    endDate.getHours(),
    endDate.getMinutes(),
    endDate.getSeconds()
  );

  return { appointmentStart, appointmentEnd };
}

function deriveHasFollowingAppointment(value: string | null | undefined): boolean {
  const normalized = normalizeText(value);

  if (!normalized) return false;

  return !["no", "n", "false", "0", "none"].includes(normalized);
}

function textIncludesAny(value: string | null | undefined, phrases: string[]): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;

  return phrases.some((phrase) => normalized.includes(phrase));
}

function deriveIsCancelled(params: {
  appointmentStatus: string | null;
  responseStatus: string | null;
}): boolean {
  return (
    textIncludesAny(params.appointmentStatus, ["cancelled", "canceled"]) ||
    textIncludesAny(params.responseStatus, ["cancelled", "canceled"])
  );
}

function deriveIsFta(params: {
  appointmentStatus: string | null;
  arrivalStatus: string | null;
  responseStatus: string | null;
  isCancelled: boolean;
}): boolean {
  if (params.isCancelled) return false;

  return (
    isBlank(params.appointmentStatus) &&
    isBlank(params.arrivalStatus) &&
    isBlank(params.responseStatus)
  );
}

function buildUnmatchedProvidersSummary(rows: ProviderAppointmentsRawInsert[]) {
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

async function loadAppointmentsProviderMappings() {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("provider_name_mappings")
    .select("provider_id, raw_provider_name, normalized_provider_name, source_type")
    .eq("source_type", "appointments_csv");

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

function parseProviderAppointmentsCsvRow(row: ProviderAppointmentsCsvRow): Omit<
  ProviderAppointmentsRawInsert,
  "source_file_name" | "import_batch_id" | "provider_id"
> {
  const providerNameRaw = normalizeWhitespace(row.Provider ?? "");
  if (!providerNameRaw) {
    throw new Error("Missing Provider value");
  }

  const appointmentDateRaw = normalizeWhitespace(row.Date ?? "");
  if (!appointmentDateRaw) {
    throw new Error("Missing Date value");
  }

  const timeRaw = normalizeWhitespace(row.Time ?? "");
  if (!timeRaw) {
    throw new Error("Missing Time value");
  }

  const durationMinutes = parseInteger(row.Duration);
  const appointmentDate = parseAustralianDate(appointmentDateRaw);
  const { appointmentStart, appointmentEnd } = buildAppointmentTimes(
    appointmentDate,
    timeRaw,
    durationMinutes
  );

  const appointmentStatus = nullableText(row["Appt Status"]);
  const arrivalStatus = nullableText(row["Arrival Status"]);
  const responseStatus = nullableText(row["Response Status"]);
  const followingAppointmentRaw = nullableText(row["Following Appointment"]);

  const isCancelled = deriveIsCancelled({
    appointmentStatus,
    responseStatus,
  });

  const isFta = deriveIsFta({
    appointmentStatus,
    arrivalStatus,
    responseStatus,
    isCancelled,
  });

  return {
    provider_name_raw: providerNameRaw,
    provider_name_normalized: normalizeProviderName(providerNameRaw),

    appointment_date: appointmentDate,
    appointment_start: appointmentStart,
    appointment_end: appointmentEnd,
    duration_minutes: durationMinutes,

    patient_name_raw: nullableText(row["Patient Name"]),
    treatment_type: nullableText(row["Treatment Type"]),
    appointment_value: parseNumber(row.Value),

    appointment_status: appointmentStatus,
    arrival_status: arrivalStatus,
    response_status: responseStatus,
    following_appointment_raw: followingAppointmentRaw,

    is_cancelled: isCancelled,
    is_fta: isFta,
    has_following_appointment: deriveHasFollowingAppointment(followingAppointmentRaw),
  };
}

export async function importProviderAppointmentsCsv(
  params: ImportProviderAppointmentsCsvParams
): Promise<ImportProviderAppointmentsCsvResult> {
  const supabase = getServiceRoleSupabaseClient();
  const sourceFileName =
    params.sourceFileName ?? params.filePath.split("/").pop() ?? "provider-appointments.csv";
  const importBatchId = createImportBatchId();

  const fileContents = await fs.readFile(params.filePath, "utf8");

  const rows = parse(fileContents, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ProviderAppointmentsCsvRow[];

  if (!rows.length) {
    return {
      sourceFileName,
      importBatchId,
      insertedCount: 0,
      unmatchedProviders: [],
    };
  }

  const providerMappings = await loadAppointmentsProviderMappings();

  const inserts: ProviderAppointmentsRawInsert[] = [];

  for (const row of rows) {
    const parsed = parseProviderAppointmentsCsvRow(row);
    const providerId = providerMappings.get(parsed.provider_name_normalized) ?? null;

    inserts.push({
      source_file_name: sourceFileName,
      import_batch_id: importBatchId,
      provider_id: providerId,
      ...parsed,
    });
  }

  const chunks = chunkArray(inserts, 500);

  for (const chunk of chunks) {
    const { error } = await supabase.from("provider_appointments_raw").insert(chunk);

    if (error) {
      throw new Error(`Failed to insert provider appointment rows: ${error.message}`);
    }
  }

  return {
    sourceFileName,
    importBatchId,
    insertedCount: inserts.length,
    unmatchedProviders: buildUnmatchedProvidersSummary(inserts),
  };
}