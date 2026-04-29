import { NextResponse } from "next/server";
import { xeroFetch } from "@/lib/xero";

export async function GET() {
  try {
    const accountsData = await xeroFetch("/Accounts");

    const accounts = (accountsData?.Accounts || [])
      .map((account: any) => ({
        code: account.Code,
        name: account.Name,
        type: account.Type,
        status: account.Status,
      }))
      .filter((account: any) => {
        const text = `${account.code} ${account.name}`.toLowerCase();

        return (
          text.includes("440") ||
          text.includes("labour") ||
          text.includes("labor") ||
          text.includes("hire")
        );
      });

    const reportData = await xeroFetch(
      "/Reports/ProfitAndLoss?fromDate=2026-04-01&toDate=2026-04-30"
    );

    return NextResponse.json({
      matchingAccounts: accounts,
      profitAndLossPreview: reportData,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message,
      },
      { status: 500 }
    );
  }
}