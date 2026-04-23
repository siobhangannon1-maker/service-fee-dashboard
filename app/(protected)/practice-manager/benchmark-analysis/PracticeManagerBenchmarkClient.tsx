"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

type TimeView = "month" | "quarter" | "year";

type ReportRow = {
  id: string;
  report_month: number;
  report_year: number;
  month_label: string;
  gross_production: number;
  total_expenses: number;
  total_expense_percent: number;
  created_at: string;
  updated_at: string;
};

type ReportItemRow = {
  id: string;
  report_id: string;
  category_name: string;
  expense_amount: number;
  percent: number;
  benchmark_percent: number;
  variance_percent: number;
  status: "green" | "orange" | "red";
  created_at: string;
  updated_at: string;
};

type ReportWithItems = ReportRow & {
  monthKey: string;
  quarterKey: string;
  quarterNumber: number;
  quarterLabel: string;
  financialYearKey: string;
  financialYearLabel: string;
  items: ReportItemRow[];
};

type ExpenseBenchmarkConfig = {
  id?: number | null;
  category_name: string;
  target_percent: number;
  green_min: number;
  green_max: number;
  orange_min: number;
  orange_max: number;
  red_min: number;
  green_heading?: string;
  green_intro?: string;
  green_actions_text?: string;
  orange_heading?: string;
  orange_intro?: string;
  orange_actions_text?: string;
  red_heading?: string;
  red_intro?: string;
  red_actions_text?: string;
  created_at?: string;
  updated_at?: string;
};

type BenchmarkActionTone = "green" | "orange" | "red";

type BenchmarkActionContent = {
  heading?: string;
  intro?: string;
  actions: string[];
};

type BenchmarkActionConfig = Partial<
  Record<BenchmarkActionTone, BenchmarkActionContent>
>;

type CategoryTrendPoint = {
  key: string;
  label: string;
  percent: number;
  benchmark: number;
  status: "green" | "orange" | "red";
};

type GroupedPeriod = {
  key: string;
  label: string;
  yearKey: string;
  yearLabel: string;
  subKey: string;
  subLabel: string;
  reports: ReportWithItems[];
};

type AdviceSelection = {
  categoryName: string;
  point: CategoryTrendPoint;
};

type ComparisonCategoryRow = {
  category_name: string;
  percentA: number;
  percentB: number;
  benchmark: number;
  variance: number;
  direction: "better" | "worse" | "no_change";
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_BENCHMARK_ACTION_LIBRARY: Record<string, BenchmarkActionConfig> = {
  default: {
    red: {
      heading: "Suggested actions",
      intro: "This benchmark is above target. Review the items below first.",
      actions: [
        "Review supplier invoices",
        "Compare against prior months",
        "Check whether this cost rose faster than production",
      ],
    },
    orange: {
      heading: "Suggested actions",
      intro: "This benchmark is close to target. Monitor it before it worsens.",
      actions: ["Watch the trend next month", "Review any recent cost increases"],
    },
    green: {
      heading: "On target",
      intro: "This benchmark is currently being met.",
      actions: ["Keep monitoring this category monthly"],
    },
  },
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatPercent(value: number) {
  return `${(value || 0).toFixed(2)}%`;
}

function formatVariance(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function getMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function getMonthLabelFromParts(year: number, month: number) {
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    year: "numeric",
  }).format(date);
}

function getMonthName(month: number) {
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
  }).format(new Date(2000, month - 1, 1));
}

function getFinancialQuarter(month: number) {
  if (month >= 7 && month <= 9) return 1;
  if (month >= 10 && month <= 12) return 2;
  if (month >= 1 && month <= 3) return 3;
  return 4;
}

function getFinancialYearStart(year: number, month: number) {
  return month >= 7 ? year : year - 1;
}

function getFinancialYearLabel(financialYearStart: number) {
  const start = String(financialYearStart % 100).padStart(2, "0");
  const end = String((financialYearStart + 1) % 100).padStart(2, "0");
  return `${start}/${end}FY`;
}

function getQuarterInfo(year: number, month: number) {
  const quarter = getFinancialQuarter(month);
  const financialYearStart = getFinancialYearStart(year, month);

  return {
    quarterKey: `${financialYearStart}-Q${quarter}`,
    quarterNumber: quarter,
    quarterLabel: `Q${quarter} ${getFinancialYearLabel(financialYearStart)}`,
  };
}

