import { NextResponse } from "next/server";
import { getXeroAccessToken } from "@/lib/xero";

function parseDate(value: string) {
  const match = value?.match(/\/Date\((\d+)\)\//);
  if (match) return new Date(Number(match[1])).toISOString().slice(0, 10);
  return value?.slice(0, 10);
}

export async function GET() {
  try {
    const token = await getXeroAccessToken();

    const res = await fetch(
      "https://api.xero.com/api.xro/2.0/Invoices?where=Type==\"ACCPAY\"",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    const data = await res.json();

    const accountSet = new Set<string>();

    for (const bill of data?.Invoices || []) {
      for (const line of bill.LineItems || []) {
        if (line.AccountCode) {
          accountSet.add(String(line.AccountCode));
        }
      }
    }

    return NextResponse.json({
      accounts: Array.from(accountSet).sort(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}