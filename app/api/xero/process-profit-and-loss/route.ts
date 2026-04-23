import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBenchmarkStatus } from "@/lib/benchmark-status";
import { mapXeroExpensesToBenchmarkCategories } from "@/lib/map-xero-expenses-to-benchmarks";

type ExpenseBenchmarkRow = {
  category_name: string;
  target_percent: number;
  green_min: number;
  green_max: number;
  orange_min: number;
  orange_max: number;
  red_min: number;
};

type ParsedExpenseRow = {
  account_name: string;
  amount: number;
};

function getMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function parseYear(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseMonth(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeAccountName(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Add any accounts here that should NOT count toward benchmark expenses.
 * These rows will be excluded from:
 * 1) total_expenses
 * 2) mapped benchmark category totals
 */
const EXCLUDED_BENCHMARK_ACCOUNTS = new Set<string>([
  "dividend paid",
  // Add more exact account names here as needed, for example:
  // "depreciation",
  // "amortisation",
  // "interest expense",
]);

function isExcludedBenchmarkAccount(accountName: string) {
  return EXCLUDED_BENCHMARK_ACCOUNTS.has(normalizeAccountName(accountName));
}

function getOperatingExpensesSection(report: any) {
  const rows = Array.isArray(report?.Rows) ? report.Rows : [];

  return rows.find(
    (row: any) =>
      row?.RowType === "Section" &&
      String(row?.Title ?? "").trim() === "Less Operating Expenses"
  );
}

function extractExpenseRowsFromSection(section: any): ParsedExpenseRow[] {
  const rows = Array.isArray(section?.Rows) ? section.Rows : [];

  return rows
    .filter((row: any) => row?.RowType === "Row")
    .map((row: any) => {
      const accountName = String(row?.Cells?.[0]?.Value ?? "").trim();
      const amount = toNumber(row?.Cells?.[1]?.Value ?? 0);

      return {
        account_name: accountName,
        amount,
      };
    })
    .filter((row) => row.account_name.length > 0);
}

function normalizeCategoryName(value: string) {
  return value.trim().toLowerCase();
}

async function getGrossProductionFromBillingPeriod(year: number, month: number) {
  const { data: billingPeriod, error: billingPeriodError } = await supabaseAdmin
    .from("billing_periods")
    .select("id, year, month")
    .eq("year", year)
    .eq("month", month)
    .single();

  if (billingPeriodError || !billingPeriod) {
    throw new Error(
      `No billing_periods row found for ${year}-${String(month).padStart(2, "0")}`
    );
  }

  const { data: providerRecords, error: providerRecordsError } = await supabaseAdmin
    .from("provider_monthly_records")
    .select("gross_production")
    .eq("billing_period_id", billingPeriod.id);

  if (providerRecordsError) {
    throw new Error(
      `Failed to load provider_monthly_records: ${providerRecordsError.message}`
    );
  }

  const grossProduction = (providerRecords || []).reduce(
    (sum, row) => sum + toNumber(row.gross_production),
    0
  );

  if (grossProduction <= 0) {
    throw new Error(
      `Gross production for billing period ${year}-${String(month).padStart(2, "0")} is zero or missing`
    );
  }

  return grossProduction;
}

async function runProcessProfitAndLoss(year: number, month: number) {
  let syncRunId: string | null = null;

  try {
    const { data: syncRun, error: syncRunError } = await supabaseAdmin
      .from("xero_sync_runs")
      .insert({
        sync_type: "profit_and_loss_process",
        status: "started",
        metadata: {
          report_year: year,
          report_month: month,
        },
      })
      .select("id")
      .single();

    if (syncRunError) {
      throw new Error(`Failed to create sync run: ${syncRunError.message}`);
    }

    syncRunId = syncRun.id;

    const { data: rawReportRow, error: rawReportError } = await supabaseAdmin
      .from("xero_raw_profit_and_loss_reports")
      .select("*")
      .eq("report_year", year)
      .eq("report_month", month)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .single();

    if (rawReportError || !rawReportRow) {
      throw new Error(
        `No raw Profit and Loss report found for ${year}-${String(month).padStart(2, "0")}`
      );
    }

    const report = rawReportRow?.raw_json?.Reports?.[0];

    if (!report) {
      throw new Error("Raw report JSON does not include Reports[0]");
    }

    const operatingExpensesSection = getOperatingExpensesSection(report);

    if (!operatingExpensesSection) {
      throw new Error(
        'Could not find the "Less Operating Expenses" section in the raw Xero report'
      );
    }

    const allExpenseRows = extractExpenseRowsFromSection(operatingExpensesSection);

    if (allExpenseRows.length === 0) {
      throw new Error("No expense rows found in Less Operating Expenses");
    }

    // Exclude accounts that should not count toward benchmark expenses
    const includedExpenseRows = allExpenseRows.filter(
      (row) => !isExcludedBenchmarkAccount(row.account_name)
    );

    const excludedRows = allExpenseRows.filter((row) =>
      isExcludedBenchmarkAccount(row.account_name)
    );

    if (includedExpenseRows.length === 0) {
      throw new Error("All operating expense rows were excluded from benchmark processing");
    }

    // IMPORTANT:
    // Recalculate total expenses from included rows only.
    // Do NOT trust the Xero section summary if it includes non-benchmark accounts.
    const totalExpenses = includedExpenseRows.reduce((sum, row) => sum + row.amount, 0);

    const grossProduction = await getGrossProductionFromBillingPeriod(year, month);

    // Use your original mapping helper
    const groupedRows = await mapXeroExpensesToBenchmarkCategories(includedExpenseRows);

    if (!groupedRows.length) {
      throw new Error("No grouped benchmark rows were produced");
    }

    const { data: benchmarks, error: benchmarksError } = await supabaseAdmin
      .from("expense_benchmarks")
      .select("*");

    if (benchmarksError) {
      throw new Error(`Failed to load expense_benchmarks: ${benchmarksError.message}`);
    }

    const benchmarkMap = new Map<string, ExpenseBenchmarkRow>();

    for (const benchmark of benchmarks || []) {
      const categoryName = String(benchmark?.category_name ?? "").trim();

      if (categoryName) {
        benchmarkMap.set(normalizeCategoryName(categoryName), {
          category_name: categoryName,
          target_percent: toNumber(benchmark.target_percent),
          green_min: toNumber(benchmark.green_min),
          green_max: toNumber(benchmark.green_max),
          orange_min: toNumber(benchmark.orange_min),
          orange_max: toNumber(benchmark.orange_max),
          red_min: toNumber(benchmark.red_min),
        });
      }
    }

    const { data: existingReports, error: existingReportsError } = await supabaseAdmin
      .from("xero_benchmark_reports")
      .select("id")
      .eq("report_year", year)
      .eq("report_month", month);

    if (existingReportsError) {
      throw new Error(
        `Failed to check existing benchmark reports: ${existingReportsError.message}`
      );
    }

    const existingReportIds = (existingReports || []).map((row) => row.id);

    if (existingReportIds.length > 0) {
      const deleteItemsResult = await supabaseAdmin
        .from("xero_benchmark_report_items")
        .delete()
        .in("report_id", existingReportIds);

      if (deleteItemsResult.error) {
        throw new Error(
          `Failed to delete existing benchmark report items: ${deleteItemsResult.error.message}`
        );
      }

      const deleteReportsResult = await supabaseAdmin
        .from("xero_benchmark_reports")
        .delete()
        .in("id", existingReportIds);

      if (deleteReportsResult.error) {
        throw new Error(
          `Failed to delete existing benchmark reports: ${deleteReportsResult.error.message}`
        );
      }
    }

    const totalExpensePercent = (totalExpenses / grossProduction) * 100;

    const insertReportResult = await supabaseAdmin
      .from("xero_benchmark_reports")
      .insert({
        report_year: year,
        report_month: month,
        month_label: getMonthLabel(year, month),
        gross_production: grossProduction,
        total_expenses: Number(totalExpenses.toFixed(2)),
        total_expense_percent: Number(totalExpensePercent.toFixed(2)),
      })
      .select("id")
      .single();

    if (insertReportResult.error || !insertReportResult.data) {
      throw new Error(
        `Failed to insert xero_benchmark_reports row: ${insertReportResult.error?.message}`
      );
    }

    const reportId = insertReportResult.data.id;

    const itemsToInsert = groupedRows
      .map((row) => {
        const benchmark = benchmarkMap.get(normalizeCategoryName(row.category_name)) ?? null;
        const actualPercent = (row.expense_amount / grossProduction) * 100;
        const benchmarkPercent = benchmark ? Number(benchmark.target_percent) : 0;
        const variancePercent = actualPercent - benchmarkPercent;
        const status = benchmark ? getBenchmarkStatus(actualPercent, benchmark) : "red";

        return {
          report_id: reportId,
          category_name: row.category_name,
          expense_amount: Number(row.expense_amount.toFixed(2)),
          percent: Number(actualPercent.toFixed(2)),
          benchmark_percent: Number(benchmarkPercent.toFixed(2)),
          variance_percent: Number(variancePercent.toFixed(2)),
          status,
        };
      })
      .sort((a, b) => b.expense_amount - a.expense_amount);

    const insertItemsResult = await supabaseAdmin
      .from("xero_benchmark_report_items")
      .insert(itemsToInsert);

    if (insertItemsResult.error) {
      throw new Error(
        `Failed to insert xero_benchmark_report_items rows: ${insertItemsResult.error.message}`
      );
    }

    const excludedAccounts = excludedRows.map((row) => ({
      account_name: row.account_name,
      amount: Number(row.amount.toFixed(2)),
    }));

    const excludedTotal = excludedRows.reduce((sum, row) => sum + row.amount, 0);

    const otherExpensesRow = groupedRows.find(
      (row) => normalizeCategoryName(row.category_name) === "other expenses"
    );

    const metadata = {
      report_year: year,
      report_month: month,
      grouped_category_count: itemsToInsert.length,
      gross_production: Number(grossProduction.toFixed(2)),
      total_expenses: Number(totalExpenses.toFixed(2)),
      total_expense_percent: Number(totalExpensePercent.toFixed(2)),
      excluded_accounts_count: excludedAccounts.length,
      excluded_accounts_total: Number(excludedTotal.toFixed(2)),
      excluded_accounts: excludedAccounts,
      other_expenses_amount: otherExpensesRow
        ? Number(otherExpensesRow.expense_amount.toFixed(2))
        : 0,
    };

    const finishResult = await supabaseAdmin
      .from("xero_sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_inserted: 1 + itemsToInsert.length,
        metadata,
      })
      .eq("id", syncRunId);

    if (finishResult.error) {
      throw new Error(`Failed to update sync run: ${finishResult.error.message}`);
    }

    return NextResponse.json({
      success: true,
      message: "Profit and Loss processed into benchmark tables successfully",
      summary: metadata,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error while processing Profit and Loss";

    if (syncRunId) {
      await supabaseAdmin
        .from("xero_sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", syncRunId);
    }

    return NextResponse.json(
      {
        success: false,
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const now = new Date();

  const year = parseYear(searchParams.get("year"), now.getFullYear());
  const month = parseMonth(searchParams.get("month"), now.getMonth() + 1);

  return runProcessProfitAndLoss(year, month);
}

export async function POST(request: NextRequest) {
  let body: { year?: number; month?: number } = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const now = new Date();

  const year =
    typeof body.year === "number" && Number.isInteger(body.year)
      ? body.year
      : now.getFullYear();

  const month =
    typeof body.month === "number" && Number.isInteger(body.month)
      ? body.month
      : now.getMonth() + 1;

  return runProcessProfitAndLoss(year, month);
}