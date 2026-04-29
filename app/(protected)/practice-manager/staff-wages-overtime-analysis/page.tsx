import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";
import SyncPayrollButton from "@/components/SyncPayrollButton";
import SyncConnecteamButton from "@/components/SyncConnecteamButton";
import SyncLabourHireButton from "@/components/SyncLabourHireButton";
import ConnecteamOvertimeSummary from "@/components/ConnecteamOvertimeSummary";
import PeriodSelector from "@/components/PeriodSelector";
import StaffWagesTrendsCharts, { type StaffWagesTrendPoint } from "@/components/StaffWagesTrendsCharts";

type PageProps = {
  searchParams?: Promise<{
    view?: string;
    period?: string;
    staff?: string;
    tab?: string;
  }>;
};

type PayPeriod = {
  id: string;
  period_start: string;
  period_end: string;
  payment_date: string | null;
  status: string | null;
};

type PeriodOption = {
  key: string;
  label: string;
  payPeriodIds: string[];
  start: string;
  end: string;
};

type WageLine = {
  employee_name: string | null;
  line_type: string;
  overtime_multiplier: number | null;
  hours: number;
  amount: number;
};

type OvertimeDetail = {
  date: string;
  day: string;
  shifts: string[];
  totalHours: number;
  paidHours: number;
  overtimeHours: number;
};

type ProductionRow = {
  service_date: string | null;
  gross_production: number | string | null;
};

type ProductionSummary = {
  grossProduction: number;
  weeklyProduction: Array<{
    key: string;
    label: string;
    start: string;
    end: string;
    grossProduction: number;
  }>;
  fortnightlyProduction: Array<{
    key: string;
    label: string;
    start: string;
    end: string;
    grossProduction: number;
  }>;
  monthlyProduction: Array<{
    key: string;
    label: string;
    start: string;
    end: string;
    grossProduction: number;
  }>;
};

type TrendRow = StaffWagesTrendPoint;

const STANDARD_DAILY_HOURS = 9.5;
const FIXED_BREAK_MINUTES = 30;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function hours(value: number) {
  return `${value.toFixed(2)} hrs`;
}

