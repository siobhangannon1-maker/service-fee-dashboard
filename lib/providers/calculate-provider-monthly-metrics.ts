import { createClient } from "@supabase/supabase-js";
import { isConsultationTreatmentType } from "./consultation-treatment-types";
import { getMonthPeriodFromIsoDate } from "./provider-periods";

type AppointmentRow = {
  id: string;
  provider_id: string | null;
  appointment_date: string;
  treatment_type: string | null;
  has_following_appointment: boolean;
  appointment_status: string | null;
};

type PerformanceRow = {
  id: string;
  provider_id: string | null;
  period_start: string;
  period_end: string;
  revenue: number;
  hours_scheduled: number;
  hours_appointed: number;
  hours_billed: number;
};

type CancellationFtaRow = {
  id: string;
  provider_id: string | null;
  event_date: string;
  status_raw: string | null;
  next_appointment_raw: string | null;
  has_next_appointment: boolean;
  is_fta: boolean;
  is_cancellation: boolean;
};

type ProviderPeriodMetricsUpsert = {
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

  calculated_at: string;
};

type CalculateProviderMonthlyMetricsParams = {
  monthKey: string;
};

type ProviderDebugSummary = {
  providerId: string;
  appointmentRows: number;
  completedAppointmentRows: number;
  cancellationRows: number;
  performanceRows: number;
  willUpsert: boolean;
};

type CalculateProviderMonthlyMetricsResult = {
  monthKey: string;
  providersCalculated: number;
  debug: {
    monthRange: {
      start: string;
      end: string;
    };
    appointmentRowsLoaded: number;
    cancellationRowsLoaded: number;
    performanceRowsLoaded: number;
    allProviderIds: string[];
    providerSummaries: ProviderDebugSummary[];
  };
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

function getMonthRangeFromMonthKey(monthKey: string): { start: string; end: string } {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid month key: "${monthKey}". Expected YYYY-MM`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);

  const pad2 = (value: number) => String(value).padStart(2, "0");

  return {
    start: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`,
    end: `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`,
  };
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isBlank(value: string | null | undefined): boolean {
  return normalizeText(value) === "";
}

function isCompletedAppointment(row: Pick<AppointmentRow, "appointment_status">): boolean {
  return !isBlank(row.appointment_status);
}

function isFtaRow(row: CancellationFtaRow): boolean {
  if (row.is_fta) return true;
  return normalizeText(row.status_raw) === "fta";
}

function isCancellationNoRebookRow(row: CancellationFtaRow): boolean {
  const statusIsCancelled =
    row.is_cancellation || normalizeText(row.status_raw) === "cancelled";

  return statusIsCancelled && (isBlank(row.next_appointment_raw) || !row.has_next_appointment);
}

function calculateConsultMetrics(appointments: AppointmentRow[]) {
  const consultAppointments = appointments.filter((row) =>
    isConsultationTreatmentType(row.treatment_type)
  );

  const consultCompletedCount = consultAppointments.length;
  const consultRebookedCount = consultAppointments.filter(
    (row) => row.has_following_appointment
  ).length;
  const consultNotRebookedCount = consultAppointments.filter(
    (row) => !row.has_following_appointment
  ).length;

  return {
    consultCompletedCount,
    consultRebookedCount,
    consultNotRebookedCount,
    consultRebookingRate: round4(safeDivide(consultRebookedCount, consultCompletedCount)),
  };
}

function calculateFinancialMetrics(performanceRows: PerformanceRow[]) {
  const productionTotal = performanceRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const hoursScheduled = performanceRows.reduce(
    (sum, row) => sum + Number(row.hours_scheduled || 0),
    0
  );
  const hoursAppointed = performanceRows.reduce(
    (sum, row) => sum + Number(row.hours_appointed || 0),
    0
  );
  const hoursBilled = performanceRows.reduce((sum, row) => sum + Number(row.hours_billed || 0), 0);

  const gapHours = Math.max(0, hoursScheduled - hoursBilled);

  return {
    productionTotal: round2(productionTotal),
    hoursScheduled: round2(hoursScheduled),
    hoursAppointed: round2(hoursAppointed),
    hoursBilled: round2(hoursBilled),
    gapHours: round2(gapHours),
    gapPct: round4(safeDivide(gapHours, hoursScheduled)),
    productionPerHourAppointed: round2(safeDivide(productionTotal, hoursAppointed)),
    productionPerHourBilled: round2(safeDivide(productionTotal, hoursBilled)),
  };
}

async function fetchAllAppointmentsForMonth(
  monthRange: { start: string; end: string }
): Promise<AppointmentRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const allRows: AppointmentRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_appointments_raw")
      .select(
        `
        id,
        provider_id,
        appointment_date,
        treatment_type,
        has_following_appointment,
        appointment_status
        `
      )
      .not("provider_id", "is", null)
      .gte("appointment_date", monthRange.start)
      .lte("appointment_date", monthRange.end)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load appointment rows: ${error.message}`);
    }

    const rows = (data ?? []) as AppointmentRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allRows;
}

async function fetchAllCancellationsForMonth(
  monthRange: { start: string; end: string }
): Promise<CancellationFtaRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const allRows: CancellationFtaRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_cancellations_ftas_raw")
      .select(
        `
        id,
        provider_id,
        event_date,
        status_raw,
        next_appointment_raw,
        has_next_appointment,
        is_fta,
        is_cancellation
        `
      )
      .not("provider_id", "is", null)
      .gte("event_date", monthRange.start)
      .lte("event_date", monthRange.end)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load cancellations/FTAs rows: ${error.message}`);
    }

    const rows = (data ?? []) as CancellationFtaRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allRows;
}

