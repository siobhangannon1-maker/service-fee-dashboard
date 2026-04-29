import SyncGoogleReviewsButton from "@/components/SyncGoogleReviewsButton";
import KpiPdfExportButtons from "@/components/KpiPdfExportButtons";
import { requireRole } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import KpiDateSelector from "@/components/KpiDateSelector";
import {
  getAtoQuarterOptions,
  getMonthOptions,
  getWeeksForPeriod,
  getYearOptions,
  type KpiView,
} from "../../../../lib/practice-manager/kpi-periods";
import { getMonthlyGapKpi } from "../../../../lib/practice-manager/get-monthly-gap-kpi";
import { getWeeklyReferralBookingKpis } from "../../../../lib/practice-manager/get-weekly-referral-booking-kpis";
import { getFortnightlyStaffingKpis } from "../../../../lib/practice-manager/get-fortnightly-staffing-kpis";
import {
  getKpiBenchmarkByKey,
  getKpiBenchmarkTone,
  getKpiToneStyles,
  type PracticeKpiBenchmark,
} from "../../../../lib/practice-manager/kpi-benchmark-utils";

type PageProps = {
  searchParams?: Promise<{
    year?: string;
    periodType?: string;
    month?: string;
    quarter?: string;
  }>;
};

type PeriodType = "month" | "quarter_ato" | "year";

type DisplayRow = {
  weekStart: string;
  weekEnd: string;
  label: string;
  newPatients: number;
  googleReviewCount: number;
  averageGoogleRating: number | null;
  referralBookingRate: number | null;
  gapPct: number | null;
  ftaPct: number;
  cancelNoRebookPct: number;
  overtimeHours: number | null;
  billingStaffingPct: number | null;
  payPeriodId: string | null;
  payPeriodWeekCount: number;
  isFirstWeekOfPayPeriod: boolean;
};

type AppointmentRawRow = {
  appointment_date: string;
  appointment_start: string | null;
  provider_name_raw: string | null;
  patient_name_raw: string | null;
  treatment_type: string | null;
  appointment_status: string | null;
  arrival_status: string | null;
};

type CancellationFtaRawRow = {
  event_date: string;
  event_time: string | null;
  provider_name_raw: string | null;
  patient_name_raw: string | null;
  treatment_type: string | null;
  status_raw: string | null;
  next_appointment_raw: string | null;
  has_next_appointment: boolean | null;
  is_fta: boolean | null;
  is_cancellation: boolean | null;
  is_fta_no_rebooking: boolean | null;
  is_cancellation_no_rebooking: boolean | null;
};

type NewPatientRawRow = {
  joined_date: string;
};

type GoogleReviewRawRow = {
  review_date: string;
  star_rating: number;
};

type WeeklyGoogleReviewRow = {
  weekStart: string;
  weekEnd: string;
  googleReviewCount: number;
  averageGoogleRating: number | null;
};

type WeeklyCancellationFtaRow = {
  weekStart: string;
  weekEnd: string;
  totalAppointments: number;
  ftaCount: number;
  ftaPct: number;
  cancelNoRebookCount: number;
  cancelNoRebookPct: number;
};

type WeeklyNewPatientCountRow = {
  weekStart: string;
  weekEnd: string;
  newPatients: number;
};

type TimePeriodOption = {
  key: string;
  label: string;
  view: KpiView;
  periodType: PeriodType;
  periodKey: string;
  sortDate: string;
};

function getServiceRoleSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey);
}

function getDefaultMonthKey(): string {
  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = previousMonth.getFullYear();
  const month = String(previousMonth.getMonth() + 1).padStart(2, "0");

  return `${year}-${month}`;
}

function getYearFromMonthKey(monthKey: string): string {
  return monthKey.slice(0, 4);
}

function getMonthFromMonthKey(monthKey: string): string {
  return monthKey.slice(5, 7);
}

function getMonthName(monthNumber: string): string {
  const month = Number(monthNumber);

  if (!month) return monthNumber;

  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
  }).format(new Date(2000, month - 1, 1));
}

