import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchXeroProfitAndLossReport,
  getMonthDateRange,
  getXeroAccessToken,
} from "@/lib/xero";

function parseYear(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseMonth(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function countRowsInReport(reportJson: any): number {
  const reports = Array.isArray(reportJson?.Reports) ? reportJson.Reports : [];
  const firstReport = reports[0];

  if (!firstReport || !Array.isArray(firstReport.Rows)) {
    return 0;
  }

  let count = 0;

  function walkRows(rows: any[]) {
    for (const row of rows) {
      count += 1;

      if (Array.isArray(row?.Rows)) {
        walkRows(row.Rows);
      }
    }
  }

  walkRows(firstReport.Rows);
  return count;
}

function getCellValues(row: any): string[] {
  if (!Array.isArray(row?.Cells)) return [];
  return row.Cells.map((cell: any) => String(cell?.Value ?? "").trim());
}

function isMeaningfulDataRow(row: any): boolean {
  const rowType = String(row?.RowType ?? "");
  const values = getCellValues(row).filter(Boolean);

  if (rowType === "Header") return false;
  if (values.length === 0) return false;

  return true;
}

function collectInterestingRows(reportJson: any) {
  const reports = Array.isArray(reportJson?.Reports) ? reportJson.Reports : [];
  const firstReport = reports[0];

  if (!firstReport || !Array.isArray(firstReport.Rows)) {
    return {
      firstTopLevelRows: [],
      firstMeaningfulRows: [],
      firstSectionWithChildren: null,
      firstPotentialDetailRows: [],
    };
  }

  const firstTopLevelRows = firstReport.Rows.slice(0, 5);

  const allRows: any[] = [];

  function walkRows(rows: any[]) {
    for (const row of rows) {
      allRows.push(row);

      if (Array.isArray(row?.Rows)) {
        walkRows(row.Rows);
      }
    }
  }

  walkRows(firstReport.Rows);

  const firstMeaningfulRows = allRows.filter(isMeaningfulDataRow).slice(0, 10);

  const firstSectionWithChildren =
    allRows.find(
      (row) =>
        row?.RowType === "Section" &&
        Array.isArray(row?.Rows) &&
        row.Rows.length > 0
    ) || null;

  const firstPotentialDetailRows = Array.isArray(firstSectionWithChildren?.Rows)
    ? firstSectionWithChildren.Rows.filter(isMeaningfulDataRow).slice(0, 10)
    : [];

  return {
    firstTopLevelRows,
    firstMeaningfulRows,
    firstSectionWithChildren,
    firstPotentialDetailRows,
  };
}

async function runProfitAndLossSync(year: number, month: number) {
  let syncRunId: string | null = null;

  try {
    const { fromDate, toDate, reportDate } = getMonthDateRange(year, month);

    const { data: syncRun, error: syncRunError } = await supabaseAdmin
      .from("xero_sync_runs")
      .insert({
        sync_type: "profit_and_loss_raw_sync",
        status: "started",
        metadata: {
          report_year: year,
          report_month: month,
          from_date: fromDate,
          to_date: toDate,
        },
      })
      .select("id")
      .single();

    if (syncRunError) {
      throw new Error(`Failed to create sync run: ${syncRunError.message}`);
    }

    syncRunId = syncRun.id;

    const accessToken = await getXeroAccessToken();
    const reportJson = await fetchXeroProfitAndLossReport(accessToken, year, month);

    const report = Array.isArray(reportJson?.Reports) ? reportJson.Reports[0] : null;

    if (!report) {
      throw new Error("No Profit and Loss report returned from Xero");
    }

    const { error: insertError } = await supabaseAdmin
      .from("xero_raw_profit_and_loss_reports")
      .insert({
        report_year: year,
        report_month: month,
        report_date: reportDate,
        from_date: fromDate,
        to_date: toDate,
        report_title: report?.ReportTitles?.join(" | ") ?? null,
        report_type: report?.ReportType ?? null,
        report_name: report?.ReportName ?? null,
        raw_json: reportJson,
      });

    if (insertError) {
      throw new Error(`Failed to save raw Profit and Loss report: ${insertError.message}`);
    }

    const rowCount = countRowsInReport(reportJson);
    const samples = collectInterestingRows(reportJson);

    const { error: finishError } = await supabaseAdmin
      .from("xero_sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        records_inserted: 1,
        metadata: {
          report_year: year,
          report_month: month,
          from_date: fromDate,
          to_date: toDate,
          report_name: report?.ReportName ?? null,
          report_type: report?.ReportType ?? null,
          top_level_row_count: Array.isArray(report?.Rows) ? report.Rows.length : 0,
          total_row_count: rowCount,
        },
      })
      .eq("id", syncRunId);

    if (finishError) {
      throw new Error(`Failed to update sync run: ${finishError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: "Profit and Loss raw sync successful",
      summary: {
        reportYear: year,
        reportMonth: month,
        fromDate,
        toDate,
        reportName: report?.ReportName ?? null,
        reportType: report?.ReportType ?? null,
        topLevelRowCount: Array.isArray(report?.Rows) ? report.Rows.length : 0,
        totalRowCount: rowCount,
        reportTitles: Array.isArray(report?.ReportTitles) ? report.ReportTitles : [],
      },
      samples: {
        firstTopLevelRows: samples.firstTopLevelRows,
        firstMeaningfulRows: samples.firstMeaningfulRows,
        firstSectionWithChildren: samples.firstSectionWithChildren,
        firstPotentialDetailRows: samples.firstPotentialDetailRows,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Unknown error while syncing Profit and Loss";

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
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  const year = parseYear(searchParams.get("year"), defaultYear);
  const month = parseMonth(searchParams.get("month"), defaultMonth);

  return runProfitAndLossSync(year, month);
}

export async function POST(request: NextRequest) {
  let body: { year?: number; month?: number } = {};

  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  const year =
    typeof body.year === "number" && Number.isInteger(body.year)
      ? body.year
      : defaultYear;

  const month =
    typeof body.month === "number" && Number.isInteger(body.month)
      ? body.month
      : defaultMonth;

  return runProfitAndLossSync(year, month);
}