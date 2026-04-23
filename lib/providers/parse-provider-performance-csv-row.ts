import { normalizeProviderName } from "./normalize-provider-name";

export type ProviderPerformanceCsvRow = Record<string, string | undefined>;

export type ParsedProviderPerformanceRow = {
  providerNameRaw: string;
  providerNameNormalized: string;

  periodStart: string;
  periodEnd: string;

  patientsTreated: number;
  appointmentsCompleted: number;
  hoursScheduled: number;
  hoursAppointed: number;
  hoursBilled: number;
  revenue: number;
  ftas: number;
  cancellations: number;

  productionPerHourAppointed: number;
  productionPerHourBilled: number;
};

function getString(row: ProviderPerformanceCsvRow, key: string): string {
  return (row[key] ?? "").trim();
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

function parseNumber(input: string): number {
  const value = input.trim();

  if (!value) return 0;

  const cleaned = value.replace(/[$,% ,]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: "${input}"`);
  }

  return parsed;
}

function parseInteger(input: string): number {
  return Math.round(parseNumber(input));
}

function parseCurrency(input: string): number {
  return parseNumber(input);
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

export function parseProviderPerformanceCsvRow(
  row: ProviderPerformanceCsvRow,
  params: {
    periodStart: string;
    periodEnd: string;
  }
): ParsedProviderPerformanceRow {
  const providerNameRaw = getString(row, "Provider Name");

  if (!providerNameRaw) {
    throw new Error('Missing required "Provider Name" value');
  }

  const patientsTreated = parseInteger(getString(row, "Patients Treated"));
  const appointmentsCompleted = parseInteger(getString(row, "Appointments Completed"));
  const hoursScheduled = parseNumber(getString(row, "Hours Scheduled"));
  const hoursAppointed = parseNumber(getString(row, "Hours Appointed"));
  const hoursBilled = parseNumber(getString(row, "Hours Billed"));
  const revenue = parseCurrency(getString(row, "Revenue"));
  const ftas = parseInteger(getString(row, "FTAs"));
  const cancellations = parseInteger(getString(row, "Cancellations"));

  return {
    providerNameRaw,
    providerNameNormalized: normalizeProviderName(providerNameRaw),

    periodStart: parseDdMmYyyyToIsoDate(params.periodStart),
    periodEnd: parseDdMmYyyyToIsoDate(params.periodEnd),

    patientsTreated,
    appointmentsCompleted,
    hoursScheduled,
    hoursAppointed,
    hoursBilled,
    revenue,
    ftas,
    cancellations,

    productionPerHourAppointed: safeDivide(revenue, hoursAppointed),
    productionPerHourBilled: safeDivide(revenue, hoursBilled),
  };
}