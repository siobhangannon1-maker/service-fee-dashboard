import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPraktikaCookie } from "@/lib/praktika/session-store";
import { withPraktikaAutoRefresh } from "@/lib/praktika/seamless-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type PraktikaAppointmentRow = {
  iPatientId?: string;
  iAppointmentId?: string;
  dtAppointment?: string;
  vchProviderName?: string;
  vchPatientFirstName?: string;
  vchPatientLastName?: string;
  dtDOB?: string;
  vchIconLabel1?: string;
  vchIconLabel2?: string;
  vchIconLabel3?: string;
  vchIconLabel4?: string;
  [key: string]: unknown;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normaliseProviderName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/^dr\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTypistLetterIcon(row: PraktikaAppointmentRow) {
  return [
    row.vchIconLabel1,
    row.vchIconLabel2,
    row.vchIconLabel3,
    row.vchIconLabel4,
  ].some((label) => clean(label).toLowerCase() === "typist letter");
}

async function fetchAppointmentRowsFromPraktika({
  fromDate,
  toDate,
  practiceId,
}: {
  fromDate: string;
  toDate: string;
  practiceId: string;
}) {
  return withPraktikaAutoRefresh(async () => {
    const cookie = await getPraktikaCookie();

    const params = new URLSearchParams();
    params.append("sReportName", "appointments");
    params.append("bByCreationTime", "false");
    params.append("iPracticeIds[]", practiceId);
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);

    const response = await fetch(
      "https://praktika.praktika.net.au/php/json/db_reportingDataWarehouse.php",
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
          Origin: "https://praktika.praktika.net.au",
          Referer: "https://praktika.praktika.net.au/v2/reports/appointments",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
        },
        body: params.toString(),
        cache: "no-store",
      },
    );

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Praktika request failed: ${response.status}. ${responseText.slice(0, 500)}`,
      );
    }

    if (responseText.trim().startsWith("<")) {
      throw new Error(
        "Praktika returned HTML instead of JSON. The Praktika session is probably expired.",
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
        `Praktika did not return a valid appointment array. ${responseText.slice(0, 500)}`,
      );
    }

    return parsedRows as PraktikaAppointmentRow[];
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const fromDate =
      clean(body.fromDate) || new Date().toISOString().slice(0, 10);
    const toDate = clean(body.toDate) || fromDate;

    if (fromDate > toDate) {
      return NextResponse.json(
        { success: false, error: "From date cannot be after to date." },
        { status: 400 },
      );
    }

    const practiceId = process.env.PRAKTIKA_PRACTICE_ID || "1181";

    const parsedRows = await fetchAppointmentRowsFromPraktika({
      fromDate,
      toDate,
      practiceId,
    });

    const { data: mappings, error: mappingError } = await supabase
      .from("provider_name_mappings")
      .select(`
        provider_id,
        raw_provider_name,
        normalized_provider_name,
        providers!inner (
          id,
          is_active
        )
      `)
      .eq("source_type", "appointments_csv")
      .eq("providers.is_active", true);

    if (mappingError) {
      return NextResponse.json(
        { success: false, error: mappingError.message },
        { status: 500 },
      );
    }

    const providerMap = new Map<string, string>();

    for (const mapping of mappings || []) {
      if (!mapping.provider_id) continue;

      providerMap.set(
        normaliseProviderName(mapping.raw_provider_name),
        mapping.provider_id,
      );

      providerMap.set(
        normaliseProviderName(mapping.normalized_provider_name),
        mapping.provider_id,
      );
    }

    const incomingQueueRows = parsedRows
      .filter(hasTypistLetterIcon)
      .map((row) => {
        const rawProviderName = clean(row.vchProviderName);
        const providerId =
          providerMap.get(normaliseProviderName(rawProviderName)) || null;

        return {
          provider_id: providerId,
          praktika_patient_id: clean(row.iPatientId) || null,
          patient_first_name: clean(row.vchPatientFirstName) || null,
          patient_last_name: clean(row.vchPatientLastName) || null,
          patient_dob: clean(row.dtDOB) || null,
          appointment_id: clean(row.iAppointmentId),
          appointment_time: clean(row.dtAppointment) || null,
          queue_reason: "Typist Letter icon on Praktika appointment",
          raw_json: row,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((row) => row.appointment_id);

    if (incomingQueueRows.length === 0) {
      return NextResponse.json({
        success: true,
        totalRows: parsedRows.length,
        queued: 0,
        matchedProviders: 0,
        unmatchedProviders: 0,
        message: "No appointments with Typist Letter icon found.",
      });
    }

    const appointmentIds = incomingQueueRows.map((row) => row.appointment_id);

    const { data: existingRows, error: existingError } = await supabase
      .from("report_letter_queue")
      .select("appointment_id, status, report_draft_id")
      .in("appointment_id", appointmentIds);

    if (existingError) {
      return NextResponse.json(
        { success: false, error: existingError.message },
        { status: 500 },
      );
    }

    const existingByAppointmentId = new Map(
      (existingRows || []).map((row) => [row.appointment_id, row]),
    );

    const rowsToUpsert = incomingQueueRows.map((row) => {
      const existing = existingByAppointmentId.get(row.appointment_id);

      return {
        ...row,

        // Critical preservation:
        // Do NOT reset started/completed rows back to queued during a resync.
        status: existing?.status || "queued",

        // Critical preservation:
        // Keep the linked draft if this appointment already started a letter.
        report_draft_id: existing?.report_draft_id || null,
      };
    });

    const matchedProviders = rowsToUpsert.filter((row) => row.provider_id).length;
    const unmatchedProviders = rowsToUpsert.filter((row) => !row.provider_id).length;

    const { data, error } = await supabase
      .from("report_letter_queue")
      .upsert(rowsToUpsert, {
        onConflict: "appointment_id",
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      totalRows: parsedRows.length,
      queued: data?.length || 0,
      matchedProviders,
      unmatchedProviders,
      fromDate,
      toDate,
      queue: data || [],
    });
  } catch (error) {
    console.error("Praktika letter queue sync failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync Praktika letter queue.",
      },
      { status: 500 },
    );
  }
}
