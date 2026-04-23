import { createClient } from "@supabase/supabase-js";

export type WeeklyAppointmentKpiRow = {
  weekStart: string;
  weekEnd: string;

  totalAppointments: number;

  cancelNoRebookCount: number;
  cancelNoRebookPct: number;

  ftaCount: number;
  ftaPct: number;

  gapHours: number;
  gapPct: number;
};

type AppointmentRow = {
  id: string;
  appointment_date: string;
  appointment_start: string;
  appointment_end: string;
  duration_minutes: number;
  appointment_status: string | null;
  arrival_status: string | null;
  response_status: string | null;
  is_cancelled: boolean;
  is_fta: boolean;
  has_following_appointment: boolean;
  treatment_type: string | null;
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

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isBlank(value: string | null | undefined): boolean {
  return normalizeText(value) === "";
}

function textIncludesAny(value: string | null | undefined, phrases: string[]): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;

  return phrases.some((phrase) => normalized.includes(phrase));
}

function deriveIsCancelled(
  row: Pick<AppointmentRow, "appointment_status" | "response_status" | "is_cancelled">
): boolean {
  if (
    textIncludesAny(row.appointment_status, ["cancelled", "canceled"]) ||
    textIncludesAny(row.response_status, ["cancelled", "canceled"])
  ) {
    return true;
  }

  return Boolean(row.is_cancelled);
}

function deriveIsFta(
  row: Pick<
    AppointmentRow,
    "appointment_status" | "arrival_status" | "response_status" | "is_cancelled"
  >
): boolean {
  const cancelled = deriveIsCancelled({
    appointment_status: row.appointment_status,
    response_status: row.response_status,
    is_cancelled: row.is_cancelled,
  });

  if (cancelled) return false;

  return (
    isBlank(row.appointment_status) &&
    isBlank(row.arrival_status) &&
    isBlank(row.response_status)
  );
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

function getMinutesBetween(start: Date, end: Date): number {
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

function calculateGapMetrics(appointments: AppointmentRow[]) {
  const byDay = new Map<string, AppointmentRow[]>();

  for (const appointment of appointments) {
    if (deriveIsCancelled(appointment)) continue;
    if (deriveIsFta(appointment)) continue;
    if (appointment.duration_minutes <= 0) continue;

    const dayAppointments = byDay.get(appointment.appointment_date) ?? [];
    dayAppointments.push(appointment);
    byDay.set(appointment.appointment_date, dayAppointments);
  }

  let totalGapMinutes = 0;
  let totalWindowMinutes = 0;

  for (const [, dayAppointments] of byDay.entries()) {
    const sorted = [...dayAppointments].sort((a, b) =>
      a.appointment_start.localeCompare(b.appointment_start)
    );

    if (!sorted.length) continue;

    const firstStart = new Date(sorted[0].appointment_start.replace(" ", "T"));
    const lastEnd = new Date(sorted[sorted.length - 1].appointment_end.replace(" ", "T"));

    totalWindowMinutes += getMinutesBetween(firstStart, lastEnd);

    for (let index = 0; index < sorted.length - 1; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];

      const currentEnd = new Date(current.appointment_end.replace(" ", "T"));
      const nextStart = new Date(next.appointment_start.replace(" ", "T"));

      totalGapMinutes += getMinutesBetween(currentEnd, nextStart);
    }
  }

  return {
    gapHours: round2(totalGapMinutes / 60),
    gapPct: round4(safeDivide(totalGapMinutes, totalWindowMinutes)),
  };
}

function getAppointmentKey(row: AppointmentRow): string {
  return [
    row.appointment_date,
    row.appointment_start,
    row.appointment_end,
    (row.treatment_type ?? "").trim().toLowerCase(),
  ].join("|");
}

function dedupeAppointments(rows: AppointmentRow[]): AppointmentRow[] {
  const uniqueMap = new Map<string, AppointmentRow>();

  for (const row of rows) {
    const key = getAppointmentKey(row);
    const existing = uniqueMap.get(key);

    if (!existing) {
      uniqueMap.set(key, row);
      continue;
    }

    const existingCancelled = deriveIsCancelled(existing);
    const rowCancelled = deriveIsCancelled(row);

    if (existingCancelled && !rowCancelled) {
      uniqueMap.set(key, row);
      continue;
    }

    const existingFta = deriveIsFta(existing);
    const rowFta = deriveIsFta(row);

    if (existingFta && !rowFta) {
      uniqueMap.set(key, row);
    }
  }

  return Array.from(uniqueMap.values());
}

export async function getWeeklyAppointmentKpis(
  weeks: Array<{ weekStart: string; weekEnd: string }>
): Promise<WeeklyAppointmentKpiRow[]> {
  if (weeks.length === 0) return [];

  const supabase = getServiceRoleSupabaseClient();

  const overallStart = weeks[0].weekStart;
  const overallEnd = weeks[weeks.length - 1].weekEnd;

  const { data, error } = await supabase
    .from("provider_appointments_raw")
    .select(
      `
      id,
      appointment_date,
      appointment_start,
      appointment_end,
      duration_minutes,
      appointment_status,
      arrival_status,
      response_status,
      is_cancelled,
      is_fta,
      has_following_appointment,
      treatment_type
      `
    )
    .gte("appointment_date", overallStart)
    .lte("appointment_date", overallEnd)
    .order("appointment_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to load weekly appointment KPIs: ${error.message}`);
  }

  const allRows = dedupeAppointments((data ?? []) as AppointmentRow[]);

  return weeks.map((week) => {
    const rows = allRows.filter(
      (row) => row.appointment_date >= week.weekStart && row.appointment_date <= week.weekEnd
    );

    const totalAppointments = rows.length;

    const cancelNoRebookCount = rows.filter(
      (row) => deriveIsCancelled(row) && !row.has_following_appointment
    ).length;

    const ftaCount = rows.filter((row) => deriveIsFta(row)).length;

    const completedAppointments = rows.filter((row) => {
      const cancelled = deriveIsCancelled(row);
      const fta = deriveIsFta(row);
      return !cancelled && !fta;
    });

    const gap = calculateGapMetrics(completedAppointments);

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      totalAppointments,
      cancelNoRebookCount,
      cancelNoRebookPct: round4(safeDivide(cancelNoRebookCount, totalAppointments)),
      ftaCount,
      ftaPct: round4(safeDivide(ftaCount, totalAppointments)),
      gapHours: gap.gapHours,
      gapPct: gap.gapPct,
    };
  });
}