function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);

  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");

  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function getReadableDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);

  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

function formatRating(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(2)} ★`;
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(2)} hrs`;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function getAppointmentDedupeKey(row: AppointmentRawRow): string {
  return [
    row.appointment_date,
    row.appointment_start ?? "",
    normalizeText(row.provider_name_raw),
    normalizeText(row.patient_name_raw),
    normalizeText(row.treatment_type),
    normalizeText(row.appointment_status),
  ].join("|");
}

function getCancellationDedupeKey(row: CancellationFtaRawRow): string {
  return [
    row.event_date,
    row.event_time ?? "",
    normalizeText(row.provider_name_raw),
    normalizeText(row.patient_name_raw),
    normalizeText(row.treatment_type),
    normalizeText(row.status_raw),
    normalizeText(row.next_appointment_raw),
  ].join("|");
}

function dedupeAppointments(rows: AppointmentRawRow[]): AppointmentRawRow[] {
  const map = new Map<string, AppointmentRawRow>();

  for (const row of rows) {
    const key = getAppointmentDedupeKey(row);

    if (!map.has(key)) {
      map.set(key, row);
    }
  }

  return Array.from(map.values());
}

function dedupeCancellationRows(
  rows: CancellationFtaRawRow[]
): CancellationFtaRawRow[] {
  const map = new Map<string, CancellationFtaRawRow>();

  for (const row of rows) {
    const key = getCancellationDedupeKey(row);

    if (!map.has(key)) {
      map.set(key, row);
    }
  }

  return Array.from(map.values());
}

async function fetchAllAppointmentRows(
  overallStart: string,
  overallEnd: string
): Promise<AppointmentRawRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const allRows: AppointmentRawRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_appointments_raw")
      .select(
        `
        appointment_date,
        appointment_start,
        provider_name_raw,
        patient_name_raw,
        treatment_type,
        appointment_status,
        arrival_status
        `
      )
      .gte("appointment_date", overallStart)
      .lte("appointment_date", overallEnd)
      .not("appointment_status", "is", null)
      .order("appointment_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Failed to load appointment rows for KPI denominator: ${error.message}`
      );
    }

    const rows = (data ?? []) as AppointmentRawRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

async function fetchAllCancellationFtaRows(
  overallStart: string,
  overallEnd: string
): Promise<CancellationFtaRawRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const allRows: CancellationFtaRawRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_cancellations_ftas_raw")
      .select(
        `
        event_date,
        event_time,
        provider_name_raw,
        patient_name_raw,
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
      throw new Error(
        `Failed to load cancellation/FTA rows for KPI dashboard: ${error.message}`
      );
    }

    const rows = (data ?? []) as CancellationFtaRawRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

async function fetchAllNewPatientUploadRows(
  overallStart: string,
  overallEnd: string
): Promise<NewPatientRawRow[]> {
  const supabase = getServiceRoleSupabaseClient();
  const pageSize = 1000;
  let from = 0;
  const allRows: NewPatientRawRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("provider_new_patients_raw")
      .select("joined_date")
      .gte("joined_date", overallStart)
      .lte("joined_date", overallEnd)
      .order("joined_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(
        `Failed to load new patient upload rows for KPI dashboard: ${error.message}`
      );
    }

    const rows = (data ?? []) as NewPatientRawRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

async function fetchAllGoogleReviewRows(
  overallStart: string,
  overallEnd: string
): Promise<GoogleReviewRawRow[]> {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("google_reviews_raw")
    .select("review_date, star_rating")
    .gte("review_date", overallStart)
    .lte("review_date", overallEnd)
    .order("review_date", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load Google reviews for KPI dashboard: ${error.message}`
    );
  }

  return (data ?? []) as GoogleReviewRawRow[];
}

