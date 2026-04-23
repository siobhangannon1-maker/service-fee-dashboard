import { isConsultationTreatmentType } from "./consultation-treatment-types";
import { normalizeProviderName } from "./normalize-provider-name";

export type AppointmentsCsvRow = Record<string, string | undefined>;

export type ParsedAppointmentRow = {
  providerNameRaw: string;
  providerNameNormalized: string;

  appointmentDate: string;
  appointmentStart: string;
  appointmentEnd: string;
  durationMinutes: number;

  patientNameRaw: string | null;
  treatmentType: string | null;
  appointmentValue: number;

  arrivalStatus: string | null;
  responseStatus: string | null;
  followingAppointmentRaw: string | null;

  isCancelled: boolean;
  isFta: boolean;
  hasFollowingAppointment: boolean;
  isConsultation: boolean;
};

function getString(row: AppointmentsCsvRow, key: string): string {
  return (row[key] ?? "").trim();
}

function parseDdMmYyyyToIsoDate(input: string): string {
  const value = input.trim();
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) {
    throw new Error(`Invalid appointment date: "${input}"`);
  }

  const [, dd, mm, yyyy] = match;

  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseTimeToParts(input: string): { hours: number; minutes: number } {
  const value = input.trim();

  const twelveHourMatch = value.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2]);
    const meridiem = twelveHourMatch[3].toUpperCase();

    if (meridiem === "AM" && hours === 12) {
      hours = 0;
    } else if (meridiem === "PM" && hours !== 12) {
      hours += 12;
    }

    return { hours, minutes };
  }

  const twentyFourHourMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    return {
      hours: Number(twentyFourHourMatch[1]),
      minutes: Number(twentyFourHourMatch[2]),
    };
  }

  throw new Error(`Invalid appointment time: "${input}"`);
}

function addMinutesToIsoDateTime(isoDate: string, time: string, minutesToAdd: number): string {
  const { hours, minutes } = parseTimeToParts(time);

  const date = new Date(`${isoDate}T00:00:00`);
  date.setHours(hours, minutes, 0, 0);
  date.setMinutes(date.getMinutes() + minutesToAdd);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const outHours = String(date.getHours()).padStart(2, "0");
  const outMinutes = String(date.getMinutes()).padStart(2, "0");
  const outSeconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${outHours}:${outMinutes}:${outSeconds}`;
}

function buildAppointmentStart(isoDate: string, time: string): string {
  const { hours, minutes } = parseTimeToParts(time);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");

  return `${isoDate} ${hh}:${mm}:00`;
}

function parseDurationMinutes(input: string): number {
  const value = input.trim();

  if (!value) return 0;

  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    return Math.max(0, Math.round(asNumber));
  }

  const hourMinuteMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (hourMinuteMatch) {
    return Number(hourMinuteMatch[1]) * 60 + Number(hourMinuteMatch[2]);
  }

  throw new Error(`Invalid duration: "${input}"`);
}

function parseCurrency(input: string): number {
  const value = input.trim();

  if (!value) return 0;

  const cleaned = value.replace(/[$,]/g, "");
  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid currency value: "${input}"`);
  }

  return parsed;
}

function toNullableString(value: string): string | null {
  return value ? value : null;
}

function isCancelledResponseStatus(responseStatus: string): boolean {
  const normalized = responseStatus.trim().toLowerCase();
  return normalized === "cancelled" || normalized === "x";
}

function isFtaArrivalStatus(arrivalStatus: string): boolean {
  const normalized = arrivalStatus.trim().toLowerCase();

  return (
    normalized === "f" ||
    normalized === "fta" ||
    normalized === "failed to attend" ||
    normalized === "did not attend" ||
    normalized === "no show" ||
    normalized === "no-show"
  );
}

function hasFollowingAppointment(value: string): boolean {
  return value.trim() !== "";
}

export function parseAppointmentsCsvRow(row: AppointmentsCsvRow): ParsedAppointmentRow {
  const providerNameRaw = getString(row, "Provider");
  const dateRaw = getString(row, "Date");
  const timeRaw = getString(row, "Time");
  const durationRaw = getString(row, "Duration");

  if (!providerNameRaw) {
    throw new Error('Missing required "Provider" value');
  }

  if (!dateRaw) {
    throw new Error('Missing required "Date" value');
  }

  if (!timeRaw) {
    throw new Error('Missing required "Time" value');
  }

  const appointmentDate = parseDdMmYyyyToIsoDate(dateRaw);
  const durationMinutes = parseDurationMinutes(durationRaw);
  const appointmentStart = buildAppointmentStart(appointmentDate, timeRaw);
  const appointmentEnd = addMinutesToIsoDateTime(appointmentDate, timeRaw, durationMinutes);

  const patientNameRaw = getString(row, "Patient Name");
  const treatmentType = getString(row, "Treatment Type");
  const appointmentValue = parseCurrency(getString(row, "Value"));
  const arrivalStatus = getString(row, "Arrival Status");
  const responseStatus = getString(row, "Response Status");
  const followingAppointmentRaw = getString(row, "Following Appointment");

  return {
    providerNameRaw,
    providerNameNormalized: normalizeProviderName(providerNameRaw),

    appointmentDate,
    appointmentStart,
    appointmentEnd,
    durationMinutes,

    patientNameRaw: toNullableString(patientNameRaw),
    treatmentType: toNullableString(treatmentType),
    appointmentValue,

    arrivalStatus: toNullableString(arrivalStatus),
    responseStatus: toNullableString(responseStatus),
    followingAppointmentRaw: toNullableString(followingAppointmentRaw),

    isCancelled: isCancelledResponseStatus(responseStatus),
    isFta: isFtaArrivalStatus(arrivalStatus),
    hasFollowingAppointment: hasFollowingAppointment(followingAppointmentRaw),
    isConsultation: isConsultationTreatmentType(treatmentType),
  };
}