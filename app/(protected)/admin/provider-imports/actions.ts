"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { importProviderAppointmentsCsv } from "@/lib/providers/import-provider-appointments-csv";
import { importProviderPerformanceCsv } from "@/lib/providers/import-provider-performance-csv";
import { importProviderCancellationsFtasCsv } from "@/lib/providers/import-provider-cancellations-ftas-csv";
import { importProviderNewPatientsCsv } from "@/lib/providers/import-provider-new-patients-csv";
import { calculateProviderMonthlyMetrics } from "@/lib/providers/calculate-provider-monthly-metrics";
import { calculateProviderYearlyMetrics } from "@/lib/providers/calculate-provider-yearly-metrics";
import { calculateProviderAtoQuarterMetrics } from "@/lib/providers/calculate-provider-ato-quarter-metrics";
import {
  getAtoQuarterPeriodFromIsoDate,
  getYearPeriodFromIsoDate,
} from "@/lib/providers/provider-periods";

export type RunProviderImportsState = {
  ok: boolean;
  message: string;
};

type ImportType = "appointments" | "performance" | "cancellations" | "new_patients";

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

function isValidMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getMonthStartIso(monthKey: string): string {
  return `${monthKey}-01`;
}

function getMonthEndIso(monthKey: string): string {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid month key: "${monthKey}". Expected YYYY-MM.`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  const end = new Date(year, monthIndex + 1, 0);
  const pad2 = (value: number) => String(value).padStart(2, "0");

  return `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
}

function convertIsoToDdMmYyyy(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid ISO date: "${isoDate}"`);
  }

  const [, yyyy, mm, dd] = match;
  return `${dd}/${mm}/${yyyy}`;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");

  const monthNames: Record<string, string> = {
    "01": "January",
    "02": "February",
    "03": "March",
    "04": "April",
    "05": "May",
    "06": "June",
    "07": "July",
    "08": "August",
    "09": "September",
    "10": "October",
    "11": "November",
    "12": "December",
  };

  return `${monthNames[month] ?? month} ${year}`;
}

async function saveUploadedFileToTemp(
  file: File,
  prefix: string
): Promise<{ tempFilePath: string; originalFileName: string }> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const tempDir = path.join("/tmp", "provider-imports");
  await fs.mkdir(tempDir, { recursive: true });

  const safeOriginalName = file.name || `${prefix}.csv`;
  const tempFileName = `${prefix}-${randomUUID()}-${safeOriginalName}`;
  const tempFilePath = path.join(tempDir, tempFileName);

  await fs.writeFile(tempFilePath, buffer);

  return {
    tempFilePath,
    originalFileName: safeOriginalName,
  };
}

async function deleteAllDataForMonth(
  importType: ImportType,
  monthKey: string,
  excludeImportBatchId?: string
) {
  const supabase = getServiceRoleSupabaseClient();
  const monthStart = getMonthStartIso(monthKey);
  const monthEnd = getMonthEndIso(monthKey);

  if (importType === "appointments") {
    let query = supabase
      .from("provider_appointments_raw")
      .delete()
      .gte("appointment_date", monthStart)
      .lte("appointment_date", monthEnd);

    if (excludeImportBatchId) {
      query = query.neq("import_batch_id", excludeImportBatchId);
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Failed to clear appointments raw rows for ${monthKey}: ${error.message}`);
    }
  }

  if (importType === "performance") {
    let query = supabase
      .from("provider_performance_raw")
      .delete()
      .eq("period_start", monthStart)
      .eq("period_end", monthEnd);

    if (excludeImportBatchId) {
      query = query.neq("import_batch_id", excludeImportBatchId);
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Failed to clear performance raw rows for ${monthKey}: ${error.message}`);
    }
  }

  if (importType === "cancellations") {
    let query = supabase
      .from("provider_cancellations_ftas_raw")
      .delete()
      .gte("event_date", monthStart)
      .lte("event_date", monthEnd);

    if (excludeImportBatchId) {
      query = query.neq("import_batch_id", excludeImportBatchId);
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Failed to clear cancellations raw rows for ${monthKey}: ${error.message}`);
    }
  }


  if (importType === "new_patients") {
    let query = supabase
      .from("provider_new_patients_raw")
      .delete()
      .gte("joined_date", monthStart)
      .lte("joined_date", monthEnd);

    if (excludeImportBatchId) {
      query = query.neq("import_batch_id", excludeImportBatchId);
    }

    const { error } = await query;

    if (error) {
      throw new Error(`Failed to clear new patient rows for ${monthKey}: ${error.message}`);
    }
  }

  let batchDeleteQuery = supabase
    .from("provider_import_batches")
    .delete()
    .eq("import_type", importType)
    .eq("month_key", monthKey);

  if (excludeImportBatchId) {
    batchDeleteQuery = batchDeleteQuery.neq("import_batch_id", excludeImportBatchId);
  }

  const { error: batchError } = await batchDeleteQuery;

  if (batchError) {
    throw new Error(`Failed to clear import batches for ${monthKey}: ${batchError.message}`);
  }
}

