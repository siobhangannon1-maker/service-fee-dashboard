import { createClient } from "@supabase/supabase-js";

type MonthlyMetricRow = {
  provider_id: string;
  period_type: "month";
  period_key: string;
  period_start: string;
  period_end: string;

  total_appointments: number;

  cancel_no_rebook_count: number;
  cancel_no_rebook_pct: number;

  fta_count: number;
  fta_pct: number;

  consult_completed_count: number;
  consult_not_rebooked_count: number;
  consult_rebooked_count: number;
  consult_rebooking_rate: number;

  gap_hours: number;
  gap_pct: number;

  production_total: number;
  hours_appointed: number;
  hours_billed: number;
  production_per_hour_appointed: number;
  production_per_hour_billed: number;
};

type ProviderPeriodMetricsUpsert = {
  provider_id: string;
  period_type: "year";
  period_key: string;
  period_start: string;
  period_end: string;

  total_appointments: number;

  cancel_no_rebook_count: number;
  cancel_no_rebook_pct: number;

  fta_count: number;
  fta_pct: number;

  consult_completed_count: number;
  consult_not_rebooked_count: number;
  consult_rebooked_count: number;
  consult_rebooking_rate: number;

  gap_hours: number;
  gap_pct: number;

  production_total: number;
  hours_appointed: number;
  hours_billed: number;
  production_per_hour_appointed: number;
  production_per_hour_billed: number;

  calculated_at: string;
};

type CalculateProviderYearlyMetricsParams = {
  yearKey: string;
};

type CalculateProviderYearlyMetricsResult = {
  yearKey: string;
  providersCalculated: number;
};

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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function getYearRangeFromYearKey(yearKey: string): { start: string; end: string } {
  const match = yearKey.match(/^(\d{4})$/);

  if (!match) {
    throw new Error(`Invalid year key: "${yearKey}". Expected YYYY`);
  }

  const year = Number(match[1]);

  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function aggregateRows(
  rows: MonthlyMetricRow[]
): Omit<
  ProviderPeriodMetricsUpsert,
  "provider_id" | "period_type" | "period_key" | "period_start" | "period_end" | "calculated_at"
> {
  const totalAppointments = rows.reduce((sum, row) => sum + Number(row.total_appointments || 0), 0);

  const cancelNoRebookCount = rows.reduce(
    (sum, row) => sum + Number(row.cancel_no_rebook_count || 0),
    0
  );

  const ftaCount = rows.reduce((sum, row) => sum + Number(row.fta_count || 0), 0);

  const consultCompletedCount = rows.reduce(
    (sum, row) => sum + Number(row.consult_completed_count || 0),
    0
  );

  const consultNotRebookedCount = rows.reduce(
    (sum, row) => sum + Number(row.consult_not_rebooked_count || 0),
    0
  );

  const consultRebookedCount = rows.reduce(
    (sum, row) => sum + Number(row.consult_rebooked_count || 0),
    0
  );

  const gapHours = rows.reduce((sum, row) => sum + Number(row.gap_hours || 0), 0);

  const productionTotal = rows.reduce((sum, row) => sum + Number(row.production_total || 0), 0);
  const hoursAppointed = rows.reduce((sum, row) => sum + Number(row.hours_appointed || 0), 0);
  const hoursBilled = rows.reduce((sum, row) => sum + Number(row.hours_billed || 0), 0);

  const hoursScheduled = gapHours + hoursBilled;

  return {
    total_appointments: totalAppointments,

    cancel_no_rebook_count: cancelNoRebookCount,
    cancel_no_rebook_pct: round4(safeDivide(cancelNoRebookCount, totalAppointments)),

    fta_count: ftaCount,
    fta_pct: round4(safeDivide(ftaCount, totalAppointments)),

    consult_completed_count: consultCompletedCount,
    consult_not_rebooked_count: consultNotRebookedCount,
    consult_rebooked_count: consultRebookedCount,
    consult_rebooking_rate: round4(safeDivide(consultRebookedCount, consultCompletedCount)),

    gap_hours: round2(gapHours),
    gap_pct: round4(safeDivide(gapHours, hoursScheduled)),

    production_total: round2(productionTotal),
    hours_appointed: round2(hoursAppointed),
    hours_billed: round2(hoursBilled),
    production_per_hour_appointed: round2(safeDivide(productionTotal, hoursAppointed)),
    production_per_hour_billed: round2(safeDivide(productionTotal, hoursBilled)),
  };
}

export async function calculateProviderYearlyMetrics(
  params: CalculateProviderYearlyMetricsParams
): Promise<CalculateProviderYearlyMetricsResult> {
  const supabase = getServiceRoleSupabaseClient();
  const yearRange = getYearRangeFromYearKey(params.yearKey);

  const { data, error } = await supabase
    .from("provider_period_metrics")
    .select(
      `
      provider_id,
      period_type,
      period_key,
      period_start,
      period_end,
      total_appointments,
      cancel_no_rebook_count,
      cancel_no_rebook_pct,
      fta_count,
      fta_pct,
      consult_completed_count,
      consult_not_rebooked_count,
      consult_rebooked_count,
      consult_rebooking_rate,
      gap_hours,
      gap_pct,
      production_total,
      hours_appointed,
      hours_billed,
      production_per_hour_appointed,
      production_per_hour_billed
      `
    )
    .eq("period_type", "month")
    .gte("period_start", yearRange.start)
    .lte("period_end", yearRange.end);

  if (error) {
    throw new Error(`Failed to load monthly provider metrics: ${error.message}`);
  }

  const monthlyRows = (data ?? []) as MonthlyMetricRow[];

  const rowsByProvider = new Map<string, MonthlyMetricRow[]>();

  for (const row of monthlyRows) {
    const existing = rowsByProvider.get(row.provider_id) ?? [];
    existing.push(row);
    rowsByProvider.set(row.provider_id, existing);
  }

  const upserts: ProviderPeriodMetricsUpsert[] = [];

  for (const [providerId, rows] of rowsByProvider.entries()) {
    const aggregated = aggregateRows(rows);

    upserts.push({
      provider_id: providerId,
      period_type: "year",
      period_key: params.yearKey,
      period_start: yearRange.start,
      period_end: yearRange.end,
      ...aggregated,
      calculated_at: new Date().toISOString(),
    });
  }

  const chunks = chunkArray(upserts, 200);

  for (const chunk of chunks) {
    const { error: upsertError } = await supabase.from("provider_period_metrics").upsert(chunk, {
      onConflict: "provider_id,period_type,period_key",
    });

    if (upsertError) {
      throw new Error(`Failed to upsert yearly provider metrics: ${upsertError.message}`);
    }
  }

  return {
    yearKey: params.yearKey,
    providersCalculated: upserts.length,
  };
}