async function getWeeklyNewPatientCountsDirect(
  weeks: Array<{ weekStart: string; weekEnd: string }>
): Promise<WeeklyNewPatientCountRow[]> {
  if (weeks.length === 0) return [];

  const overallStart = weeks[0].weekStart;
  const overallEnd = weeks[weeks.length - 1].weekEnd;
  const newPatientRows = await fetchAllNewPatientUploadRows(
    overallStart,
    overallEnd
  );

  return weeks.map((week) => {
    const rowsForWeek = newPatientRows.filter(
      (row) =>
        row.joined_date >= week.weekStart && row.joined_date <= week.weekEnd
    );

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      newPatients: rowsForWeek.length,
    };
  });
}

async function getWeeklyGoogleReviewKpis(
  weeks: Array<{ weekStart: string; weekEnd: string }>
): Promise<WeeklyGoogleReviewRow[]> {
  if (weeks.length === 0) return [];

  const overallStart = weeks[0].weekStart;
  const overallEnd = weeks[weeks.length - 1].weekEnd;

  const reviewRows = await fetchAllGoogleReviewRows(overallStart, overallEnd);

  return weeks.map((week) => {
    const rowsForWeek = reviewRows.filter(
      (row) =>
        row.review_date >= week.weekStart && row.review_date <= week.weekEnd
    );

    const googleReviewCount = rowsForWeek.length;

    const averageGoogleRating =
      googleReviewCount > 0
        ? Math.round(
            (rowsForWeek.reduce(
              (sum, row) => sum + Number(row.star_rating || 0),
              0
            ) /
              googleReviewCount) *
              100
          ) / 100
        : null;

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      googleReviewCount,
      averageGoogleRating,
    };
  });
}

async function getWeeklyCancellationFtaKpisDirect(
  weeks: Array<{ weekStart: string; weekEnd: string }>
): Promise<WeeklyCancellationFtaRow[]> {
  if (weeks.length === 0) return [];

  const overallStart = weeks[0].weekStart;
  const overallEnd = weeks[weeks.length - 1].weekEnd;

  const [appointmentRowsRaw, cancellationRowsRaw] = await Promise.all([
    fetchAllAppointmentRows(overallStart, overallEnd),
    fetchAllCancellationFtaRows(overallStart, overallEnd),
  ]);

  const appointmentRows = dedupeAppointments(appointmentRowsRaw);
  const cancellationRows = dedupeCancellationRows(cancellationRowsRaw);

  return weeks.map((week) => {
    const appointmentRowsForWeek = appointmentRows.filter(
      (row) =>
        row.appointment_date >= week.weekStart &&
        row.appointment_date <= week.weekEnd
    );

    const cancellationRowsForWeek = cancellationRows.filter(
      (row) => row.event_date >= week.weekStart && row.event_date <= week.weekEnd
    );

    const completedAppointments = appointmentRowsForWeek.filter(
      (row) => normalizeText(row.arrival_status) !== ""
    ).length;

    const denominator = completedAppointments;

    const ftaCount = cancellationRowsForWeek.filter(
      (row) => row.is_fta === true
    ).length;

    const cancelNoRebookCount = cancellationRowsForWeek.filter(
      (row) => row.is_cancellation_no_rebooking === true
    ).length;

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      totalAppointments: denominator,
      ftaCount,
      ftaPct: round4(safeDivide(ftaCount, denominator)),
      cancelNoRebookCount,
      cancelNoRebookPct: round4(safeDivide(cancelNoRebookCount, denominator)),
    };
  });
}

function getMetricCellStyle(
  value: number | null,
  metricKey: string,
  benchmarks: PracticeKpiBenchmark[]
): React.CSSProperties {
  const benchmark = getKpiBenchmarkByKey(benchmarks, metricKey);
  const tone = getKpiBenchmarkTone(value, benchmark);
  const toneStyles = getKpiToneStyles(tone);

  return {
    ...tdStyle,
    backgroundColor: toneStyles.backgroundColor,
    color: toneStyles.color,
    borderBottomColor: toneStyles.borderColor,
    fontWeight: 800,
    textAlign: "center",
    whiteSpace: "nowrap",
  };
}