async function insertImportBatch(params: {
  importBatchId: string;
  importType: ImportType;
  sourceFileName: string;
  monthKey: string;
}) {
  const supabase = getServiceRoleSupabaseClient();

  const { error } = await supabase.from("provider_import_batches").insert({
    import_batch_id: params.importBatchId,
    import_type: params.importType,
    source_file_name: params.sourceFileName,
    month_key: params.monthKey,
    is_linked: true,
  });

  if (error) {
    throw new Error(`Failed to save import batch: ${error.message}`);
  }
}

async function recalculatePeriodsForMonth(monthKey: string) {
  const monthlyResult = await calculateProviderMonthlyMetrics({ monthKey });

  const yearKey = getYearPeriodFromIsoDate(`${monthKey}-01`).periodKey;
  const yearlyResult = await calculateProviderYearlyMetrics({ yearKey });

  const quarterKey = getAtoQuarterPeriodFromIsoDate(`${monthKey}-01`).periodKey;
  const quarterResult = await calculateProviderAtoQuarterMetrics({ quarterKey });

  return {
    monthlyResult,
    yearlyResult,
    quarterResult,
  };
}

async function getMonthsForImportedAppointments(importBatchId: string): Promise<string[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const months = new Set<string>();

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_appointments_raw")
      .select("appointment_date")
      .eq("import_batch_id", importBatchId)
      .order("appointment_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to detect appointment months: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ appointment_date: string | null }>;

    for (const row of rows) {
      if (row.appointment_date) {
        months.add(row.appointment_date.slice(0, 7));
      }
    }

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return Array.from(months).sort();
}

async function getMonthsForImportedCancellations(importBatchId: string): Promise<string[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const months = new Set<string>();

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_cancellations_ftas_raw")
      .select("event_date")
      .eq("import_batch_id", importBatchId)
      .order("event_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to detect cancellations months: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ event_date: string | null }>;

    for (const row of rows) {
      if (row.event_date) {
        months.add(row.event_date.slice(0, 7));
      }
    }

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return Array.from(months).sort();
}


async function getMonthsForImportedNewPatients(importBatchId: string): Promise<string[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const months = new Set<string>();

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_new_patients_raw")
      .select("joined_date")
      .eq("import_batch_id", importBatchId)
      .order("joined_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to detect new patient months: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{ joined_date: string | null }>;

    for (const row of rows) {
      if (row.joined_date) {
        months.add(row.joined_date.slice(0, 7));
      }
    }

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return Array.from(months).sort();
}

async function getDetectedMonthsForImport(params: {
  importType: ImportType;
  importBatchId: string;
  selectedMonthKey: string;
}): Promise<string[]> {
  if (params.importType === "appointments") {
    return getMonthsForImportedAppointments(params.importBatchId);
  }

  if (params.importType === "cancellations") {
    return getMonthsForImportedCancellations(params.importBatchId);
  }

  if (params.importType === "new_patients") {
    return getMonthsForImportedNewPatients(params.importBatchId);
  }

  return [params.selectedMonthKey];
}

function getImportTypeLabel(importType: ImportType): string {
  if (importType === "appointments") return "Appointments";
  if (importType === "performance") return "Performance";
  if (importType === "cancellations") return "Cancellations";
  return "New Patients";
}

export async function runProviderImports(
  _prevState: RunProviderImportsState,
  formData: FormData
): Promise<RunProviderImportsState> {
  const file = formData.get("file");
  const importType = String(formData.get("importType") ?? "").trim() as ImportType;
  const selectedMonthKey = String(formData.get("monthKey") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "Please upload a CSV file.",
    };
  }

  if (
    importType !== "appointments" &&
    importType !== "performance" &&
    importType !== "cancellations" &&
    importType !== "new_patients"
  ) {
    return {
      ok: false,
      message: "Invalid import type.",
    };
  }

  if (importType === "performance" && (!selectedMonthKey || !isValidMonthKey(selectedMonthKey))) {
    return {
      ok: false,
      message: "Please select a valid month for the performance upload.",
    };
  }

  let tempPath = "";

  try {
    const saved = await saveUploadedFileToTemp(file, importType);
    tempPath = saved.tempFilePath;

    let importResult:
      | Awaited<ReturnType<typeof importProviderAppointmentsCsv>>
      | Awaited<ReturnType<typeof importProviderPerformanceCsv>>
      | Awaited<ReturnType<typeof importProviderCancellationsFtasCsv>>
      | Awaited<ReturnType<typeof importProviderNewPatientsCsv>>;

    if (importType === "appointments") {
      importResult = await importProviderAppointmentsCsv({
        filePath: tempPath,
        sourceFileName: saved.originalFileName,
      });
    } else if (importType === "performance") {
      await deleteAllDataForMonth(importType, selectedMonthKey);

      importResult = await importProviderPerformanceCsv({
        filePath: tempPath,
        sourceFileName: saved.originalFileName,
        periodStart: convertIsoToDdMmYyyy(getMonthStartIso(selectedMonthKey)),
        periodEnd: convertIsoToDdMmYyyy(getMonthEndIso(selectedMonthKey)),
      });
    } else if (importType === "new_patients") {
      importResult = await importProviderNewPatientsCsv({
        filePath: tempPath,
        sourceFileName: saved.originalFileName,
      });
    } else {
      importResult = await importProviderCancellationsFtasCsv({
        filePath: tempPath,
        sourceFileName: saved.originalFileName,
      });
    }

    const detectedMonths = await getDetectedMonthsForImport({
      importType,
      importBatchId: importResult.importBatchId,
      selectedMonthKey,
    });

    if (detectedMonths.length === 0) {
      return {
        ok: false,
        message:
          "The file was imported, but no dates could be detected from the uploaded rows. Please check the CSV date columns.",
      };
    }

    if (importType === "appointments" || importType === "cancellations" || importType === "new_patients") {
      for (const monthKey of detectedMonths) {
        await deleteAllDataForMonth(importType, monthKey, importResult.importBatchId);
      }
    }

    for (const monthKey of detectedMonths) {
      await insertImportBatch({
        importBatchId: importResult.importBatchId,
        importType,
        sourceFileName: importResult.sourceFileName,
        monthKey,
      });
    }

    const recalculatedResults = [];

    for (const monthKey of detectedMonths) {
      const recalculated = await recalculatePeriodsForMonth(monthKey);
      recalculatedResults.push({
        monthKey,
        recalculated,
      });
    }

    return {
      ok: true,
      message: [
        `${getImportTypeLabel(importType)} import completed successfully.`,
        importType === "performance"
          ? `Import month: ${selectedMonthKey}.`
          : `Detected month(s): ${detectedMonths.join(", ")}.`,
        importType === "performance"
          ? `Replaced existing ${importType} data for ${formatMonthLabel(selectedMonthKey)}.`
          : `Replaced existing ${importType} data for detected month(s).`,
        `Rows imported: ${importResult.insertedCount}.`,
        `Months recalculated: ${recalculatedResults
          .map((item) => item.monthKey)
          .join(", ")}.`,
        `Unmatched provider names: ${importResult.unmatchedProviders.length}.`,
      ].join("\n"),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Import failed:\n${error.message}`
          : "Import failed:\nUnknown error while importing provider CSV file.",
    };
  } finally {
    if (tempPath) {
      await fs.rm(tempPath, { force: true });
    }
  }
} 