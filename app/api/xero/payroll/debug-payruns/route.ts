import { NextResponse } from "next/server";
import { getXeroAccessToken } from "@/lib/xero";
import { requireRole } from "@/lib/auth";

const MAIN_STAFF_PAYROLL_CALENDAR_ID =
  "1b3d1126-57a2-4c24-9362-81c7d4fd6ecf";

function parseXeroDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\/Date\((\d+)/);
  if (!match) return null;
  return new Date(Number(match[1])).toISOString().slice(0, 10);
}

export async function GET() {
  try {
    await requireRole(["admin", "practice_manager"]);

    const accessToken = await getXeroAccessToken();

    const response = await fetch(
      "https://api.xero.com/payroll.xro/1.0/PayRuns",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;

    if (!response.ok) {
      return NextResponse.json(
        { success: false, status: response.status, error: text },
        { status: 500 }
      );
    }

    const payRuns = json?.PayRuns ?? [];

    return NextResponse.json({
      success: true,
      totalPayRunsReturned: payRuns.length,
      mainPayrollCalendarId: MAIN_STAFF_PAYROLL_CALENDAR_ID,
      payRuns: payRuns.map((run: any) => ({
        payRunId: run.PayRunID,
        payrollCalendarId: run.PayrollCalendarID,
        isMainCalendar:
          run.PayrollCalendarID === MAIN_STAFF_PAYROLL_CALENDAR_ID,
        status: run.PayRunStatus,
        periodStart: parseXeroDate(run.PayRunPeriodStartDate),
        periodEnd: parseXeroDate(run.PayRunPeriodEndDate),
        paymentDate: parseXeroDate(run.PaymentDate),
        wages: run.Wages,
        super: run.Super,
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Debug failed" },
      { status: 500 }
    );
  }
}