import { createClient } from "@supabase/supabase-js";

export type FortnightlyStaffingKpi = {
  payPeriodId: string;
  periodStart: string;
  periodEnd: string;
  overtimeHours: number | null;
  billingStaffingPct: number | null;
};

type PayPeriod = {
  id: string;
  period_start: string;
  period_end: string;
};

type WageLine = {
  pay_period_id: string;
  line_type: string;
  hours: number;
  amount: number;
};

function getSupabase() {
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

function safeDivide(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  return numerator / denominator;
}

export async function getFortnightlyStaffingKpis(
  overallStart: string,
  overallEnd: string
): Promise<FortnightlyStaffingKpi[]> {
  const supabase = getSupabase();

  const { data: payPeriodsData, error: payPeriodsError } = await supabase
    .from("staff_pay_periods")
    .select("id, period_start, period_end")
    .lte("period_start", overallEnd)
    .gte("period_end", overallStart)
    .order("period_start", { ascending: true });

  if (payPeriodsError) {
    throw new Error(`Failed to load staff pay periods: ${payPeriodsError.message}`);
  }

  const payPeriods = (payPeriodsData ?? []) as PayPeriod[];

  if (payPeriods.length === 0) {
    return [];
  }

  const payPeriodIds = payPeriods.map((period) => period.id);

  const { data: wageLinesData, error: wageLinesError } = await supabase
    .from("staff_wage_lines")
    .select("pay_period_id, line_type, hours, amount")
    .in("pay_period_id", payPeriodIds);

  if (wageLinesError) {
    throw new Error(`Failed to load staff wage lines: ${wageLinesError.message}`);
  }

  const wageLines = (wageLinesData ?? []) as WageLine[];
  const results: FortnightlyStaffingKpi[] = [];

  for (const payPeriod of payPeriods) {
    const linesForPeriod = wageLines.filter(
      (line) => line.pay_period_id === payPeriod.id
    );

    const ordinaryWages = linesForPeriod
      .filter((line) => line.line_type === "ordinary")
      .reduce((total, line) => total + Number(line.amount ?? 0), 0);

    const overtimeLines = linesForPeriod.filter(
      (line) => line.line_type === "overtime"
    );

    const overtimeAmount = overtimeLines.reduce(
      (total, line) => total + Number(line.amount ?? 0),
      0
    );

    const overtimeHours = overtimeLines.reduce(
      (total, line) => total + Number(line.hours ?? 0),
      0
    );

    const superAmount = linesForPeriod
      .filter((line) => line.line_type === "superannuation")
      .reduce((total, line) => total + Number(line.amount ?? 0), 0);

    const { data: productionRows, error: productionError } = await supabase
      .from("import_rows_normalized")
      .select("gross_production")
      .gte("service_date", payPeriod.period_start)
      .lte("service_date", payPeriod.period_end)
      .eq("is_excluded", false);

    if (productionError) {
      throw new Error(`Failed to load production rows: ${productionError.message}`);
    }

    const { data: labourHireRows, error: labourHireError } = await supabase
      .from("xero_labour_hire")
      .select("amount")
      .gte("transaction_date", payPeriod.period_start)
      .lte("transaction_date", payPeriod.period_end);

    if (labourHireError) {
      throw new Error(`Failed to load labour hire rows: ${labourHireError.message}`);
    }

    const grossProduction = (productionRows ?? []).reduce(
      (total, row: any) => total + Number(row.gross_production ?? 0),
      0
    );

    const labourHireAmount = (labourHireRows ?? []).reduce(
      (total, row: any) => total + Number(row.amount ?? 0),
      0
    );

    const totalLabourCost =
      ordinaryWages + overtimeAmount + superAmount + labourHireAmount;

    results.push({
      payPeriodId: payPeriod.id,
      periodStart: payPeriod.period_start,
      periodEnd: payPeriod.period_end,
      overtimeHours,
      billingStaffingPct: safeDivide(totalLabourCost, grossProduction),
    });
  }

  return results;
}