function getFinancialYearInfo(year: number, month: number) {
  const financialYearStart = getFinancialYearStart(year, month);

  return {
    financialYearKey: String(financialYearStart),
    financialYearLabel: getFinancialYearLabel(financialYearStart),
  };
}

function normalizeStatus(value: unknown): "green" | "orange" | "red" {
  if (value === "green" || value === "orange" || value === "red") return value;
  return "red";
}

function sortReportsOldestFirst(a: ReportWithItems, b: ReportWithItems) {
  if (a.report_year !== b.report_year) {
    return a.report_year - b.report_year;
  }
  return a.report_month - b.report_month;
}

function sortReportsNewestFirst(a: ReportWithItems, b: ReportWithItems) {
  if (a.report_year !== b.report_year) {
    return b.report_year - a.report_year;
  }
  return b.report_month - a.report_month;
}

function normalizeBenchmarkCategoryName(categoryName: string) {
  return categoryName.trim().toLowerCase();
}

function parseActionsText(value: string | undefined, fallback: string[]) {
  const actions = (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return actions.length > 0 ? actions : fallback;
}

function buildBenchmarkActionMap(benchmarks: ExpenseBenchmarkConfig[]) {
  const map = new Map<string, BenchmarkActionConfig>();

  for (const benchmark of benchmarks) {
    const key = normalizeBenchmarkCategoryName(benchmark.category_name || "");
    if (!key) continue;

    map.set(key, {
      green: {
        heading: benchmark.green_heading || DEFAULT_BENCHMARK_ACTION_LIBRARY.default.green?.heading,
        intro: benchmark.green_intro || DEFAULT_BENCHMARK_ACTION_LIBRARY.default.green?.intro,
        actions: parseActionsText(
          benchmark.green_actions_text,
          DEFAULT_BENCHMARK_ACTION_LIBRARY.default.green?.actions || []
        ),
      },
      orange: {
        heading:
          benchmark.orange_heading || DEFAULT_BENCHMARK_ACTION_LIBRARY.default.orange?.heading,
        intro: benchmark.orange_intro || DEFAULT_BENCHMARK_ACTION_LIBRARY.default.orange?.intro,
        actions: parseActionsText(
          benchmark.orange_actions_text,
          DEFAULT_BENCHMARK_ACTION_LIBRARY.default.orange?.actions || []
        ),
      },
      red: {
        heading: benchmark.red_heading || DEFAULT_BENCHMARK_ACTION_LIBRARY.default.red?.heading,
        intro: benchmark.red_intro || DEFAULT_BENCHMARK_ACTION_LIBRARY.default.red?.intro,
        actions: parseActionsText(
          benchmark.red_actions_text,
          DEFAULT_BENCHMARK_ACTION_LIBRARY.default.red?.actions || []
        ),
      },
    });
  }

  return map;
}

function getBenchmarkActionConfig(
  categoryName: string,
  status: BenchmarkActionTone,
  benchmarkActionMap: Map<string, BenchmarkActionConfig>
): BenchmarkActionContent {
  const normalizedCategory = normalizeBenchmarkCategoryName(categoryName);

  const exactMatch = benchmarkActionMap.get(normalizedCategory);
  if (exactMatch?.[status]) {
    return exactMatch[status] || { heading: "Suggested actions", intro: "", actions: [] };
  }

  const partialMatchKey = Array.from(benchmarkActionMap.keys()).find(
    (key) => key && normalizedCategory.includes(key)
  );

  if (partialMatchKey) {
    const partialConfig = benchmarkActionMap.get(partialMatchKey);
    if (partialConfig?.[status]) {
      return partialConfig[status] || { heading: "Suggested actions", intro: "", actions: [] };
    }
  }

  return (
    DEFAULT_BENCHMARK_ACTION_LIBRARY.default[status] || {
      heading: "Suggested actions",
      intro: "",
      actions: [],
    }
  );
}

function statusBadgeClasses(status: "green" | "orange" | "red") {
  if (status === "green") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "orange") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function statusBarClasses(status: "green" | "orange" | "red") {
  if (status === "green") return "from-emerald-500 to-emerald-400";
  if (status === "orange") return "from-amber-500 to-amber-400";
  return "from-rose-500 to-rose-400";
}

function comparisonVarianceClass(direction: "better" | "worse" | "no_change") {
  if (direction === "better") return "text-emerald-700";
  if (direction === "worse") return "text-rose-700";
  return "text-slate-600";
}

function aggregateReportsForView(
  reports: ReportWithItems[],
  view: TimeView
): GroupedPeriod[] {
  if (view === "month") {
    return [...reports]
      .sort(sortReportsOldestFirst)
      .map((report) => ({
        key: report.monthKey,
        label: report.month_label,
        yearKey: String(report.report_year),
        yearLabel: String(report.report_year),
        subKey: String(report.report_month),
        subLabel: getMonthName(report.report_month),
        reports: [report],
      }));
  }

  if (view === "quarter") {
    const grouped = new Map<string, ReportWithItems[]>();

    for (const report of reports) {
      if (!grouped.has(report.quarterKey)) grouped.set(report.quarterKey, []);
      grouped.get(report.quarterKey)?.push(report);
    }

    return Array.from(grouped.entries())
      .map(([key, groupedReports]) => {
        const first = groupedReports[0];
        return {
          key,
          label: first?.quarterLabel || key,
          yearKey: first?.financialYearKey || "",
          yearLabel: first?.financialYearLabel || "",
          subKey: String(first?.quarterNumber || ""),
          subLabel: `Q${first?.quarterNumber || ""}`,
          reports: [...groupedReports].sort(sortReportsOldestFirst),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  const grouped = new Map<string, ReportWithItems[]>();

  for (const report of reports) {
    if (!grouped.has(report.financialYearKey)) grouped.set(report.financialYearKey, []);
    grouped.get(report.financialYearKey)?.push(report);
  }

  return Array.from(grouped.entries())
    .map(([key, groupedReports]) => ({
      key,
      label: groupedReports[0]?.financialYearLabel || key,
      yearKey: key,
      yearLabel: groupedReports[0]?.financialYearLabel || key,
      subKey: key,
      subLabel: groupedReports[0]?.financialYearLabel || key,
      reports: [...groupedReports].sort(sortReportsOldestFirst),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function aggregateCategoryTrendPoints(
  categoryName: string,
  groupedPeriods: GroupedPeriod[]
): CategoryTrendPoint[] {
  return groupedPeriods.map((period) => {
    let weightedPercentNumerator = 0;
    let weightedBenchmarkNumerator = 0;
    let baseGross = 0;
    let latestStatus: "green" | "orange" | "red" = "red";

    for (const report of period.reports) {
      const item = report.items.find((entry) => entry.category_name === categoryName);
      if (!item) continue;

      weightedPercentNumerator += (item.percent / 100) * report.gross_production;
      weightedBenchmarkNumerator += (item.benchmark_percent / 100) * report.gross_production;
      baseGross += report.gross_production;
      latestStatus = item.status;
    }

    const percent = baseGross > 0 ? (weightedPercentNumerator / baseGross) * 100 : 0;
    const benchmark = baseGross > 0 ? (weightedBenchmarkNumerator / baseGross) * 100 : 0;

    return {
      key: period.key,
      label: period.subLabel,
      percent,
      benchmark,
      status: latestStatus,
    };
  });
}

function buildSelectedPeriodSummary(period: GroupedPeriod | null) {
  if (!period) {
    return {
      totalExpensePercent: 0,
      green: 0,
      orange: 0,
      red: 0,
      reportCount: 0,
    };
  }

  let grossProduction = 0;
  let totalExpenses = 0;

  const latestReport = [...period.reports].sort(sortReportsNewestFirst)[0] || null;

  for (const report of period.reports) {
    grossProduction += report.gross_production;
    totalExpenses += report.total_expenses;
  }

  return {
    totalExpensePercent: grossProduction > 0 ? (totalExpenses / grossProduction) * 100 : 0,
    green: latestReport?.items.filter((item) => item.status === "green").length || 0,
    orange: latestReport?.items.filter((item) => item.status === "orange").length || 0,
    red: latestReport?.items.filter((item) => item.status === "red").length || 0,
    reportCount: period.reports.length,
  };
}

function buildPeriodCategorySummary(period: GroupedPeriod | null, categoryName: string) {
  if (!period) {
    return {
      percent: 0,
      benchmark: 0,
      status: "red" as const,
    };
  }

  let weightedPercentNumerator = 0;
  let weightedBenchmarkNumerator = 0;
  let baseGross = 0;
  let latestStatus: "green" | "orange" | "red" = "red";

  for (const report of period.reports) {
    const item = report.items.find((entry) => entry.category_name === categoryName);
    if (!item) continue;

    weightedPercentNumerator += (item.percent / 100) * report.gross_production;
    weightedBenchmarkNumerator += (item.benchmark_percent / 100) * report.gross_production;
    baseGross += report.gross_production;
    latestStatus = item.status;
  }

  return {
    percent: baseGross > 0 ? (weightedPercentNumerator / baseGross) * 100 : 0,
    benchmark: baseGross > 0 ? (weightedBenchmarkNumerator / baseGross) * 100 : 0,
    status: latestStatus,
  };
}

function buildComparisonRows(
  periodA: GroupedPeriod | null,
  periodB: GroupedPeriod | null,
  allCategoryNames: string[]
): ComparisonCategoryRow[] {
  return allCategoryNames
    .map((category_name) => {
      const summaryA = buildPeriodCategorySummary(periodA, category_name);
      const summaryB = buildPeriodCategorySummary(periodB, category_name);
      const variance = summaryB.percent - summaryA.percent;

      return {
        category_name,
        percentA: summaryA.percent,
        percentB: summaryB.percent,
        benchmark: summaryB.benchmark || summaryA.benchmark,
        variance,
        direction:
          variance > 0 ? "worse" : variance < 0 ? "better" : "no_change",
      };
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
}

function ViewToggle({
  value,
  onChange,
}: {
  value: TimeView;
  onChange: (value: TimeView) => void;
}) {
  const options: Array<{ label: string; value: TimeView }> = [
    { label: "Month", value: "month" },
    { label: "ATO Quarter", value: "quarter" },
    { label: "Year", value: "year" },
  ];

  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-sm">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-medium transition",
            value === option.value
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:bg-white"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
        {title}
      </div>

      <div className="mt-2 break-words text-2xl font-semibold leading-tight text-slate-900">
        {value}
      </div>

      {subtitle ? (
        <div className="mt-1 break-words text-sm leading-5 text-slate-500">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ key: string; label: string }>;
}) {
  return (
    <div className="flex min-w-[180px] flex-col gap-2">
      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition focus:border-sky-400 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CompactAdvicePanel({
  categoryName,
  point,
  benchmarkActionMap,
}: {
  categoryName: string;
  point: CategoryTrendPoint;
  benchmarkActionMap: Map<string, BenchmarkActionConfig>;
}) {
  const content = getBenchmarkActionConfig(categoryName, point.status, benchmarkActionMap);
  const compactActions = content.actions.slice(0, 3);

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-slate-900">
            {content.heading || "Suggested actions"}
          </div>
          <span
            className={cn(
              "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
              statusBadgeClasses(point.status)
            )}
          >
            {point.status}
          </span>
        </div>

        <div className="mt-1 break-words text-xs font-medium text-slate-600">
          {categoryName} · {point.label}
        </div>

        {content.intro ? (
          <p className="mt-2 text-xs leading-5 text-slate-600">{content.intro}</p>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {compactActions.map((action, index) => (
          <div
            key={`${action}-${index}`}
            className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs leading-5 text-slate-700 shadow-sm"
          >
            {action}
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryTrendChart({
  title,
  points,
  benchmarkActionMap,
  selectedPeriodKey,
}: {
  title: string;
  points: CategoryTrendPoint[];
  benchmarkActionMap: Map<string, BenchmarkActionConfig>;
  selectedPeriodKey: string;
}) {
  const maxValue = Math.max(1, ...points.map((point) => Math.max(point.percent, point.benchmark)));
  const selectedPoint = points.find((point) => point.key === selectedPeriodKey) || null;
  const [adviceSelection, setAdviceSelection] = useState<AdviceSelection | null>(null);

  useEffect(() => {
    if (selectedPoint) {
      setAdviceSelection({
        categoryName: title,
        point: selectedPoint,
      });
    } else {
      setAdviceSelection(null);
    }
  }, [selectedPoint, title]);

  const normalizedTitle = normalizeBenchmarkCategoryName(title);
  const isWagesCard =
    normalizedTitle.includes("wages") ||
    normalizedTitle.includes("superannuation") ||
    normalizedTitle.includes("staff wages");

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3
            className="break-words text-sm font-semibold leading-6 text-slate-900"
            title={title}
          >
            {title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Click a bar to view a compact advice snapshot.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          {selectedPoint ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Selected
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-900">
                {selectedPoint.label}
              </div>
            </div>
          ) : null}

          {isWagesCard ? (
            <Link
              href="/practice-manager/staff-wages-overtime-analysis"
              className="inline-flex items-center rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 transition hover:bg-sky-100"
            >
              Open Wages &amp; Overtime Analysis
            </Link>
          ) : null}
        </div>
      </div>

      {points.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          No data available for this category.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="flex min-w-[620px] items-end gap-4 rounded-2xl bg-gradient-to-b from-slate-50 to-white p-3">
              {points.map((point) => {
                const barHeight = Math.max((point.percent / maxValue) * 150, 12);
                const targetBottom = (point.benchmark / maxValue) * 150;
                const isSelected = point.key === selectedPeriodKey;

                return (
                  <button
                    key={`${title}-${point.key}`}
                    type="button"
                    onClick={() =>
                      setAdviceSelection({
                        categoryName: title,
                        point,
                      })
                    }
                    className={cn(
                      "group flex w-20 shrink-0 flex-col items-center rounded-xl p-1.5 text-left transition",
                      isSelected ? "bg-sky-50 ring-1 ring-sky-200" : "hover:bg-slate-50"
                    )}
                  >
                    <div className="mb-1 text-[10px] font-semibold text-slate-700">
                      {formatPercent(point.percent)}
                    </div>

                    <div className="relative flex h-[150px] w-10 items-end rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div
                        className={cn(
                          "w-full rounded-2xl bg-gradient-to-b transition-all",
                          statusBarClasses(point.status)
                        )}
                        style={{ height: `${barHeight}px` }}
                      />

                      <div
                        className="absolute left-1 right-1 border-t-2 border-dashed border-slate-500"
                        style={{ bottom: `${targetBottom}px` }}
                      />
                    </div>

                    <div className="mt-2 w-full break-words text-center text-[11px] font-semibold leading-4 text-slate-700">
                      {point.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {adviceSelection ? (
            <CompactAdvicePanel
              categoryName={adviceSelection.categoryName}
              point={adviceSelection.point}
              benchmarkActionMap={benchmarkActionMap}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function ComparisonSection({
  periodOptions,
  selectedA,
  selectedB,
  onChangeA,
  onChangeB,
  comparisonRows,
}: {
  periodOptions: Array<{ key: string; label: string }>;
  selectedA: string;
  selectedB: string;
  onChangeA: (value: string) => void;
  onChangeB: (value: string) => void;
  comparisonRows: ComparisonCategoryRow[];
}) {
  const topRows = comparisonRows.slice(0, 8);
  const labelA = periodOptions.find((option) => option.key === selectedA)?.label || "Period A";
  const labelB = periodOptions.find((option) => option.key === selectedB)?.label || "Period B";

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Comparison</h2>
          <p className="mt-1 text-sm text-slate-600">
            Compare two selected periods and see which categories improved or worsened.
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <SelectField
            label="Compare A"
            value={selectedA}
            onChange={onChangeA}
            options={periodOptions}
          />
          <SelectField
            label="Compare B"
            value={selectedB}
            onChange={onChangeB}
            options={periodOptions}
          />
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="pb-3 pr-4 font-medium">Category</th>
              <th className="pb-3 pr-4 font-medium">{labelA}</th>
              <th className="pb-3 pr-4 font-medium">{labelB}</th>
              <th className="pb-3 pr-4 font-medium">Target</th>
              <th className="pb-3 font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {topRows.map((row) => (
              <tr key={row.category_name} className="border-b border-slate-100">
                <td
                  className="max-w-[220px] truncate py-3 pr-4 font-medium text-slate-900"
                  title={row.category_name}
                >
                  {row.category_name}
                </td>
                <td className="py-3 pr-4 text-slate-700">{formatPercent(row.percentA)}</td>
                <td className="py-3 pr-4 text-slate-700">{formatPercent(row.percentB)}</td>
                <td className="py-3 pr-4 text-slate-500">{formatPercent(row.benchmark)}</td>
                <td
                  className={cn(
                    "py-3 font-semibold",
                    comparisonVarianceClass(row.direction)
                  )}
                >
                  {formatVariance(row.variance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PracticeManagerBenchmarkClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reports, setReports] = useState<ReportWithItems[]>([]);
  const [benchmarks, setBenchmarks] = useState<ExpenseBenchmarkConfig[]>([]);

  const [timeView, setTimeView] = useState<TimeView>("month");
  const [selectedYearKey, setSelectedYearKey] = useState("");
  const [selectedSubKey, setSelectedSubKey] = useState("");

  const [compareAKey, setCompareAKey] = useState("");
  const [compareBKey, setCompareBKey] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [reportsResponse, itemsResponse, benchmarksResponse] = await Promise.all([
          supabase
            .from("xero_benchmark_reports")
            .select("*")
            .order("report_year", { ascending: true })
            .order("report_month", { ascending: true }),
          supabase.from("xero_benchmark_report_items").select("*"),
          fetch("/api/benchmarks").then(async (response) => {
            const data = await response.json().catch(() => []);
            if (!response.ok) {
              throw new Error(data?.error || "Failed to load benchmark advice");
            }
            return Array.isArray(data) ? data : [];
          }),
        ]);

        if (reportsResponse.error) throw reportsResponse.error;
        if (itemsResponse.error) throw itemsResponse.error;

        const reportRows: ReportRow[] = (reportsResponse.data || []).map((row: any) => ({
          id: row.id,
          report_month: Number(row.report_month),
          report_year: Number(row.report_year),
          month_label:
            row.month_label ||
            getMonthLabelFromParts(Number(row.report_year), Number(row.report_month)),
          gross_production: toNumber(row.gross_production),
          total_expenses: toNumber(row.total_expenses),
          total_expense_percent: toNumber(row.total_expense_percent),
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));

        const itemRows: ReportItemRow[] = (itemsResponse.data || []).map((row: any) => ({
          id: row.id,
          report_id: row.report_id,
          category_name: row.category_name,
          expense_amount: toNumber(row.expense_amount),
          percent: toNumber(row.percent),
          benchmark_percent: toNumber(row.benchmark_percent),
          variance_percent: toNumber(row.variance_percent),
          status: normalizeStatus(row.status),
          created_at: row.created_at,
          updated_at: row.updated_at,
        }));

        const itemsByReportId = itemRows.reduce<Record<string, ReportItemRow[]>>((acc, item) => {
          if (!acc[item.report_id]) acc[item.report_id] = [];
          acc[item.report_id].push(item);
          return acc;
        }, {});

        const mergedReports: ReportWithItems[] = reportRows.map((report) => {
          const quarter = getQuarterInfo(report.report_year, report.report_month);
          const fy = getFinancialYearInfo(report.report_year, report.report_month);

          return {
            ...report,
            monthKey: getMonthKey(report.report_year, report.report_month),
            quarterKey: quarter.quarterKey,
            quarterNumber: quarter.quarterNumber,
            quarterLabel: quarter.quarterLabel,
            financialYearKey: fy.financialYearKey,
            financialYearLabel: fy.financialYearLabel,
            items: (itemsByReportId[report.id] || []).sort((a, b) =>
              a.category_name.localeCompare(b.category_name)
            ),
          };
        });

        setReports(mergedReports.sort(sortReportsNewestFirst));
        setBenchmarks(benchmarksResponse as ExpenseBenchmarkConfig[]);
      } catch (err: any) {
        console.error(err);
        setError(err?.message || "Failed to load benchmark analysis.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const reportsOldestFirst = useMemo(() => [...reports].sort(sortReportsOldestFirst), [reports]);
  const benchmarkActionMap = useMemo(() => buildBenchmarkActionMap(benchmarks), [benchmarks]);

  const groupedPeriods = useMemo(
    () => aggregateReportsForView(reportsOldestFirst, timeView),
    [reportsOldestFirst, timeView]
  );

  const yearOptions = useMemo(() => {
    const unique = Array.from(
      new Map(groupedPeriods.map((period) => [period.yearKey, period.yearLabel])).entries()
    );
    return unique.map(([key, label]) => ({ key, label }));
  }, [groupedPeriods]);

  useEffect(() => {
    if (yearOptions.length === 0) {
      setSelectedYearKey("");
      return;
    }

    const exists = yearOptions.some((option) => option.key === selectedYearKey);
    if (!exists) {
      setSelectedYearKey(yearOptions[yearOptions.length - 1].key);
    }
  }, [yearOptions, selectedYearKey]);

  const subOptions = useMemo(() => {
    const filtered = groupedPeriods.filter((period) => period.yearKey === selectedYearKey);

    if (timeView === "month") {
      return filtered.sort((a, b) => Number(a.subKey) - Number(b.subKey));
    }

    if (timeView === "quarter") {
      return filtered.sort((a, b) => Number(a.subKey) - Number(b.subKey));
    }

    return filtered;
  }, [groupedPeriods, selectedYearKey, timeView]);

  useEffect(() => {
    if (subOptions.length === 0) {
      setSelectedSubKey("");
      return;
    }

    if (timeView === "month") {
      const now = new Date();
      const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousYear = String(previousMonthDate.getFullYear());
      const previousMonth = String(previousMonthDate.getMonth() + 1);

      if (selectedYearKey === previousYear) {
        const previousMonthOption = subOptions.find((option) => option.subKey === previousMonth);
        if (previousMonthOption) {
          setSelectedSubKey((current) =>
            current && subOptions.some((option) => option.subKey === current)
              ? current
              : previousMonthOption.subKey
          );
          return;
        }
      }
    }

    const exists = subOptions.some((option) => option.subKey === selectedSubKey);
    if (!exists) {
      setSelectedSubKey(subOptions[subOptions.length - 1].subKey);
    }
  }, [subOptions, selectedSubKey, selectedYearKey, timeView]);

  const selectedPeriod = useMemo(() => {
    if (timeView === "year") {
      return groupedPeriods.find((period) => period.yearKey === selectedYearKey) || null;
    }

    return (
      groupedPeriods.find(
        (period) =>
          period.yearKey === selectedYearKey && period.subKey === selectedSubKey
      ) || null
    );
  }, [groupedPeriods, selectedYearKey, selectedSubKey, timeView]);

  const visiblePeriods = useMemo(() => {
    if (timeView === "year") {
      return groupedPeriods;
    }

    if (!selectedYearKey) return groupedPeriods;
    return groupedPeriods.filter((period) => period.yearKey === selectedYearKey);
  }, [groupedPeriods, selectedYearKey, timeView]);

  const comparisonOptions = useMemo(() => {
    if (timeView === "year") {
      return groupedPeriods.map((period) => ({ key: period.key, label: period.label }));
    }

    return visiblePeriods.map((period) => ({ key: period.key, label: period.label }));
  }, [groupedPeriods, visiblePeriods, timeView]);

  useEffect(() => {
    if (comparisonOptions.length === 0) {
      setCompareAKey("");
      setCompareBKey("");
      return;
    }

    const existsA = comparisonOptions.some((option) => option.key === compareAKey);
    const nextA = existsA ? compareAKey : comparisonOptions[0].key;
    if (nextA !== compareAKey) {
      setCompareAKey(nextA);
    }

    const existsB = comparisonOptions.some(
      (option) => option.key === compareBKey && option.key !== nextA
    );
    if (!existsB) {
      const fallbackB =
        comparisonOptions.find((option) => option.key !== nextA)?.key || nextA;
      setCompareBKey(fallbackB);
    }
  }, [comparisonOptions, compareAKey, compareBKey]);

  const categoryNames = useMemo(() => {
    return Array.from(
      new Set(reports.flatMap((report) => report.items.map((item) => item.category_name)))
    ).sort((a, b) => a.localeCompare(b));
  }, [reports]);

  const categoryTrends = useMemo(() => {
    return categoryNames.map((categoryName) => ({
      categoryName,
      points: aggregateCategoryTrendPoints(categoryName, visiblePeriods),
    }));
  }, [categoryNames, visiblePeriods]);

  const selectedSummary = useMemo(() => buildSelectedPeriodSummary(selectedPeriod), [selectedPeriod]);

  const comparePeriodA = useMemo(
    () =>
      comparisonOptions.find((option) => option.key === compareAKey)?.key
        ? (timeView === "year" ? groupedPeriods : visiblePeriods).find(
            (period) => period.key === compareAKey
          ) || null
        : null,
    [comparisonOptions, compareAKey, groupedPeriods, visiblePeriods, timeView]
  );

  const comparePeriodB = useMemo(
    () =>
      comparisonOptions.find((option) => option.key === compareBKey)?.key
        ? (timeView === "year" ? groupedPeriods : visiblePeriods).find(
            (period) => period.key === compareBKey
          ) || null
        : null,
    [comparisonOptions, compareBKey, groupedPeriods, visiblePeriods, timeView]
  );

  const comparisonRows = useMemo(
    () => buildComparisonRows(comparePeriodA, comparePeriodB, categoryNames),
    [comparePeriodA, comparePeriodB, categoryNames]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
        <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
          <section className="rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-sm backdrop-blur">
            <div className="text-lg font-semibold text-slate-900">Loading benchmark analysis...</div>
            <div className="mt-2 text-sm text-slate-500">
              Fetching benchmark reports and category percentages.
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
        <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
          <section className="rounded-3xl border border-rose-200 bg-rose-50 p-8 shadow-sm">
            <div className="text-lg font-semibold text-rose-700">Could not load benchmark analysis</div>
            <div className="mt-2 text-sm text-rose-600">{error}</div>
          </section>
        </div>
      </main>
    );
  }

  if (reports.length === 0) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
        <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
          <section className="rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-sm backdrop-blur">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              Benchmark Analysis
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              No saved benchmark reports yet. Upload and process your Xero data first.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <section className="mb-8 overflow-hidden rounded-3xl border border-slate-200 bg-white/80 p-8 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">
                Practice Manager
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                Benchmark Analysis
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600">
                Review benchmark percentages with compact category snapshots, filtered period views,
                and side-by-side comparisons.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                title="Categories"
                value={String(categoryNames.length)}
                subtitle="Available categories"
              />
              <SummaryCard
                title="View"
                value={
                  timeView === "month"
                    ? "Month"
                    : timeView === "quarter"
                    ? "ATO Quarter"
                    : "Year"
                }
                subtitle="Current grouping"
              />
              <SummaryCard
                title="Selected"
                value={selectedPeriod?.label || "-"}
                subtitle="Current period"
              />
              <SummaryCard
                title="Expense %"
                value={formatPercent(selectedSummary.totalExpensePercent)}
                subtitle="Selected period total"
              />
            </div>
          </div>
        </section>

        <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Filters</h2>
              <p className="mt-1 text-sm text-slate-600">
                Choose a year first, then select a month or quarter. Charts only show periods from the selected year group.
              </p>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <ViewToggle value={timeView} onChange={setTimeView} />

              <SelectField
                label={timeView === "year" ? "Financial Year" : "Year"}
                value={selectedYearKey}
                onChange={setSelectedYearKey}
                options={yearOptions}
              />

              {timeView === "month" ? (
                <SelectField
                  label="Month"
                  value={selectedSubKey}
                  onChange={setSelectedSubKey}
                  options={subOptions.map((option) => ({
                    key: option.subKey,
                    label: option.subLabel,
                  }))}
                />
              ) : null}

              {timeView === "quarter" ? (
                <SelectField
                  label="ATO Quarter"
                  value={selectedSubKey}
                  onChange={setSelectedSubKey}
                  options={subOptions.map((option) => ({
                    key: option.subKey,
                    label: option.subLabel,
                  }))}
                />
              ) : null}
            </div>
          </div>
        </section>

        <section className="mb-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Selected Period"
              value={selectedPeriod?.label || "-"}
              subtitle={`${selectedSummary.reportCount} month${
                selectedSummary.reportCount === 1 ? "" : "s"
              } included`}
            />
            <SummaryCard title="Green" value={String(selectedSummary.green)} subtitle="Categories" />
            <SummaryCard title="Orange" value={String(selectedSummary.orange)} subtitle="Categories" />
            <SummaryCard title="Red" value={String(selectedSummary.red)} subtitle="Categories" />
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Benchmark Trends</h2>
              <p className="mt-1 text-sm text-slate-600">
                Compact chart cards showing only periods from the selected year group.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categoryTrends.map((category) => (
              <CategoryTrendChart
                key={category.categoryName}
                title={category.categoryName}
                points={category.points}
                benchmarkActionMap={benchmarkActionMap}
                selectedPeriodKey={selectedPeriod?.key || ""}
              />
            ))}
          </div>
        </section>

        <ComparisonSection
          periodOptions={comparisonOptions}
          selectedA={compareAKey}
          selectedB={compareBKey}
          onChangeA={setCompareAKey}
          onChangeB={setCompareBKey}
          comparisonRows={comparisonRows}
        />
      </div>
    </main>
  );
}