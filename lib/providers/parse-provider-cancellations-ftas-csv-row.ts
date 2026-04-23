import { normalizeProviderName } from "./normalize-provider-name";

export type ProviderCancellationsFtasCsvRow = Record<string, string | undefined>;

export type ParsedProviderCancellationsFtasRow = {
  providerNameRaw: string;
  providerNameNormalized: string;

  eventDate: string;
  eventTime: string | null;

  patientNameRaw: string | null;
  treatmentType: string | null;

  statusRaw: string | null;
  nextAppointmentRaw: string | null;

  hasNextAppointment: boolean;
  isFta: boolean;
  isCancellation: boolean;

  rawJson: Record<string, string | undefined>;
};

function getString(row: ProviderCancellationsFtasCsvRow, key: string): string {
  return (row[key] ?? "").trim();
}

function toNullableString(value: string): string | null {
  const trimmed = value.trim();
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

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isBlank(value: string | null | undefined): boolean {
  return normalizeText(value) === "";
}

export function parseProviderCancellationsFtasCsvRow(
  row: ProviderCancellationsFtasCsvRow
): ParsedProviderCancellationsFtasRow {
  const providerNameRaw = getString(row, "Provider");
  if (!providerNameRaw) {
    throw new Error('Missing required "Provider" value');
  }

  const appointmentDateRaw = getString(row, "Appointment Date");
  if (!appointmentDateRaw) {
    throw new Error('Missing required "Appointment Date" value');
  }

  const statusRaw = toNullableString(getString(row, "Status"));
  const nextAppointmentRaw = toNullableString(getString(row, "Next Appointment"));

  return {
    providerNameRaw,
    providerNameNormalized: normalizeProviderName(providerNameRaw),

    eventDate: parseDdMmYyyyToIsoDate(appointmentDateRaw),
    eventTime: toNullableString(getString(row, "Appointment Time")),

    patientNameRaw: toNullableString(getString(row, "Patient Name")),
    treatmentType: toNullableString(getString(row, "Tx Type")),

    statusRaw,
    nextAppointmentRaw,

    hasNextAppointment: !isBlank(nextAppointmentRaw),
    isFta: normalizeText(statusRaw) === "fta",
    isCancellation: normalizeText(statusRaw) === "cancelled",

    rawJson: row,
  };
}