async function fetchAllPerformanceForMonth(
  monthRange: { start: string; end: string }
): Promise<PerformanceRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const allRows: PerformanceRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_performance_raw")
      .select(
        "id, provider_id, period_start, period_end, revenue, hours_scheduled, hours_appointed, hours_billed"
      )
      .eq("period_start", monthRange.start)
      .eq("period_end", monthRange.end)
      .not("provider_id", "is", null)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load performance rows: ${error.message}`);
    }

    const rows = (data ?? []) as PerformanceRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allRows;
}

export async function calculateProviderMonthlyMetrics(
  params: CalculateProviderMonthlyMetricsParams
): Promise<CalculateProviderMonthlyMetricsResult> {
  const supabase = getServiceRoleSupabaseClient();
  const monthRange = getMonthRangeFromMonthKey(params.monthKey);

  const appointments = await fetchAllAppointmentsForMonth(monthRange);
  const cancellations = await fetchAllCancellationsForMonth(monthRange);
  const performanceRows = await fetchAllPerformanceForMonth(monthRange);

  const allProviderIds = Array.from(
    new Set(
      [
        ...appointments.map((row) => row.provider_id),
        ...cancellations.map((row) => row.provider_id),
        ...performanceRows.map((row) => row.provider_id),
      ].filter((value): value is string => Boolean(value))
    )
  ).sort();

  const upserts: ProviderPeriodMetricsUpsert[] = [];
  const providerSummaries: ProviderDebugSummary[] = [];

  for (const providerId of allProviderIds) {
    const providerAppointments = appointments.filter((row) => row.provider_id === providerId);
    const providerCompletedAppointments = providerAppointments.filter(isCompletedAppointment);
    const providerCancellations = cancellations.filter((row) => row.provider_id === providerId);
    const providerPerformanceRows = performanceRows.filter((row) => row.provider_id === providerId);

    const consult = calculateConsultMetrics(providerCompletedAppointments);
    const financial = calculateFinancialMetrics(providerPerformanceRows);
    const period = getMonthPeriodFromIsoDate(monthRange.start);

    const totalAppointments = providerCompletedAppointments.length;
    const cancelNoRebookCount = providerCancellations.filter(isCancellationNoRebookRow).length;
    const ftaCount = providerCancellations.filter(isFtaRow).length;

    providerSummaries.push({
      providerId,
      appointmentRows: providerAppointments.length,
      completedAppointmentRows: providerCompletedAppointments.length,
      cancellationRows: providerCancellations.length,
      performanceRows: providerPerformanceRows.length,
      willUpsert: true,
    });

    upserts.push({
      provider_id: providerId,
      period_type: "month",
      period_key: period.periodKey,
      period_start: period.periodStart,
      period_end: period.periodEnd,

      total_appointments: totalAppointments,

      cancel_no_rebook_count: cancelNoRebookCount,
      cancel_no_rebook_pct: round4(safeDivide(cancelNoRebookCount, totalAppointments)),

      fta_count: ftaCount,
      fta_pct: round4(safeDivide(ftaCount, totalAppointments)),

      consult_completed_count: consult.consultCompletedCount,
      consult_not_rebooked_count: consult.consultNotRebookedCount,
      consult_rebooked_count: consult.consultRebookedCount,
      consult_rebooking_rate: consult.consultRebookingRate,
      gap_hours: financial.gapHours,
      gap_pct: financial.gapPct,

      production_total: financial.productionTotal,
      hours_appointed: financial.hoursAppointed,
      hours_billed: financial.hoursBilled,
      production_per_hour_appointed: financial.productionPerHourAppointed,
      production_per_hour_billed: financial.productionPerHourBilled,

      calculated_at: new Date().toISOString(),
    });
  }

  const chunks = chunkArray(upserts, 200);

  for (const chunk of chunks) {
    const { error } = await supabase.from("provider_period_metrics").upsert(chunk, {
      onConflict: "provider_id,period_type,period_key",
    });

    if (error) {
      throw new Error(`Failed to upsert provider monthly metrics: ${error.message}`);
    }
  }

  return {
    monthKey: params.monthKey,
    providersCalculated: upserts.length,
    debug: {
      monthRange,
      appointmentRowsLoaded: appointments.length,
      cancellationRowsLoaded: cancellations.length,
      performanceRowsLoaded: performanceRows.length,
      allProviderIds,
      providerSummaries,
    },
  };
}