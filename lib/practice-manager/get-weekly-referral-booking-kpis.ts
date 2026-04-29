import { createClient } from "@supabase/supabase-js";

export type WeeklyReferralBookingKpiRow = {
  weekStart: string;
  weekEnd: string;
  totalReferrals: number;
  bookedCount: number;
  referralBookingRate: number;
};

type NewPatientRow = {
  joined_date: string;
  patient_name_raw: string | null;
  provider_name_raw: string | null;
  first_appointment_raw: string | null;
  has_first_appointment: boolean | null;
};

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function hasFirstAppointmentValue(row: NewPatientRow): boolean {
  if (row.has_first_appointment === true) return true;

  const value = normalizeText(row.first_appointment_raw);

  if (!value) return false;

  return !["no", "n", "false", "0", "none", "null", "-", "nil"].includes(value);
}

function getRowKey(row: NewPatientRow): string {
  return [
    row.joined_date,
    normalizeText(row.patient_name_raw),
    normalizeText(row.provider_name_raw),
    normalizeText(row.first_appointment_raw),
  ].join("|");
}

function dedupeRows(rows: NewPatientRow[]): NewPatientRow[] {
  const map = new Map<string, NewPatientRow>();

  for (const row of rows) {
    const key = getRowKey(row);

    if (!map.has(key)) {
      map.set(key, row);
    }
  }

  return Array.from(map.values());
}

async function fetchAllNewPatientRows(
  overallStart: string,
  overallEnd: string
): Promise<NewPatientRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const allRows: NewPatientRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_new_patients_raw")
      .select(
        `
        joined_date,
        patient_name_raw,
        provider_name_raw,
        first_appointment_raw,
        has_first_appointment
        `
      )
      .gte("joined_date", overallStart)
      .lte("joined_date", overallEnd)
      .order("joined_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load referral booking KPIs: ${error.message}`);
    }

    const rows = (data ?? []) as NewPatientRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

export async function getWeeklyReferralBookingKpis(
  weeks: Array<{ weekStart: string; weekEnd: string }>
): Promise<WeeklyReferralBookingKpiRow[]> {
  if (weeks.length === 0) return [];

  const overallStart = weeks[0].weekStart;
  const overallEnd = weeks[weeks.length - 1].weekEnd;

  const allRowsRaw = await fetchAllNewPatientRows(overallStart, overallEnd);
  const allRows = dedupeRows(allRowsRaw);

  return weeks.map((week) => {
    const rowsForWeek = allRows.filter(
      (row) => row.joined_date >= week.weekStart && row.joined_date <= week.weekEnd
    );

    const totalReferrals = rowsForWeek.length;
    const bookedCount = rowsForWeek.filter(hasFirstAppointmentValue).length;

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      totalReferrals,
      bookedCount,
      referralBookingRate: round4(safeDivide(bookedCount, totalReferrals)),
    };
  });
}
