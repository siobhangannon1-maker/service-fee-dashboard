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

type ProductionRow = {
  service_date: string | null;
  gross_production: number | string | null;
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

function normalizePraktikaProductionAmount(value: number | string | null) {
  const raw = Number(value ?? 0);
  if (!Number.isFinite(raw)) return 0;

  // Praktika completed-procedure amounts are stored in cents in import_rows_normalized.
  return raw / 100;
}

async function getActiveProductionImportIds(params: {
  supabase: ReturnType<typeof getSupabase>;
}) {
  const { supabase } = params;

  const { data, error } = await supabase
    .from("billing_period_imports")
    .select("import_id");

  if (error) {
    throw new Error(`Failed to load active production imports: ${error.message}`);
  }

  return Array.from(
    new Set((data ?? []).map((row: any) => String(row.import_id)).filter(Boolean))
  );
}

async function fetchAllProductionRows(params: {
  supabase: ReturnType<typeof getSupabase>;
  start: string;
  end: string;
}): Promise<ProductionRow[]> {
  const { supabase, start, end } = params;
  const importIds = await getActiveProductionImportIds({ supabase });

  if (importIds.length === 0) {
    return [];
  }

  const pageSize = 1000;
  let from = 0;
  const allRows: ProductionRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("import_rows_normalized")
      .select("service_date, gross_production")
      .in("import_id", importIds)
      .gte("service_date", start)
      .lte("service_date", end)
      .eq("is_excluded", false)
      .order("service_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load production rows: ${error.message}`);
    }

    const rows = (data ?? []) as ProductionRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

function sumProductionForRange(rows: ProductionRow[], start: string, end: string) {
  return rows
    .filter((row) => {
      if (!row.service_date) return false;
      return row.service_date >= start && row.service_date <= end;
    })
    .reduce(
      (total, row) =>
        total + normalizePraktikaProductionAmount(row.gross_production),
      0
    );
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

  const productionRows = await fetchAllProductionRows({
    supabase,
    start: overallStart,
    end: overallEnd,
  });

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

    const { data: labourHireRows, error: labourHireError } = await supabase
      .from("xero_labour_hire")
      .select("amount")
      .gte("transaction_date", payPeriod.period_start)
      .lte("transaction_date", payPeriod.period_end);

    if (labourHireError) {
      throw new Error(`Failed to load labour hire rows: ${labourHireError.message}`);
    }

    const grossProduction = sumProductionForRange(
      productionRows,
      payPeriod.period_start,
      payPeriod.period_end
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
