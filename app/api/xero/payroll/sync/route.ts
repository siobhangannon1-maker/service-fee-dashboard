import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";
import { getXeroAccessToken } from "@/lib/xero";

const CURRENT_STAFF_PAYROLL_CALENDAR_ID =
  "1b3d1126-57a2-4c24-9362-81c7d4fd6ecf";

const LEGACY_STAFF_PAYROLL_CALENDAR_ID =
  "9691a285-45ec-4039-86e8-f9bb1432cb4b";

const ALLOWED_STAFF_PAYROLL_CALENDAR_IDS = [
  CURRENT_STAFF_PAYROLL_CALENDAR_ID,
  LEGACY_STAFF_PAYROLL_CALENDAR_ID,
];

type XeroEarningsRate = {
  EarningsRateID: string;
  Name?: string;
  EarningsType?: string;
};

type XeroPayslipSummary = {
  EmployeeID: string;
  PayslipID: string;
  FirstName?: string;
  LastName?: string;
};

type XeroPayRun = {
  PayRunID: string;
  PayrollCalendarID?: string;
  PayRunPeriodStartDate: string;
  PayRunPeriodEndDate: string;
  PaymentDate?: string;
  PayRunStatus?: string;
  Wages?: number;
  Super?: number;
  Payslips?: XeroPayslipSummary[];
};

type XeroEarningsLine = {
  EarningsRateID?: string;
  RatePerUnit?: number;
  NumberOfUnits?: number;
  Amount?: number;
};

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseXeroDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = value.match(/\/Date\((\d+)/);
  if (!match) return null;

  return new Date(Number(match[1])).toISOString().slice(0, 10);
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function getLineAmount(line: XeroEarningsLine): number {
  if (typeof line.Amount === "number") return money(line.Amount);

  const rate = Number(line.RatePerUnit ?? 0);
  const units = Number(line.NumberOfUnits ?? 0);

  return money(rate * units);
}

function getEmployeeName(payslip: XeroPayslipSummary): string {
  return [payslip.FirstName, payslip.LastName].filter(Boolean).join(" ").trim();
}

function getOvertimeMultiplier(earningsName: string): number | null {
  const name = earningsName.toLowerCase();

  if (!name.includes("overtime")) return null;
  if (name.includes("2.0") || name.includes("x 2") || name.includes("x2")) {
    return 2.0;
  }
  if (
    name.includes("1.5") ||
    name.includes("x 1.5") ||
    name.includes("x1.5")
  ) {
    return 1.5;
  }

  return 1.0;
}

function getPositiveIntegerParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

async function fetchXero(accessToken: string, url: string, delayMs: number) {
  await sleep(delayMs);

  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const text = await response.text();

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (response.ok) {
      return json;
    }

    if (response.status === 429 && attempt < 5) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : 0;

      const backoffMs =
        retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : attempt * 10000;

      console.warn(
        `Xero rate limit hit. Attempt ${attempt}/5. Waiting ${backoffMs}ms before retry.`
      );

      await sleep(backoffMs);
      continue;
    }

    throw new Error(`Xero request failed: ${response.status} ${text}`);
  }

  throw new Error("Xero request failed after retries");
}

