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
  provider_name_raw: string | null;
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

function hasFirstProvider(row: NewPatientRow): boolean {
  return String(row.provider_name_raw ?? "").trim().length > 0;
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
      .select("joined_date, provider_name_raw")
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

  const allRows = await fetchAllNewPatientRows(overallStart, overallEnd);

  return weeks.map((week) => {
    const rowsForWeek = allRows.filter(
      (row) => row.joined_date >= week.weekStart && row.joined_date <= week.weekEnd
    );

    const totalReferrals = rowsForWeek.length;
    const bookedCount = rowsForWeek.filter(hasFirstProvider).length;

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      totalReferrals,
      bookedCount,
      referralBookingRate: round4(safeDivide(bookedCount, totalReferrals)),
    };
  });
}