function percent(value: number) {
  return `${value.toFixed(2)}%`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function yearKey(date: string) {
  return date.slice(0, 4);
}

function toDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const date = toDate(value);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function getMonthStartFromKey(key: string) {
  return `${key}-01`;
}

function getMonthEndFromKey(key: string) {
  const [year, month] = key.split("-").map(Number);
  const date = new Date(year, month, 0);
  return toDateKey(date);
}

function getYearStartFromKey(key: string) {
  return `${key}-01-01`;
}

function getYearEndFromKey(key: string) {
  return `${key}-12-31`;
}

function getAtoQuarterKey(date: string) {
  const d = new Date(`${date}T00:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  if (month >= 7 && month <= 9) return `${year}-Q1`;
  if (month >= 10 && month <= 12) return `${year}-Q2`;
  if (month >= 1 && month <= 3) return `${year}-Q3`;
  return `${year}-Q4`;
}

function getAtoQuarterLabel(key: string) {
  const [year, quarter] = key.split("-");

  if (quarter === "Q1") return `ATO Q1 ${year} — Jul to Sep`;
  if (quarter === "Q2") return `ATO Q2 ${year} — Oct to Dec`;
  if (quarter === "Q3") return `ATO Q3 ${year} — Jan to Mar`;
  if (quarter === "Q4") return `ATO Q4 ${year} — Apr to Jun`;

  return key;
}

function getAtoQuarterDateRange(key: string) {
  const [yearText, quarter] = key.split("-");
  const year = Number(yearText);

  if (quarter === "Q1") {
    return {
      start: `${year}-07-01`,
      end: `${year}-09-30`,
    };
  }

  if (quarter === "Q2") {
    return {
      start: `${year}-10-01`,
      end: `${year}-12-31`,
    };
  }

  if (quarter === "Q3") {
    return {
      start: `${year}-01-01`,
      end: `${year}-03-31`,
    };
  }

  if (quarter === "Q4") {
    return {
      start: `${year}-04-01`,
      end: `${year}-06-30`,
    };
  }

  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function getMonthLabel(key: string) {
  const [year, month] = key.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);

  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function getPeriodKey(view: string, payPeriod: PayPeriod) {
  if (view === "month") return monthKey(payPeriod.period_start);
  if (view === "quarter") return getAtoQuarterKey(payPeriod.period_start);
  if (view === "year") return yearKey(payPeriod.period_start);

  return payPeriod.id;
}

function getPeriodLabel(view: string, key: string, payPeriod?: PayPeriod) {
  if (view === "month") return getMonthLabel(key);
  if (view === "quarter") return getAtoQuarterLabel(key);
  if (view === "year") return key;

  if (!payPeriod) return key;

  return `${dateLabel(payPeriod.period_start)} to ${dateLabel(
    payPeriod.period_end
  )}`;
}

function getReportingDateRange(view: string, selectedPeriod: PeriodOption) {
  if (view === "month") {
    return {
      start: getMonthStartFromKey(selectedPeriod.key),
      end: getMonthEndFromKey(selectedPeriod.key),
    };
  }

  if (view === "quarter") {
    return getAtoQuarterDateRange(selectedPeriod.key);
  }

  if (view === "year") {
    return {
      start: getYearStartFromKey(selectedPeriod.key),
      end: getYearEndFromKey(selectedPeriod.key),
    };
  }

  return {
    start: selectedPeriod.start,
    end: selectedPeriod.end,
  };
}

function buildPeriodOptions(view: string, payPeriods: PayPeriod[]) {
  const periodOptionsMap = new Map<string, PeriodOption>();

  for (const payPeriod of payPeriods) {
    const key = getPeriodKey(view, payPeriod);
    const existing = periodOptionsMap.get(key);

    if (existing) {
      existing.payPeriodIds.push(payPeriod.id);

      if (payPeriod.period_start < existing.start) {
        existing.start = payPeriod.period_start;
      }

      if (payPeriod.period_end > existing.end) {
        existing.end = payPeriod.period_end;
      }
    } else {
      periodOptionsMap.set(key, {
        key,
        label: getPeriodLabel(view, key, payPeriod),
        payPeriodIds: [payPeriod.id],
        start: payPeriod.period_start,
        end: payPeriod.period_end,
      });
    }
  }

  return Array.from(periodOptionsMap.values()).sort((a, b) =>
    b.start.localeCompare(a.start)
  );
}

function optionHref(view: string, period: string, showStaff: boolean) {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("period", period);
  if (showStaff) params.set("staff", "1");

  return `/practice-manager/staff-wages-overtime-analysis?${params.toString()}`;
}

function tabHref(params: {
  tab: "summary" | "trends";
  view: string;
  period: string;
  showStaff: boolean;
}) {
  const query = new URLSearchParams();
  query.set("view", params.view);
  query.set("period", params.period);

  if (params.tab === "trends") query.set("tab", "trends");
  if (params.showStaff) query.set("staff", "1");

  return `/practice-manager/staff-wages-overtime-analysis?${query.toString()}`;
}

function comparisonViewHref(view: "month" | "quarter" | "year") {
  const query = new URLSearchParams();
  query.set("tab", "trends");
  query.set("view", view);

  return `/practice-manager/staff-wages-overtime-analysis?${query.toString()}`;
}

function safeJson(rawJson: any) {
  try {
    if (!rawJson) return {};
    if (typeof rawJson === "string") return JSON.parse(rawJson);
    return rawJson;
  } catch {
    return {};
  }
}

function formatShiftTime(timestamp: number, timezone = "Australia/Brisbane") {
  if (!timestamp) return "-";

  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(timestamp * 1000));
}

function buildWeeklyRanges(start: string, end: string) {
  const ranges: Array<{
    key: string;
    label: string;
    start: string;
    end: string;
  }> = [];

  let cursor = start;
  let weekNumber = 1;

  while (cursor <= end) {
    const rangeEnd = addDays(cursor, 6);
    const finalEnd = rangeEnd <= end ? rangeEnd : end;

    ranges.push({
      key: `week-${weekNumber}-${cursor}`,
      label: `Week ${weekNumber}`,
      start: cursor,
      end: finalEnd,
    });

    cursor = addDays(finalEnd, 1);
    weekNumber += 1;
  }

  return ranges;
}

function buildFortnightlyRanges(start: string, end: string) {
  const ranges: Array<{
    key: string;
    label: string;
    start: string;
    end: string;
  }> = [];

  let cursor = start;
  let fortnightNumber = 1;

  while (cursor <= end) {
    const rangeEnd = addDays(cursor, 13);
    const finalEnd = rangeEnd <= end ? rangeEnd : end;

    ranges.push({
      key: `fortnight-${fortnightNumber}-${cursor}`,
      label: `Fortnight ${fortnightNumber}`,
      start: cursor,
      end: finalEnd,
    });

    cursor = addDays(finalEnd, 1);
    fortnightNumber += 1;
  }

  return ranges;
}

function buildMonthlyRanges(start: string, end: string) {
  const ranges: Array<{
    key: string;
    label: string;
    start: string;
    end: string;
  }> = [];

  let cursor = getMonthStartFromKey(monthKey(start));

  while (cursor <= end) {
    const key = monthKey(cursor);
    const monthStart = getMonthStartFromKey(key);
    const monthEnd = getMonthEndFromKey(key);

    const rangeStart = monthStart < start ? start : monthStart;
    const rangeEnd = monthEnd > end ? end : monthEnd;

    ranges.push({
      key,
      label: getMonthLabel(key),
      start: rangeStart,
      end: rangeEnd,
    });

    const nextDate = toDate(monthStart);
    nextDate.setMonth(nextDate.getMonth() + 1);
    cursor = toDateKey(nextDate);
  }

  return ranges;
}

function sumProductionForRange(rows: ProductionRow[], start: string, end: string) {
  return rows
    .filter((row) => {
      if (!row.service_date) return false;
      return row.service_date >= start && row.service_date <= end;
    })
    .reduce(
      (total, row) => total + Number(row.gross_production ?? 0),
      0
    );
}

function buildProductionSummary(
  rows: ProductionRow[],
  start: string,
  end: string
): ProductionSummary {
  const grossProduction = sumProductionForRange(rows, start, end);

  const weeklyProduction = buildWeeklyRanges(start, end).map((range) => ({
    ...range,
    grossProduction: sumProductionForRange(rows, range.start, range.end),
  }));

  const fortnightlyProduction = buildFortnightlyRanges(start, end).map(
    (range) => ({
      ...range,
      grossProduction: sumProductionForRange(rows, range.start, range.end),
    })
  );

  const monthlyProduction = buildMonthlyRanges(start, end).map((range) => ({
    ...range,
    grossProduction: sumProductionForRange(rows, range.start, range.end),
  }));

  return {
    grossProduction,
    weeklyProduction,
    fortnightlyProduction,
    monthlyProduction,
  };
}

async function fetchAllProductionRows(params: {
  supabase: ReturnType<typeof getSupabase>;
  start: string;
  end: string;
}): Promise<ProductionRow[]> {
  const { supabase, start, end } = params;
  const pageSize = 1000;
  let from = 0;
  const allRows: ProductionRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("import_rows_normalized")
      .select("service_date, gross_production")
      .gte("service_date", start)
      .lte("service_date", end)
      .eq("is_excluded", false)
      .order("service_date", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load production rows: ${error.message}`);
    }

    const rows = (data ?? []) as ProductionRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

type LabourHireRow = {
  amount: number | string | null;
};

async function fetchAllLabourHireRows(params: {
  supabase: ReturnType<typeof getSupabase>;
  start: string;
  end: string;
}): Promise<LabourHireRow[]> {
  const { supabase, start, end } = params;
  const pageSize = 1000;
  let from = 0;
  const allRows: LabourHireRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("xero_labour_hire")
      .select("amount")
      .gte("transaction_date", start)
      .lte("transaction_date", end)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to load labour hire rows: ${error.message}`);
    }

    const rows = (data ?? []) as LabourHireRow[];
    allRows.push(...rows);

    if (rows.length < pageSize) break;

    from += pageSize;
  }

  return allRows;
}

async function buildTrendRows(params: {
  supabase: ReturnType<typeof getSupabase>;
  periodOptions: PeriodOption[];
  view: "month" | "quarter" | "year";
}) {
  const { supabase, periodOptions, view } = params;
  const limit = view === "month" ? 12 : view === "quarter" ? 8 : 5;
  const periodsToChart = periodOptions.slice(0, limit).reverse();
  const rows: TrendRow[] = [];

  for (const period of periodsToChart) {
    const reportingRange = getReportingDateRange(view, period);

    const { data: wageLinesData, error: wageLinesError } = await supabase
      .from("staff_wage_lines")
      .select("line_type, overtime_multiplier, hours, amount")
      .in("pay_period_id", period.payPeriodIds);

    if (wageLinesError) {
      throw new Error(
        `Failed to load trend wage lines: ${wageLinesError.message}`
      );
    }

    const trendWageLines = (wageLinesData ?? []) as WageLine[];

    const ordinaryWages = trendWageLines
      .filter((line) => line.line_type === "ordinary")
      .reduce((total, line) => total + Number(line.amount ?? 0), 0);

    const superAmount = trendWageLines
      .filter((line) => line.line_type === "superannuation")
      .reduce((total, line) => total + Number(line.amount ?? 0), 0);

    const overtimeLines = trendWageLines.filter(
      (line) => line.line_type === "overtime"
    );

    const overtimeCost = overtimeLines.reduce(
      (total, line) => total + Number(line.amount ?? 0),
      0
    );

    const overtimeHours = overtimeLines.reduce(
      (total, line) => total + Number(line.hours ?? 0),
      0
    );

    const labourHireRows = await fetchAllLabourHireRows({
      supabase,
      start: reportingRange.start,
      end: reportingRange.end,
    });

    const labourHireCost = labourHireRows.reduce(
      (total, row) => total + Number(row.amount ?? 0),
      0
    );

    rows.push({
      key: period.key,
      label: period.label,
      shortLabel:
        view === "month"
          ? period.label.replace(/^(\w{3})\w* (\d{4})$/, "$1 $2")
          : period.label,
      start: reportingRange.start,
      end: reportingRange.end,
      totalWages: ordinaryWages + superAmount + overtimeCost + labourHireCost,
      ordinaryWages,
      superAmount,
      labourHireCost,
      overtimeCost,
      overtimeHours,
    });
  }

  return rows;
}

export default async function StaffWagesOvertimeAnalysisPage({
  searchParams,
}: PageProps) {
  await requireRole(["admin", "practice_manager"]);

  const resolvedSearchParams = await searchParams;
  const requestedView = resolvedSearchParams?.view ?? "fortnight";
  const showStaff = resolvedSearchParams?.staff === "1";
  const activeTab = resolvedSearchParams?.tab === "trends" ? "trends" : "summary";

  const view = ["fortnight", "month", "quarter", "year"].includes(requestedView)
    ? requestedView
    : "fortnight";

  const supabase = getSupabase();

  const { data: payPeriodsData, error: payPeriodsError } = await supabase
    .from("staff_pay_periods")
    .select("id, period_start, period_end, payment_date, status")
    .order("period_start", { ascending: false });

  if (payPeriodsError) {
    throw new Error(`Failed to load pay periods: ${payPeriodsError.message}`);
  }

  const payPeriods = (payPeriodsData ?? []) as PayPeriod[];

  if (payPeriods.length === 0) {
    return (
      <main className="p-6">
        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            Staff Wages & Overtime Analysis
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            No synced payroll data was found yet. Run the Xero payroll sync first.
          </p>
        </section>
      </main>
    );
  }

  const periodOptionsByView = {
    fortnight: buildPeriodOptions("fortnight", payPeriods),
    month: buildPeriodOptions("month", payPeriods),
    quarter: buildPeriodOptions("quarter", payPeriods),
    year: buildPeriodOptions("year", payPeriods),
  };

  const periodOptions =
    periodOptionsByView[view as keyof typeof periodOptionsByView] ??
    periodOptionsByView.fortnight;

  const selectedPeriod =
    periodOptions.find((option) => option.key === resolvedSearchParams?.period) ??
    periodOptions[0];

  const comparisonView = ["month", "quarter", "year"].includes(view)
    ? (view as "month" | "quarter" | "year")
    : "month";

  const trendRows = await buildTrendRows({
    supabase,
    periodOptions: periodOptionsByView[comparisonView],
    view: comparisonView,
  });

  const reportingRange = getReportingDateRange(view, selectedPeriod);
  const selectedPayPeriodIds = selectedPeriod.payPeriodIds;

  const { data: wageLinesData, error: wageLinesError } = await supabase
    .from("staff_wage_lines")
    .select("employee_name, line_type, overtime_multiplier, hours, amount")
    .in("pay_period_id", selectedPayPeriodIds);

  if (wageLinesError) {
    throw new Error(`Failed to load wage lines: ${wageLinesError.message}`);
  }

  const wageLines = (wageLinesData ?? []) as WageLine[];

  const productionRows = await fetchAllProductionRows({
    supabase,
    start: reportingRange.start,
    end: reportingRange.end,
  });

  const productionSummary = buildProductionSummary(
    productionRows,
    reportingRange.start,
    reportingRange.end
  );

  const grossProduction = productionSummary.grossProduction;

  const labourHireRows = await fetchAllLabourHireRows({
    supabase,
    start: reportingRange.start,
    end: reportingRange.end,
  });

  const { data: mappingsData } = await supabase
    .from("employee_mapping")
    .select("xero_employee_name, connecteam_user_id")
    .eq("is_active", true);

  const { data: connecteamRows } = await supabase
    .from("connecteam_daily_timesheets")
    .select("connecteam_user_id, work_date, total_minutes, raw_json")
    .gte("work_date", reportingRange.start)
    .lte("work_date", reportingRange.end);

  const connecteamIdByXeroName = new Map<string, string>();

  for (const mapping of mappingsData ?? []) {
    if (mapping.xero_employee_name && mapping.connecteam_user_id) {
      connecteamIdByXeroName.set(
        String(mapping.xero_employee_name),
        String(mapping.connecteam_user_id)
      );
    }
  }

  const overtimeDetailsByConnecteamId = new Map<string, OvertimeDetail[]>();

  for (const row of connecteamRows ?? []) {
    const totalMinutes = Number(row.total_minutes ?? 0);
    const paidMinutes = Math.max(totalMinutes - FIXED_BREAK_MINUTES, 0);
    const overtimeMinutes = Math.max(
      paidMinutes - STANDARD_DAILY_HOURS * 60,
      0
    );

    if (overtimeMinutes <= 0) continue;

    const raw = safeJson(row.raw_json);
    const records = Array.isArray(raw.records) ? raw.records : [];

    const shifts = records.map((record: any) => {
      const timezone =
        record.start?.timezone ||
        record.end?.timezone ||
        "Australia/Brisbane";

      const start = formatShiftTime(record.start?.timestamp, timezone);
      const end = formatShiftTime(record.end?.timestamp, timezone);

      return `${start} → ${end}`;
    });

    const detail: OvertimeDetail = {
      date: row.work_date,
      day: dayLabel(row.work_date),
      shifts,
      totalHours: totalMinutes / 60,
      paidHours: paidMinutes / 60,
      overtimeHours: overtimeMinutes / 60,
    };

    const connecteamId = String(row.connecteam_user_id);
    const existing = overtimeDetailsByConnecteamId.get(connecteamId) ?? [];
    existing.push(detail);
    overtimeDetailsByConnecteamId.set(connecteamId, existing);
  }

  const ordinaryWages = wageLines
    .filter((line) => line.line_type === "ordinary")
    .reduce((total, line) => total + Number(line.amount ?? 0), 0);

  const superAmount = wageLines
    .filter((line) => line.line_type === "superannuation")
    .reduce((total, line) => total + Number(line.amount ?? 0), 0);

  const labourHireAmount = (labourHireRows ?? []).reduce(
    (total, row: any) => total + Number(row.amount ?? 0),
    0
  );

  const overtimeLines = wageLines.filter((line) => line.line_type === "overtime");

  const overtime1Lines = overtimeLines.filter(
    (line) => Number(line.overtime_multiplier ?? 1) === 1
  );

  const overtime15Lines = overtimeLines.filter(
    (line) => Number(line.overtime_multiplier ?? 0) === 1.5
  );

  const overtime2Lines = overtimeLines.filter(
    (line) => Number(line.overtime_multiplier ?? 0) === 2
  );

  function sumAmount(lines: WageLine[]) {
    return lines.reduce((total, line) => total + Number(line.amount ?? 0), 0);
  }

  function sumHours(lines: WageLine[]) {
    return lines.reduce((total, line) => total + Number(line.hours ?? 0), 0);
  }

  const overtime1Amount = sumAmount(overtime1Lines);
  const overtime15Amount = sumAmount(overtime15Lines);
  const overtime2Amount = sumAmount(overtime2Lines);

  const overtime1Hours = sumHours(overtime1Lines);
  const overtime15Hours = sumHours(overtime15Lines);
  const overtime2Hours = sumHours(overtime2Lines);

  const totalOvertimeAmount = sumAmount(overtimeLines);
  const totalOvertimeHours = sumHours(overtimeLines);

  const totalWagesCost =
    ordinaryWages + totalOvertimeAmount + superAmount + labourHireAmount;

  const overtimePctOfBillings =
    grossProduction > 0 ? (totalOvertimeAmount / grossProduction) * 100 : 0;

  const labourHirePctOfBillings =
    grossProduction > 0 ? (labourHireAmount / grossProduction) * 100 : 0;

  const totalWagesPctOfBillings =
    grossProduction > 0 ? (totalWagesCost / grossProduction) * 100 : 0;

  const staffMap = new Map<
    string,
    {
      ordinaryAmount: number;
      overtime1Amount: number;
      overtime15Amount: number;
      overtime2Amount: number;
      overtime1Hours: number;
      overtime15Hours: number;
      overtime2Hours: number;
    }
  >();

  for (const line of wageLines) {
    const name = line.employee_name || "Unknown staff member";

    if (!staffMap.has(name)) {
      staffMap.set(name, {
        ordinaryAmount: 0,
        overtime1Amount: 0,
        overtime15Amount: 0,
        overtime2Amount: 0,
        overtime1Hours: 0,
        overtime15Hours: 0,
        overtime2Hours: 0,
      });
    }

    const staff = staffMap.get(name)!;
    const amount = Number(line.amount ?? 0);
    const lineHours = Number(line.hours ?? 0);
    const multiplier = Number(line.overtime_multiplier ?? 1);

    if (line.line_type === "ordinary") {
      staff.ordinaryAmount += amount;
    }

    if (line.line_type === "overtime" && multiplier === 1) {
      staff.overtime1Amount += amount;
      staff.overtime1Hours += lineHours;
    }

    if (line.line_type === "overtime" && multiplier === 1.5) {
      staff.overtime15Amount += amount;
      staff.overtime15Hours += lineHours;
    }

    if (line.line_type === "overtime" && multiplier === 2) {
      staff.overtime2Amount += amount;
      staff.overtime2Hours += lineHours;
    }
  }

  const staffRows = Array.from(staffMap.entries())
    .map(([name, data]) => {
      const connecteamId = connecteamIdByXeroName.get(name);
      const overtimeDetails = connecteamId
        ? overtimeDetailsByConnecteamId.get(connecteamId) ?? []
        : [];

      return {
        name,
        ...data,
        totalOvertimeAmount:
          data.overtime1Amount + data.overtime15Amount + data.overtime2Amount,
        totalOvertimeHours:
          data.overtime1Hours + data.overtime15Hours + data.overtime2Hours,
        overtimeDetails,
      };
    })
    .filter((row) => row.totalOvertimeAmount > 0 || row.totalOvertimeHours > 0)
    .sort((a, b) => b.totalOvertimeAmount - a.totalOvertimeAmount);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-6 py-7 text-white">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-200">
                  Practice manager dashboard
                </p>
                <h1 className="mt-2 text-3xl font-bold tracking-tight">
                  Staff Wages & Overtime Analysis
                </h1>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  Review payroll costs, overtime, labour hire, and staffing efficiency
                  for the selected reporting period.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-white/10 px-3 py-1 text-blue-100 ring-1 ring-white/15">
                    Payroll: {dateLabel(selectedPeriod.start)} to{" "}
                    {dateLabel(selectedPeriod.end)}
                  </span>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-blue-100 ring-1 ring-white/15">
                    Reporting: {dateLabel(reportingRange.start)} to{" "}
                    {dateLabel(reportingRange.end)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-3xl bg-white p-4 text-slate-900 shadow-xl shadow-slate-950/20">
                <PeriodSelector
                  currentView={activeTab === "trends" ? comparisonView : view}
                  currentPeriod={selectedPeriod.key}
                  showStaff={showStaff}
                  periodOptionsByView={periodOptionsByView}
                />

                <Link
                  href="/practice-manager/kpis"
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-center text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  KPI Scorecard
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-3 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
            <MiniMetric label="Gross production" value={money(grossProduction)} />
            <MiniMetric label="Total wages cost" value={money(totalWagesCost)} />
            <MiniMetric label="Overtime cost" value={money(totalOvertimeAmount)} />
            <MiniMetric label="Labour hire" value={money(labourHireAmount)} />
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-[2rem] border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href={tabHref({
                tab: "summary",
                view,
                period: selectedPeriod.key,
                showStaff,
              })}
              className={`rounded-2xl px-5 py-3 text-center text-sm font-bold transition ${
                activeTab === "summary"
                  ? "bg-slate-950 text-white shadow-sm"
                  : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              Current period summary
            </Link>

            <Link
              href={tabHref({
                tab: "trends",
                view: comparisonView,
                period: selectedPeriod.key,
                showStaff,
              })}
              className={`rounded-2xl px-5 py-3 text-center text-sm font-bold transition ${
                activeTab === "trends"
                  ? "bg-slate-950 text-white shadow-sm"
                  : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
              }`}
            >
              Trends & comparison
            </Link>
          </div>

          {activeTab === "trends" && (
            <div className="flex flex-wrap gap-2">
              {(["month", "quarter", "year"] as const).map((option) => (
                <Link
                  key={option}
                  href={comparisonViewHref(option)}
                  className={`rounded-full px-4 py-2 text-xs font-bold capitalize transition ${
                    comparisonView === option
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-blue-50 text-blue-700 ring-1 ring-blue-100 hover:bg-blue-100"
                  }`}
                >
                  {option === "month" ? "Months" : option === "quarter" ? "Quarters" : "Years"}
                </Link>
              ))}
            </div>
          )}
        </section>

        {activeTab === "trends" ? (
          <StaffWagesTrendsCharts rows={trendRows} comparisonView={comparisonView} />
        ) : (
          <>
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-600">
                Data sync controls
              </p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                Refresh source data
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Run these syncs when payroll, labour hire, or timesheet information
                has changed. The cards use the selected dashboard dates by default.
              </p>
            </div>

            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              Selected period: {dateLabel(reportingRange.start)} to{" "}
              {dateLabel(reportingRange.end)}
            </div>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <SyncPanel
              title="Xero Payroll"
              eyebrow="Payroll"
              description="Sync wages, superannuation, and overtime. The safe sync processes one pay run at a time and can also backfill a full range."
            >
              <SyncPayrollButton
                defaultFrom={selectedPeriod.start}
                defaultTo={selectedPeriod.end}
              />
            </SyncPanel>

            <SyncPanel
              title="Xero Labour Hire"
              eyebrow="Expenses"
              description="Sync account 440 Labour Hire for the reporting range so temporary staffing costs are included."
            >
              <SyncLabourHireButton
                defaultFrom={reportingRange.start}
                defaultTo={reportingRange.end}
              />
            </SyncPanel>

            <SyncPanel
              title="Connecteam Timesheets"
              eyebrow="Timesheets"
              description="Sync daily clock-in and clock-out data used to identify overtime days and shift details."
            >
              <SyncConnecteamButton />
            </SyncPanel>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-5">
          <Card title="Gross production" value={money(grossProduction)} />
          <Card title="Total wages cost" value={money(totalWagesCost)} />
          <Card title="Total overtime cost" value={money(totalOvertimeAmount)} />
          <Card title="Total overtime hours" value={hours(totalOvertimeHours)} />
          <Card title="Labour Hire" value={money(labourHireAmount)} />
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <Card
            title="Wages % of billings"
            value={percent(totalWagesPctOfBillings)}
          />
          <Card
            title="Overtime % of billings"
            value={percent(overtimePctOfBillings)}
          />
          <Card
            title="Labour Hire % of billings"
            value={percent(labourHirePctOfBillings)}
          />
          <Card title="Ordinary wages" value={money(ordinaryWages)} />
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <OvertimeCard
            title="Overtime 1.0x"
            amount={overtime1Amount}
            hours={overtime1Hours}
          />
          <OvertimeCard
            title="Overtime 1.5x"
            amount={overtime15Amount}
            hours={overtime15Hours}
          />
          <OvertimeCard
            title="Overtime 2.0x"
            amount={overtime2Amount}
            hours={overtime2Hours}
          />
        </section>

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">
            Wage summary
          </h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Card title="Ordinary wages" value={money(ordinaryWages)} />
            <Card title="Overtime wages" value={money(totalOvertimeAmount)} />
            <Card title="Superannuation" value={money(superAmount)} />
            <Card title="Labour Hire" value={money(labourHireAmount)} />
          </div>

          <p className="mt-4 text-sm text-slate-500">
            Payroll selected range: {dateLabel(selectedPeriod.start)} to{" "}
            {dateLabel(selectedPeriod.end)}.
          </p>
        </section>

        <ConnecteamOvertimeSummary
          from={reportingRange.start}
          to={reportingRange.end}
        />

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Staff breakdown
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Hover over a staff name to see Connecteam overtime days and
                shift times.
              </p>
            </div>

            <Link
              href={optionHref(view, selectedPeriod.key, !showStaff)}
              className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              {showStaff ? "Hide staff breakdown" : "Show staff breakdown"}
            </Link>
          </div>

          {showStaff && (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="px-3 py-2">Staff name</th>
                    <th className="px-3 py-2 text-right">OT 1.0x hrs</th>
                    <th className="px-3 py-2 text-right">OT 1.0x $</th>
                    <th className="px-3 py-2 text-right">OT 1.5x hrs</th>
                    <th className="px-3 py-2 text-right">OT 1.5x $</th>
                    <th className="px-3 py-2 text-right">OT 2.0x hrs</th>
                    <th className="px-3 py-2 text-right">OT 2.0x $</th>
                    <th className="px-3 py-2 text-right">Total OT hrs</th>
                    <th className="px-3 py-2 text-right">Total OT $</th>
                  </tr>
                </thead>
                <tbody>
                  {staffRows.map((row) => (
                    <tr key={row.name} className="border-b">
                      <td className="relative px-3 py-2 font-medium">
                        <div className="group inline-block cursor-help">
                          <span className="border-b border-dotted border-slate-400">
                            {row.name}
                          </span>

                          <div className="invisible absolute left-3 top-9 z-50 w-[420px] rounded-2xl border bg-white p-4 text-xs font-normal text-slate-700 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100">
                            <div className="mb-2 text-sm font-semibold text-slate-900">
                              Connecteam overtime details
                            </div>

                            {row.overtimeDetails.length > 0 ? (
                              <div className="space-y-3">
                                {row.overtimeDetails
                                  .slice(0, 8)
                                  .map((detail, index) => (
                                    <div
                                      key={index}
                                      className="rounded-xl bg-slate-50 p-3"
                                    >
                                      <div className="font-semibold text-slate-900">
                                        {detail.day}, {dateLabel(detail.date)}
                                      </div>

                                      <div className="mt-1">
                                        {detail.shifts.length > 0 ? (
                                          detail.shifts.map(
                                            (shift, shiftIndex) => (
                                              <div key={shiftIndex}>{shift}</div>
                                            )
                                          )
                                        ) : (
                                          <div>No shift times found</div>
                                        )}
                                      </div>

                                      <div className="mt-2 text-slate-600">
                                        Total: {detail.totalHours.toFixed(2)} hrs
                                        · Paid after break:{" "}
                                        {detail.paidHours.toFixed(2)} hrs ·
                                        Estimated OT:{" "}
                                        <span className="font-semibold text-red-600">
                                          {detail.overtimeHours.toFixed(2)} hrs
                                        </span>
                                      </div>
                                    </div>
                                  ))}

                                {row.overtimeDetails.length > 8 && (
                                  <div className="text-slate-500">
                                    + {row.overtimeDetails.length - 8} more
                                    overtime days
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-slate-500">
                                No Connecteam overtime days found for this
                                selected period.
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-2 text-right">
                        {hours(row.overtime1Hours)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(row.overtime1Amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {hours(row.overtime15Hours)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(row.overtime15Amount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {hours(row.overtime2Hours)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {money(row.overtime2Amount)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {hours(row.totalOvertimeHours)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {money(row.totalOvertimeAmount)}
                      </td>
                    </tr>
                  ))}

                  {staffRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-slate-500">
                        No overtime staff rows found for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
          </>
        )}
      </div>
    </main>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}


function SyncPanel({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[520px] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">
            {eyebrow}
          </span>
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-100" />
        </div>

        <h3 className="mt-3 text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      </div>

      <div className="flex flex-1 p-5">{children}</div>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function OvertimeCard({
  title,
  amount,
  hours,
}: {
  title: string;
  amount: number;
  hours: number;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">
        {money(amount)}
      </div>
      <div className="mt-1 text-sm text-slate-500">{hours.toFixed(2)} hours</div>
    </div>
  );
}