export async function POST(request: Request) {
  try {
    await requireRole(["admin", "practice_manager"]);

    const url = new URL(request.url);

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const force = url.searchParams.get("force") === "1";

    /*
      Backfill controls:

      limit=1 means sync one pay run only.
      offset=0 means the newest matching pay run.
      offset=1 means the next matching pay run.
      offset=2 means the next one after that.

      Example:
      /api/xero/payroll/sync?from=2025-07-01&to=2025-09-30&force=1&limit=1&offset=0
      /api/xero/payroll/sync?from=2025-07-01&to=2025-09-30&force=1&limit=1&offset=1
      /api/xero/payroll/sync?from=2025-07-01&to=2025-09-30&force=1&limit=1&offset=2
    */
    const isBulkSync = Boolean(from && to);
    const defaultLimit = isBulkSync ? 1 : 3;

    const limit = getPositiveIntegerParam(
      url.searchParams.get("limit"),
      defaultLimit
    );

    const offset = getPositiveIntegerParam(url.searchParams.get("offset"), 0);

    const delayMs = isBulkSync ? 2500 : 1200;

    const supabase = getServiceRoleSupabaseClient();
    const accessToken = await getXeroAccessToken();

    const payItemsJson = await fetchXero(
      accessToken,
      "https://api.xero.com/payroll.xro/1.0/PayItems",
      delayMs
    );

    const earningsRates: XeroEarningsRate[] =
      payItemsJson?.PayItems?.EarningsRates ?? [];

    const earningsRateById = new Map(
      earningsRates.map((rate) => [rate.EarningsRateID, rate])
    );

    const payRunsJson = await fetchXero(
      accessToken,
      "https://api.xero.com/payroll.xro/1.0/PayRuns",
      delayMs
    );

    const allMatchingPayRuns: XeroPayRun[] = (payRunsJson?.PayRuns ?? [])
      .filter((run: XeroPayRun) => {
        const periodStart = parseXeroDate(run.PayRunPeriodStartDate);

        const isStaffPayroll =
          run.PayRunStatus === "POSTED" &&
          Boolean(run.PayrollCalendarID) &&
          ALLOWED_STAFF_PAYROLL_CALENDAR_IDS.includes(run.PayrollCalendarID!) &&
          Number(run.Wages ?? 0) > 1000;

        const isInRequestedRange =
          !from ||
          !to ||
          (periodStart !== null && periodStart >= from && periodStart <= to);

        return isStaffPayroll && isInRequestedRange;
      })
      .sort((a: XeroPayRun, b: XeroPayRun) => {
        const aDate = parseXeroDate(a.PayRunPeriodStartDate) ?? "";
        const bDate = parseXeroDate(b.PayRunPeriodStartDate) ?? "";

        return bDate.localeCompare(aDate);
      });

    const payRunsToSync = allMatchingPayRuns.slice(offset, offset + limit);

    let syncedPayRuns = 0;
    let skippedPayRuns = 0;
    let insertedWageLines = 0;
    let totalOvertimeHours = 0;
    let totalOvertimeAmount = 0;

    for (const payRun of payRunsToSync) {
      const periodStart = parseXeroDate(payRun.PayRunPeriodStartDate);
      const periodEnd = parseXeroDate(payRun.PayRunPeriodEndDate);
      const paymentDate = parseXeroDate(payRun.PaymentDate);

      if (!periodStart || !periodEnd) {
        skippedPayRuns += 1;
        continue;
      }

      const { data: existingPayPeriod, error: existingError } = await supabase
        .from("staff_pay_periods")
        .select("id")
        .eq("xero_pay_run_id", payRun.PayRunID)
        .maybeSingle();

      if (existingError) {
        throw new Error(
          `Failed to check existing pay period: ${existingError.message}`
        );
      }

      if (existingPayPeriod && !force) {
        skippedPayRuns += 1;
        continue;
      }

      const detailedPayRunJson = await fetchXero(
        accessToken,
        `https://api.xero.com/payroll.xro/1.0/PayRuns/${payRun.PayRunID}`,
        delayMs
      );

      const detailedPayRun: XeroPayRun | null =
        detailedPayRunJson?.PayRuns?.[0] ?? null;

      const payslips = detailedPayRun?.Payslips ?? [];

      if (payslips.length === 0) {
        skippedPayRuns += 1;
        continue;
      }

      const { data: payPeriod, error: payPeriodError } = await supabase
        .from("staff_pay_periods")
        .upsert(
          {
            period_start: periodStart,
            period_end: periodEnd,
            payment_date: paymentDate,
            source: "xero",
            xero_pay_run_id: payRun.PayRunID,
            status: payRun.PayRunStatus ?? "POSTED",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "period_start,period_end" }
        )
        .select("id")
        .single();

      if (payPeriodError) {
        throw new Error(`Failed to save pay period: ${payPeriodError.message}`);
      }

      const payPeriodId = payPeriod.id;
      const rowsToInsert: any[] = [];

      for (const payslipSummary of payslips) {
        const fullPayslipJson = await fetchXero(
          accessToken,
          `https://api.xero.com/payroll.xro/1.0/Payslip/${payslipSummary.PayslipID}`,
          delayMs
        );

        const payslip = fullPayslipJson?.Payslip;
        if (!payslip) continue;

        const employeeName = getEmployeeName(payslipSummary);

        const allEarningsLines: XeroEarningsLine[] = [
          ...(payslip.EarningsLines ?? []),
          ...(payslip.TimesheetEarningsLines ?? []),
          ...(payslip.LeaveEarningsLines ?? []),
        ];

        for (const line of allEarningsLines) {
          const earningsRateId = line.EarningsRateID;
          if (!earningsRateId) continue;

          const earningsRate = earningsRateById.get(earningsRateId);
          const earningsType = earningsRate?.EarningsType ?? "UNKNOWN";
          const earningsName = earningsRate?.Name ?? "Unknown earnings rate";

          const lineHours = Number(line.NumberOfUnits ?? 0);
          const amount = getLineAmount(line);

          let lineType = "other";
          let overtimeMultiplier: number | null = null;

          if (earningsType === "OVERTIMEEARNINGS") {
            lineType = "overtime";
            overtimeMultiplier = getOvertimeMultiplier(earningsName);
            totalOvertimeHours += lineHours;
            totalOvertimeAmount += amount;
          } else if (earningsType === "ORDINARYTIMEEARNINGS") {
            lineType = "ordinary";
          } else if (earningsType === "ALLOWANCE") {
            lineType = "allowance";
          }

          rowsToInsert.push({
            pay_period_id: payPeriodId,
            employee_name: employeeName,
            xero_employee_id: payslipSummary.EmployeeID,
            earnings_rate_name: earningsName,
            xero_earnings_rate_id: earningsRateId,
            line_type: lineType,
            overtime_multiplier: overtimeMultiplier,
            hours: lineHours,
            amount,
            raw_json: line,
          });
        }

        for (const superLine of payslip.SuperannuationLines ?? []) {
          rowsToInsert.push({
            pay_period_id: payPeriodId,
            employee_name: employeeName,
            xero_employee_id: payslipSummary.EmployeeID,
            earnings_rate_name: "Superannuation",
            xero_earnings_rate_id: null,
            line_type: "superannuation",
            overtime_multiplier: null,
            hours: 0,
            amount: Number(superLine.Amount ?? 0),
            raw_json: superLine,
          });
        }
      }

      if (rowsToInsert.length === 0) {
        skippedPayRuns += 1;
        continue;
      }

      const { error: deleteError } = await supabase
        .from("staff_wage_lines")
        .delete()
        .eq("pay_period_id", payPeriodId);

      if (deleteError) {
        throw new Error(`Failed to clear old wage lines: ${deleteError.message}`);
      }

      const { error: insertError } = await supabase
        .from("staff_wage_lines")
        .insert(rowsToInsert);

      if (insertError) {
        throw new Error(`Failed to save wage lines: ${insertError.message}`);
      }

      insertedWageLines += rowsToInsert.length;
      syncedPayRuns += 1;
    }

    const nextOffset = offset + limit;
    const checkedSoFar = Math.min(nextOffset, allMatchingPayRuns.length);
    const hasMore = isBulkSync && nextOffset < allMatchingPayRuns.length;

    return NextResponse.json({
      success: true,
      message: "Xero payroll sync completed.",
      summary: {
        allowedPayrollCalendarIds: ALLOWED_STAFF_PAYROLL_CALENDAR_IDS,
        from,
        to,
        force,
        limit,
        offset,
        nextOffset,
        delayMs,
        matchingPayRuns: allMatchingPayRuns.length,
        payRunsCheckedThisRequest: payRunsToSync.length,
        payRunsSynced: syncedPayRuns,
        payRunsSkipped: skippedPayRuns,
        wageLinesInserted: insertedWageLines,
        overtimeHours: money(totalOvertimeHours),
        overtimeAmount: money(totalOvertimeAmount),
        checkedSoFar,
        hasMore,
        progressLabel: `${checkedSoFar} / ${allMatchingPayRuns.length} pay runs checked`,
      },
      nextBackfillRequest:
        hasMore && from && to
          ? `/api/xero/payroll/sync?from=${from}&to=${to}&force=${
              force ? "1" : "0"
            }&limit=${limit}&offset=${nextOffset}`
          : null,
    });
  } catch (error: any) {
    console.error("Xero payroll sync error", error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Xero payroll sync failed",
      },
      { status: 500 }
    );
  }
}