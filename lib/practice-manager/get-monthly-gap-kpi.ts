 import { createClient } from "@supabase/supabase-js";

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

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function getMonthRangeFromMonthKey(monthKey: string): { start: string; end: string } {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid month key: "${monthKey}". Expected YYYY-MM`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  const pad2 = (value: number) => String(value).padStart(2, "0");

  return {
    start: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
    end: `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`,
  };
}

export async function getMonthlyGapKpi(monthKey: string): Promise<{
  hoursScheduled: number;
  hoursBilled: number;
  gapPct: number;
}> {
  const supabase = getServiceRoleSupabaseClient();
  const monthRange = getMonthRangeFromMonthKey(monthKey);

  const { data, error } = await supabase
    .from("provider_performance_raw")
    .select("hours_scheduled, hours_billed")
    .eq("period_start", monthRange.start)
    .eq("period_end", monthRange.end);

  if (error) {
    throw new Error(`Failed to load monthly gap KPI: ${error.message}`);
  }

  const rows = data ?? [];

  const hoursScheduled = rows.reduce(
    (sum, row) => sum + Number(row.hours_scheduled || 0),
    0
  );

  const hoursBilled = rows.reduce(
    (sum, row) => sum + Number(row.hours_billed || 0),
    0
  );

  const gapPct = round4(
    safeDivide(hoursScheduled - hoursBilled, hoursScheduled)
  );

  return {
    hoursScheduled,
    hoursBilled,
    gapPct,
  };
}