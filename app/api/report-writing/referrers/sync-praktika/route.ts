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
    const appUserId = await getCurrentAppUserId();

    const today = new Date().toISOString().slice(0, 10);
    const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

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

    const completedJob = await waitForPraktikaHelperJob(job.id, {
      timeoutMs: 90_000,
      intervalMs: 2_000,
    });

    const parsedRows = completedJob.response;

    if (!Array.isArray(parsedRows)) {
      throw new Error("Praktika helper did not return a valid referrers array.");
    }

    const result = await importRows(parsedRows as PraktikaReferralRow[]);

    return NextResponse.json({
      success: true,
      imported: result.imported,
      skipped: result.skipped,
      totalRows: parsedRows.length,
      jobId: job.id,
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