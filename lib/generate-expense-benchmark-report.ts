import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBenchmarkStatus, BenchmarkStatus } from "@/lib/benchmark-status";

export type ExpenseBenchmarkInputItem = {
  category_name: string;
  expense_amount: number;
};

export type ExpenseBenchmarkResultItem = {
  category_name: string;
  expense_amount: number;
  actual_percent: number;
  target_percent: number;
  variance_from_target: number;
  status: BenchmarkStatus;
};

export type ExpenseBenchmarkReport = {
  month_key: string;
  year: number;
  month: number;
  gross_production: number;
  total_expenses: number;
  total_expense_percent: number;
  results: ExpenseBenchmarkResultItem[];
};

type BillingPeriodRow = {
  id: string;
  month: number;
  year: number;
  label?: string | null;
};

type ProviderMonthlyRecordRow = {
  gross_production: number | null;
};

type ExpenseBenchmarkRow = {
  category_name: string;
  target_percent: number;
  green_min: number | null;
  green_max: number | null;
  orange_min: number | null;
  orange_max: number | null;
  red_min: number | null;
};

type XeroAccountMappingRow = {
  xero_account_name: string;
  benchmark_category_name: string;
};

type RawExpenseItem = {
  category_name?: unknown;
  benchmark_category_name?: unknown;
  name?: unknown;
  account_name?: unknown;
  expense_amount?: unknown;
  amount?: unknown;
  value?: unknown;
};

type NormalizedExpenseItem = {
  source_account_name: string;
  expense_amount: number;
};

type AllowedStatus = "green" | "orange" | "red";

function buildMonthKey(year: number, month: number) {
  const paddedMonth = String(month).padStart(2, "0");
  return `${year}-${paddedMonth}`;
}

