"use server";

import { fetchPraktikaJson } from "@/lib/praktika/fetch-praktika-json";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { getAppointmentCategory } from "@/lib/appointmentCategories";

type ActionState = {
  ok: boolean;
  message: string;
};

function getClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function getPracticeId() {
  const practiceId = process.env.PRAKTIKA_PRACTICE_ID;

  if (!practiceId) {
    throw new Error("Missing PRAKTIKA_PRACTICE_ID");
  }

  return practiceId;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeProviderName(value: string | null | undefined): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[–—]/g, "-");
}

function normalizeProviderNameCompact(value: string | null | undefined): string {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createBaseProviderName(value: string | null | undefined): string {
  return normalizeProviderName(value)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: unknown): number {
  const num = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function toNullableText(value: unknown): string | null {
  const text = normalizeWhitespace(String(value ?? ""));
  return text ? text : null;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getRequiredDateRange(formData: FormData) {
  const fromDate = String(formData.get("fromDate") ?? "").trim();
  const toDate = String(formData.get("toDate") ?? "").trim();

  if (!isValidIsoDate(fromDate) || !isValidIsoDate(toDate)) {
    throw new Error("Please select a valid From date and To date.");
  }

  if (fromDate > toDate) {
    throw new Error("From date must be before or equal to To date.");
  }

  return { fromDate, toDate };
}

function getMonthEndIso(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);

  const end = new Date(year, month, 0);

  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(end.getDate()).padStart(2, "0")}`;
}

function getImportLinkKey(fromDate: string, toDate: string): string {
  const monthKey = fromDate.slice(0, 7);

  if (fromDate === `${monthKey}-01` && toDate === getMonthEndIso(monthKey)) {
    return monthKey;
  }

  return `${fromDate}_${toDate}`;
}

function addMinutesToTimestamp(startTimestamp: string, minutes: number): string {
  const [datePart, timePart] = startTimestamp.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);

  const date = new Date(year, month - 1, day, hour, minute, second || 0);
  date.setMinutes(date.getMinutes() + Math.max(0, minutes));

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function parseDurationMinutes(value: unknown): number {
  const text = normalizeWhitespace(String(value ?? ""));

  if (!text) return 0;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) return Math.max(0, Math.round(numeric));

  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);

  return 0;
}

function normaliseStatusId(value: unknown): string | null {
  const text = normalizeWhitespace(String(value ?? ""));
  if (!text || text === "0") return null;
  return text;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

async function loadProviderLookup(sourceTypes: string[]) {
  const supabase = getClient();

  const [providersResult, mappingsResult] = await Promise.all([
    supabase.from("providers").select("id, name"),
    supabase
      .from("provider_name_mappings")
      .select("provider_id, raw_provider_name, normalized_provider_name, source_type")
      .in("source_type", sourceTypes),
  ]);

  if (providersResult.error) {
    throw new Error(`Failed to load providers: ${providersResult.error.message}`);
  }

  if (mappingsResult.error) {
    throw new Error(`Failed to load provider mappings: ${mappingsResult.error.message}`);
  }

  const lookup = new Map<string, string>();

  for (const provider of providersResult.data ?? []) {
    if (!provider.name) continue;

    lookup.set(normalizeProviderName(provider.name), provider.id);
    lookup.set(normalizeProviderNameCompact(provider.name), provider.id);
    lookup.set(createBaseProviderName(provider.name), provider.id);
  }

  for (const mapping of mappingsResult.data ?? []) {
    lookup.set(String(mapping.normalized_provider_name ?? ""), mapping.provider_id);
    lookup.set(normalizeProviderName(mapping.raw_provider_name), mapping.provider_id);
    lookup.set(normalizeProviderNameCompact(mapping.raw_provider_name), mapping.provider_id);
    lookup.set(createBaseProviderName(mapping.raw_provider_name), mapping.provider_id);
  }

  return lookup;
}

async function insertImportBatch(params: {
  importBatchId: string;
  importType: "appointments" | "performance" | "cancellations";
  sourceFileName: string;
  monthKey: string;
}) {
  const supabase = getClient();

  const { error } = await supabase.from("provider_import_batches").insert({
    import_batch_id: params.importBatchId,
    import_type: params.importType,
    source_file_name: params.sourceFileName,
    month_key: params.monthKey,
    is_linked: true,
  });

  if (error) throw new Error(`Failed to insert import batch: ${error.message}`);
}

async function replaceImportBatchForRange(params: {
  importType: "appointments" | "performance" | "cancellations";
  rangeKey: string;
}) {
  const supabase = getClient();

  const { error } = await supabase
    .from("provider_import_batches")
    .delete()
    .eq("import_type", params.importType)
    .eq("month_key", params.rangeKey);

  if (error) throw new Error(`Failed to delete old import batch: ${error.message}`);
}

function refreshProviderPages() {
  revalidatePath("/admin/provider-imports");
  revalidatePath("/admin/provider-dashboard");
  revalidatePath("/provider");
  revalidatePath("/admin/practice-kpis");
}

export async function syncPraktikaProviderPerformance(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const supabase = getClient();
    const practiceId = getPracticeId();
    const { fromDate, toDate } = getRequiredDateRange(formData);
    const rangeKey = getImportLinkKey(fromDate, toDate);

    const params = new URLSearchParams();
    params.append("sReportName", "providerPerformance");
    params.append("bExcludeLunchFromWorkingHours", "true");
    params.append("iPracticeIds[]", practiceId);
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);
    params.append("sWorkingHoursMethod", "dumb");

    const data = await fetchPraktikaJson(
      params,
      "https://praktika.praktika.net.au/v2/reports/provider-performance"
    );

    const providerLookup = await loadProviderLookup(["provider_performance_csv"]);
    const importBatchId = randomUUID();

    const { error: deleteError } = await supabase
      .from("provider_performance_raw")
      .delete()
      .gte("period_start", fromDate)
      .lte("period_end", toDate);

    if (deleteError) {
      throw new Error(`Failed to delete old performance rows: ${deleteError.message}`);
    }

    await replaceImportBatchForRange({ importType: "performance", rangeKey });

    const rows = data.map((row: any) => {
      const rawProviderName = normalizeWhitespace(row.vchProviderName ?? "");
      const normalized = normalizeProviderNameCompact(rawProviderName);

      return {
        source_file_name: "Praktika Sync - Provider Performance",
        import_batch_id: importBatchId,
        provider_id:
          providerLookup.get(normalized) ??
          providerLookup.get(normalizeProviderName(rawProviderName)) ??
          providerLookup.get(createBaseProviderName(rawProviderName)) ??
          null,
        provider_name_raw: rawProviderName,
        provider_name_normalized: normalized,
        period_start: fromDate,
        period_end: toDate,
        patients_treated: toNumber(row.iTotalPatients),
        appointments_completed: toNumber(row.iTotalAppointments),
        hours_scheduled: toNumber(row.nScheduledHours),
        hours_appointed: toNumber(row.nAppointedHours),
        hours_billed: toNumber(row.nBilledHours),
        revenue: toNumber(row.nActualFees),
        ftas: toNumber(row.iTotalFTAs),
        cancellations: toNumber(row.iTotalCancellations),
        production_per_hour_appointed: toNumber(row.nRatePerScheduledHour),
        production_per_hour_billed: toNumber(row.nRatePerBilledHour),
      };
    });

    for (const chunk of chunkArray(rows, 500)) {
      const { error } = await supabase.from("provider_performance_raw").insert(chunk);
      if (error) throw new Error(`Failed to insert performance rows: ${error.message}`);
    }

    await insertImportBatch({
      importBatchId,
      importType: "performance",
      sourceFileName: "Praktika Sync - Provider Performance",
      monthKey: rangeKey,
    });

    refreshProviderPages();

    return {
      ok: true,
      message: `Synced ${rows.length} Provider Performance rows from ${fromDate} to ${toDate}.`,
    };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Provider Performance sync failed.",
    };
  }
}

export async function syncPraktikaAppointments(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const supabase = getClient();
    const practiceId = getPracticeId();
    const { fromDate, toDate } = getRequiredDateRange(formData);
    const rangeKey = getImportLinkKey(fromDate, toDate);

    const params = new URLSearchParams();
    params.append("sReportName", "appointments");
    params.append("bByCreationTime", "false");
    params.append("iPracticeIds[]", practiceId);
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);

    const data = await fetchPraktikaJson(
      params,
      "https://praktika.praktika.net.au/v2/reports/upcoming-appointments"
    );

    const providerLookup = await loadProviderLookup(["appointments_csv"]);
    const importBatchId = randomUUID();

    const { error: deleteError } = await supabase
      .from("provider_appointments_raw")
      .delete()
      .gte("appointment_date", fromDate)
      .lte("appointment_date", toDate);

    if (deleteError) {
      throw new Error(`Failed to delete old appointment rows: ${deleteError.message}`);
    }

    await replaceImportBatchForRange({ importType: "appointments", rangeKey });

    const rows = data
      .filter((row: any) => row.vchNextAppDate || row.dtNextAppointment)
      .map((row: any) => {
        const rawProviderName = normalizeWhitespace(row.vchProviderName ?? "");
        const normalized = normalizeProviderName(rawProviderName);

        const appointmentDate =
          normalizeWhitespace(row.vchNextAppDate ?? "") ||
          normalizeWhitespace(row.dtNextAppointment ?? "").slice(0, 10);

        const appointmentStart =
          normalizeWhitespace(row.dtNextAppointment ?? "") ||
          `${appointmentDate} 00:00:00`;

        const durationMinutes =
          parseDurationMinutes(row.iAppointmentDuration) ||
          parseDurationMinutes(row.vchNextAppLength);

        const appointmentEnd = addMinutesToTimestamp(
          appointmentStart,
          durationMinutes
        );

        const appointmentStatus = normaliseStatusId(row.iAppointmentStatusId);
        const arrivalStatus = normaliseStatusId(row.iPatientArrivalStatusId);
        const responseStatus = normaliseStatusId(row.iPatientResponseId);

        const isCancelled =
          normalizeWhitespace(appointmentStatus).toLowerCase() === "cancelled" ||
          normalizeWhitespace(responseStatus).toLowerCase() === "cancelled";

        const isFta = !isCancelled && arrivalStatus === null && responseStatus === null;

        const followingAppointmentRaw = toNullableText(row.dtFollowingAppDate);
        const hasFollowingAppointment = Boolean(followingAppointmentRaw);

        return {
          source_file_name: "Praktika Sync - Appointments",
          import_batch_id: importBatchId,
          provider_id:
            providerLookup.get(normalized) ??
            providerLookup.get(normalizeProviderNameCompact(rawProviderName)) ??
            providerLookup.get(createBaseProviderName(rawProviderName)) ??
            null,
          provider_name_raw: rawProviderName,
          provider_name_normalized: normalized,
          appointment_date: appointmentDate,
          appointment_start: appointmentStart,
          appointment_end: appointmentEnd,
          duration_minutes: durationMinutes,
          patient_name_raw: null,
          treatment_type: toNullableText(row.vchTxType),
          appointment_value: toNumber(row.nNextAppointmentValue),
          appointment_status: appointmentStatus,
          arrival_status: arrivalStatus,
          response_status: responseStatus,
          following_appointment_raw: followingAppointmentRaw,
          is_cancelled: isCancelled,
          is_fta: isFta,
          has_following_appointment: hasFollowingAppointment,
        };
      });

    for (const chunk of chunkArray(rows, 500)) {
      const { error } = await supabase.from("provider_appointments_raw").insert(chunk);
      if (error) throw new Error(`Failed to insert appointment rows: ${error.message}`);
    }

    await insertImportBatch({
      importBatchId,
      importType: "appointments",
      sourceFileName: "Praktika Sync - Appointments",
      monthKey: rangeKey,
    });

    refreshProviderPages();

    return {
      ok: true,
      message: `Synced ${rows.length} appointment rows from ${fromDate} to ${toDate}.`,
    };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Appointments sync failed.",
    };
  }
}

export async function syncPraktikaCancellationsFtas(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const supabase = getClient();
    const practiceId = getPracticeId();
    const { fromDate, toDate } = getRequiredDateRange(formData);
    const rangeKey = getImportLinkKey(fromDate, toDate);

    const params = new URLSearchParams();
    params.append("sReportName", "appointmentsFTA");
    params.append("bByDateWhenCancelled", "false");
    params.append("iPracticeId", practiceId);
    params.append("sFromDate", fromDate);
    params.append("sToDate", toDate);

    const data = await fetchPraktikaJson(
      params,
      "https://praktika.praktika.net.au/v2/reports/fta-cancellations"
    );

    const providerLookup = await loadProviderLookup([
      "appointments_csv",
      "cancellations_csv",
    ]);
    const importBatchId = randomUUID();

    const { error: deleteError } = await supabase
      .from("provider_cancellations_ftas_raw")
      .delete()
      .gte("event_date", fromDate)
      .lte("event_date", toDate);

    if (deleteError) {
      throw new Error(`Failed to delete old FTA/cancellation rows: ${deleteError.message}`);
    }

    await replaceImportBatchForRange({ importType: "cancellations", rangeKey });

    const rows = data
      .filter((row: any) => row.vchAppointmentDate)
      .map((row: any) => {
        const rawProviderName = normalizeWhitespace(row.vchProviderName ?? "");
        const normalized = normalizeProviderName(rawProviderName);

        const statusRaw = toNullableText(row.vchFTAOrCancelled);
        const normalizedStatus = normalizeWhitespace(statusRaw).toLowerCase();

        const isFta = normalizedStatus === "fta";
        const isCancellation =
          normalizedStatus === "cancelled" ||
          normalizedStatus === "canceled" ||
          normalizedStatus.includes("cancelled") ||
          normalizedStatus.includes("canceled");

        const nextAppointmentRaw = toNullableText(row.vchNextAppointmentDate);
        const hasNextAppointment = Boolean(nextAppointmentRaw);
        const treatmentType = toNullableText(row.vchAppointmentTxType);

        return {
          source_file_name: "Praktika Sync - FTA Cancellations",
          import_batch_id: importBatchId,
          provider_id:
            providerLookup.get(normalized) ??
            providerLookup.get(normalizeProviderNameCompact(rawProviderName)) ??
            providerLookup.get(createBaseProviderName(rawProviderName)) ??
            null,
          provider_name_raw: rawProviderName,
          provider_name_normalized: normalized,
          event_date: row.vchAppointmentDate,
          event_time: toNullableText(row.vchAppointmentTime),
          patient_name_raw: null,
          treatment_type: treatmentType,
          appointment_category: getAppointmentCategory(treatmentType),
          status_raw: statusRaw,
          next_appointment_raw: nextAppointmentRaw,
          has_next_appointment: hasNextAppointment,
          is_fta: isFta,
          is_cancellation: isCancellation,
          is_fta_no_rebooking: isFta && !hasNextAppointment,
          is_cancellation_no_rebooking: isCancellation && !hasNextAppointment,
        };
      });

    for (const chunk of chunkArray(rows, 500)) {
      const { error } = await supabase
        .from("provider_cancellations_ftas_raw")
        .insert(chunk);

      if (error) {
        throw new Error(`Failed to insert FTA/cancellation rows: ${error.message}`);
      }
    }

    await insertImportBatch({
      importBatchId,
      importType: "cancellations",
      sourceFileName: "Praktika Sync - FTA Cancellations",
      monthKey: rangeKey,
    });

    refreshProviderPages();

    return {
      ok: true,
      message: `Synced ${rows.length} FTA/cancellation rows from ${fromDate} to ${toDate}.`,
    };
  } catch (error) {
    console.error(error);
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "FTA/cancellations sync failed.",
    };
  }
}