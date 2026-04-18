import { createClient } from "@supabase/supabase-js";

type ReportItemStatus = "green" | "orange" | "red";

export type SaveXeroBenchmarkReportInput = {
  reportMonth: number;
  reportYear: number;
  grossProduction: number;
  totalExpenses: number;
  totalExpensePercent: number;
  items: {
    categoryName: string;
    expenseAmount: number;
    percent: number;
    status: ReportItemStatus;
  }[];
};

function getMonthLabel(month: number, year: number): string {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleString("en-AU", {
    month: "long",
    year: "numeric",
  });
}

function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateInput(input: SaveXeroBenchmarkReportInput) {
  if (input.reportMonth < 1 || input.reportMonth > 12) {
    throw new Error("Invalid reportMonth. Must be between 1 and 12.");
  }

  if (input.reportYear < 2000) {
    throw new Error("Invalid reportYear.");
  }

  if (input.grossProduction < 0) {
    throw new Error("Gross production cannot be negative.");
  }

  if (input.totalExpenses < 0) {
    throw new Error("Total expenses cannot be negative.");
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Report items are required.");
  }

  for (const item of input.items) {
    if (!item.categoryName || !item.categoryName.trim()) {
      throw new Error("Each report item must have a categoryName.");
    }

    if (item.expenseAmount < 0) {
      throw new Error(`Expense amount cannot be negative for ${item.categoryName}.`);
    }

    if (item.percent < 0) {
      throw new Error(`Percent cannot be negative for ${item.categoryName}.`);
    }

    if (!["green", "orange", "red"].includes(item.status)) {
      throw new Error(`Invalid status for ${item.categoryName}.`);
    }
  }
}

export async function saveXeroBenchmarkReport(
  input: SaveXeroBenchmarkReportInput
): Promise<{ reportId: string }> {
  validateInput(input);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const monthLabel = getMonthLabel(input.reportMonth, input.reportYear);

  const cleanedItems = input.items.map((item) => ({
    category_name: item.categoryName.trim(),
    expense_amount: roundTo2(item.expenseAmount),
    percent: roundTo2(item.percent),
    status: item.status,
  }));

  const totalFromItems = roundTo2(
    cleanedItems.reduce((sum, item) => sum + item.expense_amount, 0)
  );

  const cleanedTotalExpenses = roundTo2(input.totalExpenses);

  if (Math.abs(totalFromItems - cleanedTotalExpenses) > 0.05) {
    throw new Error(
      `Total expenses mismatch. Items total = ${totalFromItems}, report total = ${cleanedTotalExpenses}.`
    );
  }

  const { data: reportRow, error: reportError } = await supabase
    .from("xero_benchmark_reports")
    .upsert(
      {
        report_month: input.reportMonth,
        report_year: input.reportYear,
        month_label: monthLabel,
        gross_production: roundTo2(input.grossProduction),
        total_expenses: cleanedTotalExpenses,
        total_expense_percent: roundTo2(input.totalExpensePercent),
      },
      {
        onConflict: "report_month,report_year",
      }
    )
    .select("id")
    .single();

  if (reportError || !reportRow) {
    throw new Error(reportError?.message || "Failed to save benchmark report.");
  }

  const reportId = reportRow.id;

  const { error: deleteError } = await supabase
    .from("xero_benchmark_report_items")
    .delete()
    .eq("report_id", reportId);

  if (deleteError) {
    throw new Error(deleteError.message || "Failed to clear old report items.");
  }

  const rowsToInsert = cleanedItems.map((item) => ({
    report_id: reportId,
    category_name: item.category_name,
    expense_amount: item.expense_amount,
    percent: item.percent,
    status: item.status,
  }));

  const { error: itemsError } = await supabase
    .from("xero_benchmark_report_items")
    .insert(rowsToInsert);

  if (itemsError) {
    throw new Error(itemsError.message || "Failed to save report items.");
  }

  return { reportId };
}