async function getKpiBenchmarks(): Promise<PracticeKpiBenchmark[]> {
  const supabase = getServiceRoleSupabaseClient();

  const { data, error } = await supabase
    .from("practice_kpi_benchmarks")
    .select(
      `
      id,
      metric_key,
      metric_label,
      metric_type,
      higher_is_better,
      target_value,
      green_min,
      green_max,
      orange_min,
      orange_max,
      red_min
      `
    );

  if (error) {
    throw new Error(`Failed to load KPI benchmarks: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    metric_key: String(row.metric_key ?? ""),
    metric_label: String(row.metric_label ?? ""),
    metric_type: row.metric_type ?? "percentage",
    higher_is_better: Boolean(row.higher_is_better),
    target_value: Number(row.target_value ?? 0),
    green_min: Number(row.green_min ?? 0),
    green_max: Number(row.green_max ?? 0),
    orange_min: Number(row.orange_min ?? 0),
    orange_max: Number(row.orange_max ?? 0),
    red_min: Number(row.red_min ?? 0),
  })) as PracticeKpiBenchmark[];
}

function buildMonthPeriodOptions(params: {
  selectedYear: string;
  monthOptions: Array<{ key: string; label: string }>;
}): TimePeriodOption[] {
  const { selectedYear, monthOptions } = params;

  return monthOptions
    .filter((option) => getYearFromMonthKey(option.key) === selectedYear)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((option) => {
      const monthNumber = getMonthFromMonthKey(option.key);

      return {
        key: option.key,
        label: getMonthName(monthNumber),
        view: "month" as KpiView,
        periodType: "month" as PeriodType,
        periodKey: option.key,
        sortDate: `${option.key}-01`,
      };
    });
}

function buildQuarterPeriodOptions(params: {
  selectedYear: string;
  quarterOptions: Array<{ key: string; label: string }>;
}): TimePeriodOption[] {
  const { selectedYear, quarterOptions } = params;

  return quarterOptions
    .map((option) => {
      const weeks = getWeeksForPeriod("quarter_ato", option.key);
      const sortDate = weeks[0]?.weekStart ?? "9999-12-31";

      return {
        key: option.key,
        label: option.label,
        view: "quarter_ato" as KpiView,
        periodType: "quarter_ato" as PeriodType,
        periodKey: option.key,
        sortDate,
      };
    })
    .filter((option) => option.sortDate.startsWith(selectedYear))
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate));
}

function getSelectedPeriodType(value: string | undefined): PeriodType {
  if (value === "month" || value === "quarter_ato" || value === "year") {
    return value;
  }

  return "month";
}

function getSelectedPeriodOption(params: {
  periodType: PeriodType;
  selectedYear: string;
  requestedMonth: string | undefined;
  requestedQuarter: string | undefined;
  monthOptionsForYear: TimePeriodOption[];
  quarterOptionsForYear: TimePeriodOption[];
  defaultMonthKey: string;
}): TimePeriodOption {
  const {
    periodType,
    selectedYear,
    requestedMonth,
    requestedQuarter,
    monthOptionsForYear,
    quarterOptionsForYear,
    defaultMonthKey,
  } = params;

  if (periodType === "year") {
    return {
      key: selectedYear,
      label: "Full year",
      view: "year",
      periodType: "year",
      periodKey: selectedYear,
      sortDate: `${selectedYear}-12-31`,
    };
  }

  if (periodType === "quarter_ato") {
    return (
      quarterOptionsForYear.find((option) => option.key === requestedQuarter) ??
      quarterOptionsForYear[0] ?? {
        key: selectedYear,
        label: "Full year",
        view: "year",
        periodType: "year",
        periodKey: selectedYear,
        sortDate: `${selectedYear}-12-31`,
      }
    );
  }

  return (
    monthOptionsForYear.find((option) => option.key === requestedMonth) ??
    monthOptionsForYear.find((option) => option.key === defaultMonthKey) ??
    monthOptionsForYear[0] ?? {
      key: selectedYear,
      label: "Full year",
      view: "year",
      periodType: "year",
      periodKey: selectedYear,
      sortDate: `${selectedYear}-12-31`,
    }
  );
}

export default async function PracticeManagerKpisPage({
  searchParams,
}: PageProps) {
  await requireRole(["admin", "practice_manager"]);
  const resolvedSearchParams = await searchParams;

  const defaultMonthKey = getDefaultMonthKey();
  const monthOptions = getMonthOptions(24);
  const yearOptions = getYearOptions(6);
  const quarterOptions = getAtoQuarterOptions(12);

  const availableYears = Array.from(
    new Set([
      ...monthOptions.map((option) => getYearFromMonthKey(option.key)),
      ...yearOptions.map((option) => option.key),
    ])
  ).sort((a, b) => b.localeCompare(a));

  const requestedYear =
    resolvedSearchParams?.year ?? getYearFromMonthKey(defaultMonthKey);

  const selectedYear = availableYears.includes(requestedYear)
    ? requestedYear
    : getYearFromMonthKey(defaultMonthKey);

  const monthOptionsForYear = buildMonthPeriodOptions({
    selectedYear,
    monthOptions,
  });

  const quarterOptionsForYear = buildQuarterPeriodOptions({
    selectedYear,
    quarterOptions,
  });

  const selectedPeriodType = getSelectedPeriodType(
    resolvedSearchParams?.periodType
  );

  const selectedPeriodOption = getSelectedPeriodOption({
    periodType: selectedPeriodType,
    selectedYear,
    requestedMonth: resolvedSearchParams?.month,
    requestedQuarter: resolvedSearchParams?.quarter,
    monthOptionsForYear,
    quarterOptionsForYear,
    defaultMonthKey,
  });

  const filterWeeks = getWeeksForPeriod(
    selectedPeriodOption.view,
    selectedPeriodOption.periodKey
  );

  const filterStart = filterWeeks[0]?.weekStart;
  const filterEnd = filterWeeks[filterWeeks.length - 1]?.weekEnd;

  const fortnightlyStaffingRows =
    filterStart && filterEnd
      ? await getFortnightlyStaffingKpis(filterStart, filterEnd)
      : [];

  const weeks =
    fortnightlyStaffingRows.length > 0
      ? fortnightlyStaffingRows.flatMap((period) => {
          const firstWeekEnd = addDays(period.periodStart, 6);

          return [
            {
              weekStart: period.periodStart,
              weekEnd:
                firstWeekEnd <= period.periodEnd
                  ? firstWeekEnd
                  : period.periodEnd,
              label: "Week 1",
            },
            {
              weekStart: addDays(firstWeekEnd, 1),
              weekEnd: period.periodEnd,
              label: "Week 2",
            },
          ].filter((week) => week.weekStart <= week.weekEnd);
        })
      : filterWeeks;

  const overallStart = weeks[0]?.weekStart;
  const overallEnd = weeks[weeks.length - 1]?.weekEnd;

  const [
    weeklyCancellationFtaRows,
    weeklyNewPatientRows,
    weeklyGoogleReviewRows,
    weeklyReferralBookingRows,
    benchmarks,
  ] = await Promise.all([
    getWeeklyCancellationFtaKpisDirect(weeks),
    getWeeklyNewPatientCountsDirect(weeks),
    getWeeklyGoogleReviewKpis(weeks),
    getWeeklyReferralBookingKpis(weeks).catch(() => []),
    getKpiBenchmarks(),
  ]);

  const monthKeysInView = Array.from(
    new Set(weeks.map((week) => week.weekStart.slice(0, 7)))
  );

  const monthlyGapRows = await Promise.all(
    monthKeysInView.map(async (monthKey) => ({
      monthKey,
      gap: await getMonthlyGapKpi(monthKey),
    }))
  );

  const gapByMonth = new Map(
    monthlyGapRows.map((row) => [row.monthKey, row.gap])
  );

  const draftRows = weeks.map((week) => {
    const clinical = weeklyCancellationFtaRows.find(
      (row) => row.weekStart === week.weekStart && row.weekEnd === week.weekEnd
    );

    const referralBooking = weeklyReferralBookingRows.find(
      (row) => row.weekStart === week.weekStart && row.weekEnd === week.weekEnd
    );

    const newPatientCount = weeklyNewPatientRows.find(
      (row) => row.weekStart === week.weekStart && row.weekEnd === week.weekEnd
    );

    const googleReview = weeklyGoogleReviewRows.find(
      (row) => row.weekStart === week.weekStart && row.weekEnd === week.weekEnd
    );

    const monthKey = week.weekStart.slice(0, 7);
    const monthlyGap = gapByMonth.get(monthKey);

    const staffing = fortnightlyStaffingRows.find(
      (period) =>
        week.weekStart >= period.periodStart && week.weekStart <= period.periodEnd
    );

    return {
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      label: week.label,
      newPatients: newPatientCount?.newPatients ?? 0,
      googleReviewCount: googleReview?.googleReviewCount ?? 0,
      averageGoogleRating: googleReview?.averageGoogleRating ?? null,
      referralBookingRate: referralBooking?.referralBookingRate ?? null,
      gapPct: monthlyGap?.gapPct ?? null,
      ftaPct: clinical?.ftaPct ?? 0,
      cancelNoRebookPct: clinical?.cancelNoRebookPct ?? 0,
      overtimeHours: staffing?.overtimeHours ?? null,
      billingStaffingPct: staffing?.billingStaffingPct ?? null,
      payPeriodId: staffing?.payPeriodId ?? null,
    };
  });

  const payPeriodWeekCounts = new Map<string, number>();
  const firstWeekByPayPeriod = new Map<string, string>();

  for (const row of draftRows) {
    if (!row.payPeriodId) continue;

    payPeriodWeekCounts.set(
      row.payPeriodId,
      (payPeriodWeekCounts.get(row.payPeriodId) ?? 0) + 1
    );

    if (!firstWeekByPayPeriod.has(row.payPeriodId)) {
      firstWeekByPayPeriod.set(row.payPeriodId, row.weekStart);
    }
  }

  const rows: DisplayRow[] = draftRows.map((row) => ({
    ...row,
    payPeriodWeekCount: row.payPeriodId
      ? payPeriodWeekCounts.get(row.payPeriodId) ?? 1
      : 1,
    isFirstWeekOfPayPeriod: row.payPeriodId
      ? firstWeekByPayPeriod.get(row.payPeriodId) === row.weekStart
      : true,
  }));

  const totalNewPatients = rows.reduce(
    (total, row) => total + row.newPatients,
    0
  );

  const totalGoogleReviews = rows.reduce(
    (total, row) => total + row.googleReviewCount,
    0
  );

  return (
    <main id="kpi-report-content" style={pageStyle}>
      <section style={headerCardStyle}>
        <div style={headerTextStyle}>
          <p style={eyebrowStyle}>Practice manager dashboard</p>
          <h1 style={headingStyle}>Practice KPIs</h1>
          <p style={subheadingStyle}>
            Weekly performance view for the selected period. Overtime and Billing /
            Staffing are shown by fortnightly pay period, with cells merged across
            the matching weeks.
          </p>
        </div>

        <div style={headerControlsStyle}>
          <div style={filterActionBarStyle}>
            <div style={filterAreaStyle}>
              <KpiDateSelector
                selectedYear={selectedYear}
                selectedPeriodType={selectedPeriodType}
                selectedMonth={
                  selectedPeriodOption.periodType === "month"
                    ? selectedPeriodOption.periodKey
                    : monthOptionsForYear[0]?.periodKey ?? ""
                }
                selectedQuarter={
                  selectedPeriodOption.periodType === "quarter_ato"
                    ? selectedPeriodOption.periodKey
                    : quarterOptionsForYear[0]?.periodKey ?? ""
                }
                availableYears={availableYears}
                monthOptionsForYear={monthOptionsForYear}
                quarterOptionsForYear={quarterOptionsForYear}
              />
            </div>

            <div style={buttonAreaStyle}>
              <SyncGoogleReviewsButton />
              <KpiPdfExportButtons
                targetId="kpi-report-content"
                fileName="practice-kpis"
              />
            </div>
          </div>

          <div style={summaryCardsWrapperStyle}>
            <div style={summaryCardStyle}>
              <div style={summaryLabelStyle}>New Patients</div>
              <div style={summaryValueStyle}>{formatCount(totalNewPatients)}</div>
              <div style={summaryHelpStyle}>selected period total</div>
            </div>

            <div style={summaryCardStyle}>
              <div style={summaryLabelStyle}>Google Reviews</div>
              <div style={summaryValueStyle}>
                {formatCount(totalGoogleReviews)}
              </div>
              <div style={summaryHelpStyle}>selected period total</div>
            </div>
          </div>
        </div>
      </section>

      <section style={legendStyle}>
        <div style={legendTitleStyle}>Colour key</div>
        <div style={legendItemsStyle}>
          <span style={legendItemStyle("#dcfce7", "#166534", "#86efac")}>
            On target
          </span>
          <span style={legendItemStyle("#fef3c7", "#92400e", "#fcd34d")}>
            Monitor
          </span>
          <span style={legendItemStyle("#fee2e2", "#991b1b", "#fca5a5")}>
            Review
          </span>
        </div>
      </section>

      <section style={tableCardStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Week / Date Period</th>
              <th style={thStyle}>New Patients</th>
              <th style={thStyle}>Google Reviews</th>
              <th style={thStyle}>Average Google Rating</th>
              <th style={thStyle}>Referral Booking</th>
              <th style={thStyle}>Gap %</th>
              <th style={thStyle}>FTA %</th>
              <th style={thStyle}>Cancellation No Rebook %</th>
              <th style={thStyle}>Overtime Hours</th>
              <th style={thStyle}>Billing / Staffing</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={`${row.weekStart}-${row.weekEnd}`}>
                <td style={weekTdStyle}>
                  <div style={weekDateStyle}>
                    {getReadableDate(row.weekStart)} to{" "}
                    {getReadableDate(row.weekEnd)}
                  </div>
                </td>

                <td style={newPatientTdStyle}>{formatCount(row.newPatients)}</td>

                <td style={googleReviewTdStyle}>
                  {formatCount(row.googleReviewCount)}
                </td>

                <td style={googleRatingTdStyle}>
                  {formatRating(row.averageGoogleRating)}
                </td>

                <td
                  style={getMetricCellStyle(
                    row.referralBookingRate,
                    "referral_booking_rate",
                    benchmarks
                  )}
                >
                  {formatPercent(row.referralBookingRate)}
                </td>

                <td style={getMetricCellStyle(row.gapPct, "gap_pct", benchmarks)}>
                  {formatPercent(row.gapPct)}
                </td>

                <td style={getMetricCellStyle(row.ftaPct, "fta_pct", benchmarks)}>
                  {formatPercent(row.ftaPct)}
                </td>

                <td
                  style={getMetricCellStyle(
                    row.cancelNoRebookPct,
                    "cancel_no_rebook_pct",
                    benchmarks
                  )}
                >
                  {formatPercent(row.cancelNoRebookPct)}
                </td>

                {row.isFirstWeekOfPayPeriod && (
  <td
    rowSpan={row.payPeriodWeekCount}
    style={getMetricCellStyle(
      row.overtimeHours,
      "overtime_hours",
      benchmarks
    )}
  >
    {formatHours(row.overtimeHours)}
  </td>
)}

                {row.isFirstWeekOfPayPeriod && (
                  <td
                    rowSpan={row.payPeriodWeekCount}
                    style={getMetricCellStyle(
                      row.billingStaffingPct,
                      "billing_staffing_pct",
                      benchmarks
                    )}
                  >
                    {formatPercent(row.billingStaffingPct)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  padding: "24px",
  fontFamily: "Arial, sans-serif",
  maxWidth: "1280px",
  margin: "0 auto",
  backgroundColor: "#f8fafc",
};

const headerCardStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "20px",
  alignItems: "start",
  marginBottom: "18px",
  padding: "22px",
  border: "1px solid #e5e7eb",
  borderRadius: "18px",
  backgroundColor: "#ffffff",
  boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
};

const headerTextStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "780px",
};

const headerControlsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "18px",
  alignItems: "stretch",
  width: "100%",
};

const filterActionBarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "16px",
  alignItems: "end",
  width: "100%",
};

const filterAreaStyle: React.CSSProperties = {
  minWidth: 0,
};

const buttonAreaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "end",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
  minWidth: "420px",
};

const summaryCardsWrapperStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(180px, 1fr))",
  gap: "12px",
  maxWidth: "520px",
};

const eyebrowStyle: React.CSSProperties = {
  margin: "0 0 6px",
  color: "#2563eb",
  fontSize: "13px",
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const headingStyle: React.CSSProperties = {
  fontSize: "30px",
  fontWeight: 800,
  margin: "0 0 8px",
  color: "#0f172a",
};

const subheadingStyle: React.CSSProperties = {
  margin: 0,
  color: "#475569",
  lineHeight: 1.5,
  maxWidth: "760px",
};

const summaryCardStyle: React.CSSProperties = {
  width: "100%",
  minWidth: "160px",
  padding: "16px",
  borderRadius: "16px",
  backgroundColor: "#eff6ff",
  border: "1px solid #bfdbfe",
  textAlign: "center",
};

const summaryLabelStyle: React.CSSProperties = {
  color: "#1e40af",
  fontSize: "13px",
  fontWeight: 800,
  marginBottom: "8px",
};

const summaryValueStyle: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "34px",
  fontWeight: 900,
};

const summaryHelpStyle: React.CSSProperties = {
  marginTop: "2px",
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 700,
};

const legendStyle: React.CSSProperties = {
  marginBottom: "18px",
  padding: "14px 16px",
  borderRadius: "16px",
  border: "1px solid #e5e7eb",
  backgroundColor: "#ffffff",
};

const legendTitleStyle: React.CSSProperties = {
  fontWeight: 900,
  marginBottom: "8px",
  color: "#0f172a",
};

const legendItemsStyle: React.CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

function legendItemStyle(
  backgroundColor: string,
  color: string,
  borderColor: string
): React.CSSProperties {
  return {
    display: "inline-flex",
    padding: "7px 10px",
    borderRadius: "999px",
    backgroundColor,
    color,
    border: `1px solid ${borderColor}`,
    fontSize: "13px",
    fontWeight: 800,
  };
}

const tableCardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "18px",
  backgroundColor: "#ffffff",
  boxShadow: "0 10px 28px rgba(15, 23, 42, 0.06)",
  overflowX: "auto",
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  minWidth: "1180px",
  tableLayout: "fixed",
  backgroundColor: "#ffffff",
};

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
  padding: "12px 8px",
  textAlign: "center",
  backgroundColor: "#f8fafc",
  color: "#334155",
  fontSize: "12px",
  fontWeight: 900,
  verticalAlign: "middle",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
  padding: "12px 8px",
  verticalAlign: "middle",
  fontSize: "13px",
};

const newPatientTdStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "center",
  fontWeight: 900,
  color: "#0f172a",
  backgroundColor: "#f8fafc",
};

const googleReviewTdStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "center",
  fontWeight: 900,
  color: "#0f172a",
  backgroundColor: "#f0fdf4",
};

const googleRatingTdStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "center",
  fontWeight: 900,
  color: "#854d0e",
  backgroundColor: "#fefce8",
  whiteSpace: "nowrap",
};

const overtimeHoursTdStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "center",
  fontWeight: 900,
  color: "#0f172a",
  backgroundColor: "#f8fafc",
  whiteSpace: "nowrap",
};

const weekTdStyle: React.CSSProperties = {
  ...tdStyle,
  backgroundColor: "#ffffff",
};

const weekDateStyle: React.CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  color: "#64748b",
};