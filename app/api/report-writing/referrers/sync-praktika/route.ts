import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getCurrentUserPraktikaSessionMode,
  getPraktikaCookie,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PraktikaReferralRow = {
  vchProvider?: string;
  vchClinic?: string;
  vchStreetAddress?: string;
  vchSuburb?: string;
  vchPostCode?: string;
  vchState?: string;
  vchEmail?: string;
  iReferralCount?: string;
  mnyTotalReceived?: string;
  totalIncoming?: string;
  totalOutgoing?: string;
  [key: string]: unknown;
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanEmail(value: unknown): string | null {
  const email = cleanText(value).toLowerCase();

  if (!email) return null;
  if (!email.includes("@")) return null;

  return email;
}

function buildAddress(row: PraktikaReferralRow): string {
  const street = cleanText(row.vchStreetAddress);
  const suburb = cleanText(row.vchSuburb);
  const state = cleanText(row.vchState);
  const postcode = cleanText(row.vchPostCode);

  const suburbLine = [suburb, state, postcode].filter(Boolean).join(" ");

  return [street, suburbLine].filter(Boolean).join("\n");
}

function buildPraktikaKey(row: PraktikaReferralRow): string {
  return [
    cleanText(row.vchProvider).toLowerCase(),
    cleanText(row.vchClinic).toLowerCase(),
    cleanText(row.vchStreetAddress).toLowerCase(),
    cleanText(row.vchSuburb).toLowerCase(),
    cleanText(row.vchPostCode).toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
}

function assertPraktikaJsonResponse(responseText: string) {
  const lower = responseText.trim().toLowerCase();

  if (
    lower.startsWith("<!doctype") ||
    lower.startsWith("<html") ||
    lower.includes("/v2/login") ||
    lower.includes('type="password"') ||
    lower.includes("logged-out") ||
    lower.includes("logged out")
  ) {
    throw new Error("Praktika session expired or returned login page.");
  }
}

async function fetchPraktikaReferrers(mode: PraktikaSessionMode) {
  return withPraktikaAutoRefresh(
    async () => {
      const cookie = await getPraktikaCookie(mode);
      const today = new Date().toISOString().slice(0, 10);
      const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

      const formData = new URLSearchParams();
      formData.set("sReportName", "referrals");
      formData.set("iPracticeId", practiceId);
      formData.set("sFromDate", "2000-01-01");
      formData.set("sToDate", today);
      formData.set("sMode", "PROVIDER_IN");

      const response = await fetch(
        "https://praktika.praktika.net.au/php/json/db_reportingDataWarehouse.php",
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json, text/plain, */*",
            Origin: "https://praktika.praktika.net.au",
            Referer: "https://praktika.praktika.net.au/v2/reports/referrals",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
          },
          body: formData.toString(),
          cache: "no-store",
        },
      );

      const responseText = await response.text();
      assertPraktikaJsonResponse(responseText);

      if (!response.ok) {
        throw new Error(
          `Praktika request failed: ${response.status}. ${responseText.slice(0, 500)}`,
        );
      }

      let parsedRows: unknown;

      try {
        parsedRows = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Praktika returned non-JSON response. ${responseText.slice(0, 500)}`,
        );
      }

      if (!Array.isArray(parsedRows)) {
        throw new Error(
          `Praktika did not return a valid array. ${responseText.slice(0, 500)}`,
        );
      }

      return parsedRows as PraktikaReferralRow[];
    },
    {
      mode,
    },
  );
}

async function importRows(rows: PraktikaReferralRow[]) {
  const referrerMap = new Map<
    string,
    {
      praktika_referrer_key: string;
      name: string;
      practice_name: string | null;
      address: string | null;
      email: string | null;
      is_active: boolean;
      raw_json: PraktikaReferralRow;
      synced_at: string;
      updated_at: string;
    }
  >();

  for (const row of rows) {
    const name = cleanText(row.vchProvider);
    const practiceName = cleanText(row.vchClinic);
    const address = buildAddress(row);
    const email = cleanEmail(row.vchEmail);
    const praktikaKey = buildPraktikaKey(row);

    if (!name || !praktikaKey) continue;

    referrerMap.set(praktikaKey, {
      praktika_referrer_key: praktikaKey,
      name,
      practice_name: practiceName || null,
      address: address || null,
      email,
      is_active: true,
      raw_json: row,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const referrers = Array.from(referrerMap.values());

  if (referrers.length === 0) {
    return {
      imported: 0,
      skipped: rows.length,
    };
  }

  const { error } = await supabase.from("report_referrers").upsert(referrers, {
    onConflict: "praktika_referrer_key",
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    imported: referrers.length,
    skipped: rows.length - referrers.length,
  };
}

export async function POST() {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const parsedRows = await fetchPraktikaReferrers(mode);
    const result = await importRows(parsedRows);

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      totalRows: parsedRows.length,
    });
  } catch (error) {
    console.error("Failed to sync Praktika referrers:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Praktika referrers.",
      },
      { status: 500 },
    );
  }
}
