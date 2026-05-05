import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const PRAKTIKA_ENDPOINT =
  "https://praktika.praktika.net.au/php/json/db_reportingDataWarehouse.php";

function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function normalizeWhitespace(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeProviderNameCompact(value: unknown): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseDate(value: unknown): string | null {
  const text = normalizeWhitespace(value);
  if (!text) return null;

  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (isoMatch) return isoMatch[0];

  return null;
}

function sanitizeRawJson(row: any) {
  const blockedKeys = ["patient", "name", "email", "phone", "address"];

  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const compactKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (blockedKeys.some((blocked) => compactKey.includes(blocked))) {
      cleaned[key] = "[removed]";
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

function loadPraktikaCookieFromEnvFile(): string {
  const envPath = path.join(process.cwd(), ".env.local");
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const cookie = parsed.PRAKTIKA_COOKIE;

  process.env.PRAKTIKA_COOKIE = cookie;
  return cookie;
}

function refreshPraktikaCookieLocally() {
  execFileSync("npm", ["run", "refresh:praktika-cookie"], {
    stdio: "inherit",
  });

  return loadPraktikaCookieFromEnvFile();
}

async function fetchPraktikaJson(params: URLSearchParams) {
  async function makeRequest(cookie: string) {
    const res = await fetch(PRAKTIKA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Origin: "https://praktika.praktika.net.au",
        Referer: "https://praktika.praktika.net.au/v2/reports/new-patients",
      },
      body: params.toString(),
    });

    const text = await res.text();

    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) return data;

      console.log("Praktika non-array:", data);
      return null;
    } catch {
      console.log("Non-JSON:", text.slice(0, 300));
      return null;
    }
  }

  const first = await makeRequest(process.env.PRAKTIKA_COOKIE!);
  if (first) return first;

  const refreshed = refreshPraktikaCookieLocally();
  const second = await makeRequest(refreshed);
  if (second) return second;

  throw new Error("Praktika session expired (MFA required)");
}

export async function POST(req: Request) {
  try {
    const { fromDate, toDate } = await req.json();

    const supabase = getClient();
    const practiceId = process.env.PRAKTIKA_PRACTICE_ID!;

    const params = new URLSearchParams();
    params.append("sReportName", "newPatients");
    params.append("bUseFirstAppointmentDate", "false");
    params.append("iPracticeIds[]", practiceId);
    params.append("iProviderId", "");
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);

    const data = await fetchPraktikaJson(params);

    console.log("NEW PATIENTS SAMPLE:", data[0]);

    const importBatchId = crypto.randomUUID();

    // clear existing rows for this period
    await supabase
      .from("provider_new_patients_raw")
      .delete()
      .gte("joined_date", fromDate)
      .lte("joined_date", toDate);

    const rows = data.map((row: any) => {
      const joinedDate = parseDate(row.dtDateJoined) || fromDate;

      // ✅ CRITICAL FIX: ONLY use FIRST PROVIDER
      const firstProviderSeen = normalizeWhitespace(
        row.vchFirstProviderSeenName
      );

      const hasFirstProvider = firstProviderSeen.length > 0;

      return {
        source_file_name: `Praktika New Patients ${fromDate} to ${toDate}`,
        import_batch_id: importBatchId,
        joined_date: joinedDate,

        // KPI FIELD (this drives your %)
        provider_name_raw: hasFirstProvider ? firstProviderSeen : null,

        provider_name_normalized: hasFirstProvider
          ? normalizeProviderNameCompact(firstProviderSeen)
          : null,

        provider_id: null, // optional later

        // appointment info (not used for booking KPI)
        first_appointment_raw: row.dtFirstAppointment || null,
        has_first_appointment: hasFirstProvider,

        next_appointment_raw: row.dtNextAppointmentDate || null,
        has_next_appointment: Boolean(row.dtNextAppointmentDate),

        patient_name_raw: null,

        raw_json: {
          ...sanitizeRawJson(row),
          referral_source: row.vchReferralSource || null,
        },
      };
    });

    const { error } = await supabase
      .from("provider_new_patients_raw")
      .insert(rows);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      rowCount: rows.length,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}