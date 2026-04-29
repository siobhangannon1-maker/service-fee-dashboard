import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { xeroFetch } from "@/lib/xero";

const ACCOUNT_CODE = "440";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function parseMoney(value: any) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .replace(/\$/g, "")
    .trim();

  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function findAmountInRows(
  rows: any[],
  accountId: string,
  accountName: string
): number {
  for (const row of rows || []) {
    const cells = row.Cells || [];

    const firstCell = cells[0];
    const secondCell = cells[1];

    const label = String(firstCell?.Value || "").toLowerCase();

    const attributes = firstCell?.Attributes || [];
    const accountAttribute = attributes.find(
      (attribute: any) => attribute.Id === "account"
    );

    const matchesByAccountId = accountAttribute?.Value === accountId;
    const matchesByName = label === accountName.toLowerCase();

    if (matchesByAccountId || matchesByName) {
      return parseMoney(secondCell?.Value);
    }

    if (Array.isArray(row.Rows)) {
      const nestedAmount = findAmountInRows(row.Rows, accountId, accountName);
      if (nestedAmount !== null) return nestedAmount;
    }
  }

  return 0;
}

function buildMonthlyRanges(from: string, to: string) {
  const ranges: { start: string; end: string; key: string }[] = [];

  let cursor = new Date(`${from}T00:00:00`);

  while (true) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();

    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);

    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    ranges.push({
      start: startStr,
      end: endStr,
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
    });

    cursor.setMonth(cursor.getMonth() + 1);

    if (cursor > new Date(`${to}T00:00:00`)) break;
  }

  return ranges;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to) {
      return NextResponse.json(
        { error: "Missing date range" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const accountsData = await xeroFetch("/Accounts");

    const labourHireAccount = (accountsData?.Accounts || []).find(
      (account: any) => String(account.Code) === ACCOUNT_CODE
    );

    if (!labourHireAccount) {
      return NextResponse.json(
        { error: `Account ${ACCOUNT_CODE} not found` },
        { status: 404 }
      );
    }

    const monthlyRanges = buildMonthlyRanges(from, to);

    const rows = [];

    for (const range of monthlyRanges) {
      const reportData = await xeroFetch(
        `/Reports/ProfitAndLoss?fromDate=${range.start}&toDate=${range.end}`
      );

      let amount: number | null = null;

      for (const report of reportData?.Reports || []) {
        amount = findAmountInRows(
          report.Rows || [],
          labourHireAccount.AccountID,
          labourHireAccount.Name
        );

        if (amount !== null) break;
      }

      rows.push({
        source_type: "profit_and_loss",
        source_id: `pnl-${range.key}-${ACCOUNT_CODE}`,
        line_item_id: `pnl-${range.key}-${ACCOUNT_CODE}`,
        transaction_date: range.start, // ✅ FIXED
        description: `${ACCOUNT_CODE} - ${labourHireAccount.Name}`,
        account_code: ACCOUNT_CODE,
        amount: amount ?? 0,
        raw_json: reportData,
        synced_at: new Date().toISOString(),
      });
    }

    const { error } = await supabase
      .from("xero_labour_hire")
      .upsert(rows, {
        onConflict: "source_type,line_item_id",
      });

    if (error) throw error;

    return NextResponse.json({
      message: "Labour hire synced monthly",
      months: rows.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}