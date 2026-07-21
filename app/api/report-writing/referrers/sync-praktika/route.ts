import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  createPraktikaHelperJob,
  waitForPraktikaHelperJob,
} from "@/lib/praktika/helper-jobs";

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

async function getCurrentAppUserId() {
  const cookieStore = await cookies();

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Readonly cookie context.
          }
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();

  if (error || !user) {
    throw new Error("You must be logged in to sync Praktika referrers.");
  }

  return user.id;
}

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

function isHuyTranRow(row: PraktikaReferralRow): boolean {
  const providerName = cleanText(row.vchProvider).toLowerCase();

  return providerName.includes("huy tran");
}

function summariseRowKeys(row: PraktikaReferralRow) {
  return {
    provider: cleanText(row.vchProvider),
    clinic: cleanText(row.vchClinic),
    availableKeys: Object.keys(row).sort(),
    fullRow: row,
  };
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

  const now = new Date().toISOString();

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
      synced_at: now,
      updated_at: now,
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
    const appUserId = await getCurrentAppUserId();

    const today = new Date().toISOString().slice(0, 10);
    const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

    console.log("PRAKTIKA REFERRER DEBUG: starting sync", {
      appUserId,
      practiceId,
      fromDate: "2000-01-01",
      toDate: today,
      mode: "PROVIDER_IN",
    });

    const job = await createPraktikaHelperJob({
      appUserId,
      jobType: "sync_referrers",
      priority: 20,
      request: {
        method: "POST",
        path: "/php/json/db_reportingDataWarehouse.php",
        contentType: "form",
        referer: "https://praktika.praktika.net.au/v2/reports/referrals",
        body: {
          sReportName: "referrals",
          iPracticeId: practiceId,
          sFromDate: "2000-01-01",
          sToDate: today,
          sMode: "PROVIDER_IN",
        },
      },
    });

    console.log("PRAKTIKA REFERRER DEBUG: helper job created", {
      jobId: job.id,
    });

    const completedJob = await waitForPraktikaHelperJob(job.id, {
      timeoutMs: 90_000,
      intervalMs: 2_000,
    });

    console.log("PRAKTIKA REFERRER DEBUG: helper job completed", {
      jobId: job.id,
      status: completedJob.status,
      hasResponse: completedJob.response !== null,
      responseType: Array.isArray(completedJob.response)
        ? "array"
        : typeof completedJob.response,
    });

    const parsedRows = completedJob.response;

    if (!Array.isArray(parsedRows)) {
      console.error(
        "PRAKTIKA REFERRER DEBUG: invalid helper response",
        JSON.stringify(parsedRows, null, 2),
      );

      throw new Error("Praktika helper did not return a valid referrers array.");
    }

    const typedRows = parsedRows as PraktikaReferralRow[];

    console.log("PRAKTIKA REFERRER DEBUG: response summary", {
      totalRows: typedRows.length,
      firstRowKeys:
        typedRows.length > 0 ? Object.keys(typedRows[0]).sort() : [],
    });

    const huyTranRows = typedRows.filter(isHuyTranRow);

    console.log(
      "PRAKTIKA REFERRER DEBUG - DR HUY TRAN:",
      JSON.stringify(huyTranRows.map(summariseRowKeys), null, 2),
    );

    const possibleIdentifierKeys = Array.from(
      new Set(
        typedRows.flatMap((row) =>
          Object.keys(row).filter((key) => {
            const normalisedKey = key.toLowerCase();

            return (
              normalisedKey.includes("clinic") ||
              normalisedKey.includes("provider") ||
              normalisedKey.includes("party") ||
              normalisedKey.includes("referrer") ||
              normalisedKey.includes("number") ||
              normalisedKey.includes("id")
            );
          }),
        ),
      ),
    ).sort();

    console.log(
      "PRAKTIKA REFERRER DEBUG: possible identifier fields",
      possibleIdentifierKeys,
    );

    const result = await importRows(typedRows);

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      totalRows: typedRows.length,
      jobId: job.id,
      debug: {
        huyTranRows: huyTranRows.map(summariseRowKeys),
        possibleIdentifierKeys,
        firstRowKeys:
          typedRows.length > 0 ? Object.keys(typedRows[0]).sort() : [],
      },
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