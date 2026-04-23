"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { importProviderAppointmentsCsv } from "@/lib/providers/import-provider-appointments-csv";
import { importProviderPerformanceCsv } from "@/lib/providers/import-provider-performance-csv";
import { importProviderCancellationsFtasCsv } from "@/lib/providers/import-provider-cancellations-ftas-csv";
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

type ImportType = "appointments" | "performance" | "cancellations";

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

  const tempDir = path.join(process.cwd(), ".tmp", "provider-imports");
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

async function deleteAllDataForMonth(importType: ImportType, monthKey: string) {
  const supabase = getServiceRoleSupabaseClient();
  const monthStart = getMonthStartIso(monthKey);
  const monthEnd = getMonthEndIso(monthKey);

  if (importType === "appointments") {
    const { error } = await supabase
      .from("provider_appointments_raw")
      .delete()
      .gte("appointment_date", monthStart)
      .lte("appointment_date", monthEnd);

    if (error) {
      throw new Error(`Failed to clear appointments raw rows for ${monthKey}: ${error.message}`);
    }
  }

  if (importType === "performance") {
    const { error } = await supabase
      .from("provider_performance_raw")
      .delete()
      .eq("period_start", monthStart)
      .eq("period_end", monthEnd);

    if (error) {
      throw new Error(`Failed to clear performance raw rows for ${monthKey}: ${error.message}`);
    }
  }

  if (importType === "cancellations") {
    const { error } = await supabase
      .from("provider_cancellations_ftas_raw")
      .delete()
      .gte("event_date", monthStart)
      .lte("event_date", monthEnd);

    if (error) {
      throw new Error(`Failed to clear cancellations raw rows for ${monthKey}: ${error.message}`);
    }
  }

  const { error: batchError } = await supabase
    .from("provider_import_batches")
    .delete()
    .eq("import_type", importType)
    .eq("month_key", monthKey);

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

export async function runProviderImports(
  _prevState: RunProviderImportsState,
  formData: FormData
): Promise<RunProviderImportsState> {
  const file = formData.get("file");
  const importType = String(formData.get("importType") ?? "").trim() as ImportType;
  const monthKey = String(formData.get("monthKey") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      message: "Please upload a CSV file.",
    };
  }

  if (
    importType !== "appointments" &&
    importType !== "performance" &&
    importType !== "cancellations"
  ) {
    return {
      ok: false,
      message: "Invalid import type.",
    };
  }

  if (!monthKey || !isValidMonthKey(monthKey)) {
    return {
      ok: false,
      message: "Please select a valid month.",
    };
  }

  let tempPath = "";

  try {
    await deleteAllDataForMonth(importType, monthKey);

    const saved = await saveUploadedFileToTemp(file, importType);
    tempPath = saved.tempFilePath;

    let importResult:
      | Awaited<ReturnType<typeof importProviderAppointmentsCsv>>
      | Awaited<ReturnType<typeof importProviderPerformanceCsv>>
      | Awaited<ReturnType<typeof importProviderCancellationsFtasCsv>>;

    if (importType === "appointments") {
      importResult = await importProviderAppointmentsCsv({
        filePath: tempPath,
        sourceFileName: saved.originalFileName,
      });
    } else if (importType === "performance") {
      importResult = await importProviderPerformanceCsv({
        filePath: tempPath,
        sourceFileName: saved.originalFileName,
        periodStart: convertIsoToDdMmYyyy(getMonthStartIso(monthKey)),
        periodEnd: convertIsoToDdMmYyyy(getMonthEndIso(monthKey)),
      });
    } else {
      importResult = await importProviderCancellationsFtasCsv({
        filePath: tempPath,
        sourceFileName: saved.originalFileName,
      });
    }

    await insertImportBatch({
      importBatchId: importResult.importBatchId,
      importType,
      sourceFileName: importResult.sourceFileName,
      monthKey,
    });

    const recalculated = await recalculatePeriodsForMonth(monthKey);

    return {
      ok: true,
      message: [
        `${importType === "appointments"
          ? "Appointments"
          : importType === "performance"
          ? "Performance"
          : "Cancellations"} import completed successfully.`,
        `Import month: ${monthKey}.`,
        `Replaced existing ${importType} data for ${formatMonthLabel(monthKey)}.`,
        `Rows imported: ${importResult.insertedCount}.`,
        `Providers calculated for month ${recalculated.monthlyResult.monthKey}: ${recalculated.monthlyResult.providersCalculated}.`,
        `Providers calculated for year ${recalculated.yearlyResult.yearKey}: ${recalculated.yearlyResult.providersCalculated}.`,
        `Providers calculated for ATO quarter ${recalculated.quarterResult.quarterKey}: ${recalculated.quarterResult.providersCalculated}.`,
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