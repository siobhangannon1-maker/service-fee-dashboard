import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getXeroAccessToken } from "@/lib/xero";

async function fetchXero(accessToken: string, url: string) {
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

  return {
    ok: response.ok,
    status: response.status,
    url,
    data: json,
  };
}

export async function GET() {
  try {
    await requireRole(["admin", "practice_manager"]);

    const accessToken = await getXeroAccessToken();

    // 1. Get pay runs
    const payRunsResult = await fetchXero(
      accessToken,
      "https://api.xero.com/payroll.xro/1.0/PayRuns"
    );

    const payRuns = payRunsResult.data?.PayRuns || [];
    const latestPosted =
      payRuns.find((r: any) => r.PayRunStatus === "POSTED") || payRuns[0];

    const payRunId = latestPosted.PayRunID;

    // 2. Get single pay run
    const payRunDetail = await fetchXero(
      accessToken,
      `https://api.xero.com/payroll.xro/1.0/PayRuns/${payRunId}`
    );

    const payslips = payRunDetail.data?.PayRuns?.[0]?.Payslips || [];

    if (payslips.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No payslips found",
      });
    }

    // 3. Pick ONE payslip
    const firstPayslip = payslips[0];

    // 4. Fetch FULL payslip
    const fullPayslip = await fetchXero(
      accessToken,
      `https://api.xero.com/payroll.xro/1.0/Payslip/${firstPayslip.PayslipID}`
    );

    return NextResponse.json({
      success: true,
      payRunId,
      payslipId: firstPayslip.PayslipID,
      summaryPayslip: firstPayslip,
      fullPayslip: fullPayslip.data,
    });
  } catch (error: any) {
    console.error("Xero payroll test error", error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed",
      },
      { status: 500 }
    );
  }
}