function roundTo2(value: number) {
  return Number(value.toFixed(2));
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function ensureAllowedStatus(
  status: unknown,
  categoryName: string
): AllowedStatus {
  if (status === "green" || status === "orange" || status === "red") {
    return status;
  }

  throw new Error(
    `Invalid benchmark status "${String(
      status
    )}" for category "${categoryName}". Status must be green, orange, or red.`
  );
}

function normalizeExpenseItems(rawItems: unknown[]): NormalizedExpenseItem[] {
  const normalized: NormalizedExpenseItem[] = [];

  for (const rawItem of rawItems) {
    const item = rawItem as RawExpenseItem;

    const sourceAccountName = String(
      item.account_name ??
        item.category_name ??
        item.benchmark_category_name ??
        item.name ??
        ""
    ).trim();

    const expenseAmount = Number(
      item.expense_amount ?? item.amount ?? item.value ?? 0
    );

    if (!sourceAccountName) {
      continue;
    }

    if (Number.isNaN(expenseAmount) || expenseAmount < 0) {
      throw new Error(
        `Expense amount must be a valid non-negative number for ${sourceAccountName}`
      );
    }

    normalized.push({
      source_account_name: sourceAccountName,
      expense_amount: expenseAmount,
    });
  }

  if (normalized.length === 0) {
    throw new Error(
      "No valid expense rows were found. Check that the Xero parser is returning account names and amounts."
    );
  }

  return normalized;
}

async function getBillingPeriod(
  year: number,
  month: number
): Promise<BillingPeriodRow> {
  const { data, error } = await supabaseAdmin
    .from("billing_periods")
    .select("id, month, year, label")
    .eq("year", year)
    .eq("month", month)
    .single();

  if (error || !data) {
    throw new Error(
      `No billing period found for ${year}-${String(month).padStart(2, "0")}.`
    );
  }

  return data as BillingPeriodRow;
}

async function getGrossProductionForBillingPeriod(
  billingPeriodId: string,
  monthKey: string
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("provider_monthly_records")
    .select("gross_production")
    .eq("billing_period_id", billingPeriodId);

  if (error) {
    throw new Error(
      `Failed to load gross production for ${monthKey}: ${error.message}`
    );
  }

  const rows = (data || []) as ProviderMonthlyRecordRow[];

  const grossProduction = rows.reduce((sum, row) => {
    return sum + Number(row.gross_production || 0);
  }, 0);

  console.log("Gross production lookup", {
    monthKey,
    billingPeriodId,
    rowCount: rows.length,
    grossProduction,
    rows,
  });

  if (rows.length === 0) {
    throw new Error(
      `No provider_monthly_records rows were found for ${monthKey} (billing_period_id ${billingPeriodId}). Gross production must be loaded and processed for that billing period before uploading the Xero CSV.`
    );
  }

  if (grossProduction <= 0) {
    throw new Error(
      `provider_monthly_records rows were found for ${monthKey} (billing_period_id ${billingPeriodId}), but the total gross_production is ${grossProduction}. It must be greater than 0 before uploading the Xero CSV.`
    );
  }

  return grossProduction;
}

async function getXeroAccountMappings(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("xero_account_mappings")
    .select("xero_account_name, benchmark_category_name");

  if (error) {
    throw new Error(`Failed to load Xero account mappings: ${error.message}`);
  }

  const mappingMap = new Map<string, string>();

  for (const row of (data || []) as XeroAccountMappingRow[]) {
    const sourceName = String(row.xero_account_name || "").trim();
    const targetName = String(row.benchmark_category_name || "").trim();

    if (!sourceName || !targetName) {
      continue;
    }

    mappingMap.set(normalizeText(sourceName), targetName);
  }

  return mappingMap;
}

async function getBenchmarksForCategories(
  categoryNames: string[]
): Promise<Map<string, ExpenseBenchmarkRow>> {
  const uniqueCategoryNames = [...new Set([...categoryNames, "Other Expenses"])];

  const { data, error } = await supabaseAdmin
    .from("expense_benchmarks")
    .select("*")
    .in("category_name", uniqueCategoryNames);

  if (error) {
    throw new Error(error.message);
  }

  const benchmarkMap = new Map<string, ExpenseBenchmarkRow>();

  for (const row of (data || []) as ExpenseBenchmarkRow[]) {
    benchmarkMap.set(row.category_name, row);
  }

  if (!benchmarkMap.has("Other Expenses")) {
    throw new Error(
      'Missing benchmark category: Other Expenses. Add it to expense_benchmarks first.'
    );
  }

  return benchmarkMap;
}

async function saveExpenseBenchmarkReport(
  report: ExpenseBenchmarkReport
): Promise<void> {
  const monthLabel = new Date(report.year, report.month - 1, 1).toLocaleString(
    "en-AU",
    {
      month: "long",
      year: "numeric",
    }
  );

  const { data: reportRow, error: reportError } = await supabaseAdmin
    .from("xero_benchmark_reports")
    .upsert(
      {
        report_month: report.month,
        report_year: report.year,
        month_label: monthLabel,
        gross_production: report.gross_production,
        total_expenses: report.total_expenses,
        total_expense_percent: report.total_expense_percent,
      },
      {
        onConflict: "report_month,report_year",
      }
    )
    .select("id")
    .single();

  if (reportError || !reportRow) {
    throw new Error(reportError?.message || "Failed to save benchmark report");
  }

  const reportId = reportRow.id as string;

  const { error: deleteError } = await supabaseAdmin
    .from("xero_benchmark_report_items")
    .delete()
    .eq("report_id", reportId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const itemRows = report.results.map((item) => ({
    report_id: reportId,
    category_name: item.category_name,
    expense_amount: item.expense_amount,
    percent: item.actual_percent,
    benchmark_percent: item.target_percent,
    variance_percent: item.variance_from_target,
    status: ensureAllowedStatus(item.status, item.category_name),
  }));

  const { error: insertError } = await supabaseAdmin
    .from("xero_benchmark_report_items")
    .insert(itemRows);

  if (insertError) {
    throw new Error(insertError.message);
  }
}

async function generateExpenseBenchmarkReport(
  year: number,
  month: number,
  rawItems: unknown[]
): Promise<ExpenseBenchmarkReport> {
  if (Number.isNaN(year) || year < 2000 || year > 2100) {
    throw new Error("Year must be a valid number between 2000 and 2100");
  }

  if (Number.isNaN(month) || month < 1 || month > 12) {
    throw new Error("Month must be a valid number between 1 and 12");
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("At least one expense item is required");
  }

  const items = normalizeExpenseItems(rawItems);
  const monthKey = buildMonthKey(year, month);
  const billingPeriod = await getBillingPeriod(year, month);

  console.log("Benchmark report billing period", {
    monthKey,
    billingPeriod,
  });

  const grossProduction = await getGrossProductionForBillingPeriod(
    billingPeriod.id,
    monthKey
  );

  const mappingMap = await getXeroAccountMappings();
  const groupedExpenseAmounts = new Map<string, number>();

  for (const item of items) {
    const mappedCategoryName =
      mappingMap.get(normalizeText(item.source_account_name)) ||
      "Other Expenses";

    const currentAmount = groupedExpenseAmounts.get(mappedCategoryName) || 0;

    groupedExpenseAmounts.set(
      mappedCategoryName,
      currentAmount + Number(item.expense_amount)
    );
  }

  const benchmarkMap = await getBenchmarksForCategories([
    ...groupedExpenseAmounts.keys(),
  ]);

  const results: ExpenseBenchmarkResultItem[] = [];

  for (const [categoryName, totalExpenseAmount] of groupedExpenseAmounts.entries()) {
    const benchmark = benchmarkMap.get(categoryName);

    if (!benchmark) {
      throw new Error(`No benchmark found for category: ${categoryName}`);
    }

    const actualPercent = (totalExpenseAmount / grossProduction) * 100;
    const varianceFromTarget = actualPercent - Number(benchmark.target_percent);
    const rawStatus = getBenchmarkStatus(actualPercent, benchmark);
    const status = ensureAllowedStatus(rawStatus, categoryName);

    results.push({
      category_name: categoryName,
      expense_amount: roundTo2(totalExpenseAmount),
      actual_percent: roundTo2(actualPercent),
      target_percent: roundTo2(Number(benchmark.target_percent)),
      variance_from_target: roundTo2(varianceFromTarget),
      status,
    });
  }

  results.sort((a, b) => a.category_name.localeCompare(b.category_name));

  const totalExpenses = results.reduce((sum, row) => {
    return sum + Number(row.expense_amount);
  }, 0);

  const totalExpensePercent = (totalExpenses / grossProduction) * 100;

  const report: ExpenseBenchmarkReport = {
    month_key: monthKey,
    year,
    month,
    gross_production: roundTo2(grossProduction),
    total_expenses: roundTo2(totalExpenses),
    total_expense_percent: roundTo2(totalExpensePercent),
    results,
  };

  await saveExpenseBenchmarkReport(report);

  return report;
}

export { generateExpenseBenchmarkReport };
export default generateExpenseBenchmarkReport;