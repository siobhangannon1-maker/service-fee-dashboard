import { createClient } from "@supabase/supabase-js";

export type WeeklyCancellationFtaKpiRow = {
  weekStart: string;
  weekEnd: string;
  totalAppointments: number;
  ftaCount: number;
  ftaPct: number;
  cancelNoRebookCount: number;
  cancelNoRebookPct: number;
};

type CancellationFtaRow = {
  event_date: string;
  event_time: string | null;
  patient_name_raw: string | null;
  provider_name_raw: string | null;
  treatment_type: string | null;
  status_raw: string | null;
  next_appointment_raw: string | null;
  has_next_appointment: boolean | null;
  is_fta: boolean | null;
  is_cancellation: boolean | null;
  is_fta_no_rebooking: boolean | null;
  is_cancellation_no_rebooking: boolean | null;
};

type AppointmentRow = {
  appointment_date: string;
  appointment_start: string | null;
  appointment_end: string | null;
  patient_name_raw: string | null;
  provider_name_raw: string | null;
  treatment_type: string | null;
  appointment_status: string | null;
  arrival_status: string | null;
};

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function isCompletedAppointment(row: Pick<AppointmentRow, "arrival_status">): boolean {
  return normalizeText(row.arrival_status) !== "";
}

function getCancellationRowKey(row: CancellationFtaRow): string {
  return [
    row.event_date,
    normalizeText(row.event_time),
    normalizeText(row.patient_name_raw),
    normalizeText(row.provider_name_raw),
    normalizeText(row.treatment_type),
    normalizeText(row.status_raw),
    normalizeText(row.next_appointment_raw),
  ].join("|");
}

function dedupeCancellationRows(rows: CancellationFtaRow[]): CancellationFtaRow[] {
  const uniqueMap = new Map<string, CancellationFtaRow>();

  for (const row of rows) {
    const key = getCancellationRowKey(row);

    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, row);
    }
  }

  return Array.from(uniqueMap.values());
}

function getAppointmentRowKey(row: AppointmentRow): string {
  return [
    row.appointment_date,
    normalizeText(row.appointment_start),
    normalizeText(row.appointment_end),
    normalizeText(row.patient_name_raw),
    normalizeText(row.provider_name_raw),
    normalizeText(row.treatment_type),
    normalizeText(row.appointment_status),
    normalizeText(row.arrival_status),
  ].join("|");
}

function dedupeAppointmentRows(rows: AppointmentRow[]): AppointmentRow[] {
  const uniqueMap = new Map<string, AppointmentRow>();

  for (const row of rows) {
    const key = getAppointmentRowKey(row);

    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, row);
    }
  }

  return Array.from(uniqueMap.values());
}

async function fetchAllAppointmentRows(
  overallStart: string,
  overallEnd: string
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
        appointment_date,
        appointment_start,
        appointment_end,
        patient_name_raw,
        provider_name_raw,
        treatment_type,
        appointment_status,
        arrival_status
        `
      )
      .gte("appointment_date", overallStart)
      .lte("appointment_date", overallEnd)
      .order("appointment_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load weekly appointment denominators: ${error.message}`);
    }

    const rows = (data ?? []) as AppointmentRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

async function fetchAllCancellationRows(
  overallStart: string,
  overallEnd: string
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
        event_date,
        event_time,
        patient_name_raw,
        provider_name_raw,
        treatment_type,
        status_raw,
        next_appointment_raw,
        has_next_appointment,
        is_fta,
        is_cancellation,
        is_fta_no_rebooking,
        is_cancellation_no_rebooking
        `
      )
      .gte("event_date", overallStart)
      .lte("event_date", overallEnd)
      .order("event_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load weekly cancellations/FTAs KPIs: ${error.message}`);
    }

    const rows = (data ?? []) as CancellationFtaRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

export async function getWeeklyCancellationFtaKpis(
  weeks: Array<{ weekStart: string; weekEnd: string }>
): Promise<WeeklyCancellationFtaKpiRow[]> {
  if (weeks.length === 0) return [];

  const overallStart = weeks[0].weekStart;
  const overallEnd = weeks[weeks.length - 1].weekEnd;

  const [allCancellationRowsRaw, allAppointmentRowsRaw] = await Promise.all([
    fetchAllCancellationRows(overallStart, overallEnd),
    fetchAllAppointmentRows(overallStart, overallEnd),
  ]);

  const allCancellationRows = dedupeCancellationRows(allCancellationRowsRaw);
  const allAppointmentRows = dedupeAppointmentRows(allAppointmentRowsRaw);

  return weeks.map((week) => {
    const appointmentRowsForWeek = allAppointmentRows.filter(
      (row) => row.appointment_date >= week.weekStart && row.appointment_date <= week.weekEnd
    );

    const cancellationRowsForWeek = allCancellationRows.filter(
      (row) => row.event_date >= week.weekStart && row.event_date <= week.weekEnd
    );

    const completedAppointments = appointmentRowsForWeek.filter(isCompletedAppointment).length;

    const ftaCount = cancellationRowsForWeek.filter((row) => row.is_fta === true).length;

    const cancelNoRebookCount = cancellationRowsForWeek.filter(
      (row) => row.is_cancellation_no_rebooking === true
    ).length;

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      totalAppointments: completedAppointments,
      ftaCount,
      ftaPct: round4(safeDivide(ftaCount, completedAppointments)),
      cancelNoRebookCount,
      cancelNoRebookPct: round4(safeDivide(cancelNoRebookCount, completedAppointments)),
    };
  });
}
