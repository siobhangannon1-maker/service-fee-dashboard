"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import {
  getAtoQuarterPeriodFromIsoDate,
  getYearPeriodFromIsoDate,
} from "@/lib/providers/provider-periods";
import { calculateProviderMonthlyMetrics } from "@/lib/providers/calculate-provider-monthly-metrics";
import { calculateProviderYearlyMetrics } from "@/lib/providers/calculate-provider-yearly-metrics";
import { calculateProviderAtoQuarterMetrics } from "@/lib/providers/calculate-provider-ato-quarter-metrics";

type ImportType = "appointments" | "performance" | "cancellations";

function getClient() {
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

async function clearMetricsForMonth(monthKey: string) {
  const supabase = getClient();

  const yearKey = getYearPeriodFromIsoDate(getMonthStartIso(monthKey)).periodKey;
  const quarterKey = getAtoQuarterPeriodFromIsoDate(getMonthStartIso(monthKey)).periodKey;

  const { error } = await supabase
    .from("provider_period_metrics")
    .delete()
    .or(
      [
        `and(period_type.eq.month,period_key.eq.${monthKey})`,
        `and(period_type.eq.year,period_key.eq.${yearKey})`,
        `and(period_type.eq.quarter_ato,period_key.eq.${quarterKey})`,
      ].join(",")
    );

  if (error) {
    throw new Error(`Failed to clear provider metrics: ${error.message}`);
  }
}

async function monthStillHasAppointments(monthKey: string): Promise<boolean> {
  const supabase = getClient();
  const monthStart = getMonthStartIso(monthKey);
  const monthEnd = getMonthEndIso(monthKey);

  const { count, error } = await supabase
    .from("provider_appointments_raw")
    .select("*", { count: "exact", head: true })
    .gte("appointment_date", monthStart)
    .lte("appointment_date", monthEnd);

  if (error) {
    throw new Error(`Failed checking remaining appointment rows: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

async function monthStillHasPerformance(monthKey: string): Promise<boolean> {
  const supabase = getClient();
  const monthStart = getMonthStartIso(monthKey);
  const monthEnd = getMonthEndIso(monthKey);

  const { count, error } = await supabase
    .from("provider_performance_raw")
    .select("*", { count: "exact", head: true })
    .eq("period_start", monthStart)
    .eq("period_end", monthEnd);

  if (error) {
    throw new Error(`Failed checking remaining performance rows: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

async function monthStillHasCancellations(monthKey: string): Promise<boolean> {
  const supabase = getClient();
  const monthStart = getMonthStartIso(monthKey);
  const monthEnd = getMonthEndIso(monthKey);

  const { count, error } = await supabase
    .from("provider_cancellations_ftas_raw")
    .select("*", { count: "exact", head: true })
    .gte("event_date", monthStart)
    .lte("event_date", monthEnd);

  if (error) {
    throw new Error(`Failed checking remaining cancellations rows: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

export async function deleteImportBatch(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "").trim();
  const importType = String(formData.get("importType") ?? "").trim() as ImportType;

  if (!batchId) {
    throw new Error("Missing batchId");
  }

  if (
    importType !== "appointments" &&
    importType !== "performance" &&
    importType !== "cancellations"
  ) {
    throw new Error("Invalid importType");
  }

  const supabase = getClient();

  const { data: batch, error: batchLookupError } = await supabase
    .from("provider_import_batches")
    .select("import_batch_id, import_type, month_key")
    .eq("import_batch_id", batchId)
    .maybeSingle();

  if (batchLookupError) {
    throw new Error(`Failed to load batch record: ${batchLookupError.message}`);
  }

  if (!batch) {
    throw new Error("Import batch not found.");
  }

  const monthKey = String(batch.month_key ?? "").trim();

  if (!monthKey) {
    throw new Error("Batch month_key is missing.");
  }

  if (importType === "appointments") {
    const { error } = await supabase
      .from("provider_appointments_raw")
      .delete()
      .eq("import_batch_id", batchId);

    if (error) {
      throw new Error(`Failed to delete appointment rows: ${error.message}`);
    }
  }

  if (importType === "performance") {
    const { error } = await supabase
      .from("provider_performance_raw")
      .delete()
      .eq("import_batch_id", batchId);

    if (error) {
      throw new Error(`Failed to delete performance rows: ${error.message}`);
    }
  }

  if (importType === "cancellations") {
    const { error } = await supabase
      .from("provider_cancellations_ftas_raw")
      .delete()
      .eq("import_batch_id", batchId);

    if (error) {
      throw new Error(`Failed to delete cancellations rows: ${error.message}`);
    }
  }

  const { error: batchDeleteError } = await supabase
    .from("provider_import_batches")
    .delete()
    .eq("import_batch_id", batchId);

  if (batchDeleteError) {
    throw new Error(`Failed to delete batch record: ${batchDeleteError.message}`);
  }

  await clearMetricsForMonth(monthKey);

  const hasAppointments = await monthStillHasAppointments(monthKey);
  const hasPerformance = await monthStillHasPerformance(monthKey);
  const hasCancellations = await monthStillHasCancellations(monthKey);

  if (hasAppointments || hasPerformance || hasCancellations) {
    await calculateProviderMonthlyMetrics({ monthKey });

    const yearKey = getYearPeriodFromIsoDate(`${monthKey}-01`).periodKey;
    await calculateProviderYearlyMetrics({ yearKey });

    const quarterKey = getAtoQuarterPeriodFromIsoDate(`${monthKey}-01`).periodKey;
    await calculateProviderAtoQuarterMetrics({ quarterKey });
  }

  revalidatePath("/admin/provider-imports");
  revalidatePath("/provider");
}