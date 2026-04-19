'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

type ViewMode = 'single-month' | 'compare-periods' | 'trends';
type CompareMode = 'month' | 'quarter' | 'year';
type TrendRange = 'all' | 'last-6-months' | 'current-fy';

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
  status: 'green' | 'orange' | 'red';
  created_at: string;
  updated_at: string;
};

type ReportWithItems = ReportRow & {
  monthKey: string;
  quarterKey: string;
  quarterLabel: string;
  financialYearKey: string;
  financialYearLabel: string;
  items: ReportItemRow[];
};

type CompareOption = {
  key: string;
  label: string;
  reportCount: number;
  reportIds: string[];
  totalExpenses: number;
  grossProduction: number;
  totalExpensePercent: number;
  categoryTotals: {
    category_name: string;
    expense_amount: number;
    percent: number;
    benchmark_percent: number;
    variance_percent: number;
  }[];
};

type CompareRow = {
  category_name: string;
  amountA: number;
  amountB: number;
  percentA: number;
  percentB: number;
  benchmarkA: number;
  benchmarkB: number;
  varianceToTargetA: number;
  varianceToTargetB: number;
  variance: number;
  direction: 'better' | 'worse' | 'no_change';
};

const PRACTICE_NAME = 'Focus Dental Specialists';
const PRACTICE_LOGO_SRC = '/practice-logo.png';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${(value || 0).toFixed(2)}%`;
}

function formatPercentVariance(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatCurrencyVariance(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCurrency(value)}`;
}

function formatExportDate(date: Date) {
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function getMonthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthLabelFromParts(year: number, month: number) {
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat('en-AU', {
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function getMonthName(month: number) {
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
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
  const start = String(financialYearStart % 100).padStart(2, '0');
  const end = String((financialYearStart + 1) % 100).padStart(2, '0');
  return `${start}/${end}FY`;
}

function getQuarterInfo(year: number, month: number) {
  const quarter = getFinancialQuarter(month);
  const financialYearStart = getFinancialYearStart(year, month);

  return {
    quarterKey: `${financialYearStart}-Q${quarter}`,
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

function normalizeStatus(value: unknown): 'green' | 'orange' | 'red' {
  if (value === 'green' || value === 'orange' || value === 'red') return value;
  return 'red';
}

function statusClasses(status: 'green' | 'orange' | 'red') {
  if (status === 'green') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'orange') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
}

function varianceTextClass(direction: 'better' | 'worse' | 'no_change') {
  if (direction === 'better') return 'text-emerald-700';
  if (direction === 'worse') return 'text-rose-700';
  return 'text-slate-600';
}

function varianceChipClass(direction: 'better' | 'worse' | 'no_change') {
  if (direction === 'better') {
    return 'border border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (direction === 'worse') {
    return 'border border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border border-slate-200 bg-slate-100 text-slate-600';
}

function targetChipClass(value: number) {
  if (value <= 0) return 'border border-slate-200 bg-slate-100 text-slate-600';
  return 'border border-blue-200 bg-blue-50 text-blue-700';
}

function getDirectionLabel(direction: 'better' | 'worse' | 'no_change') {
  if (direction === 'better') return 'Improved';
  if (direction === 'worse') return 'Worsened';
  return 'No change';
}

function compareDirectionFromVariance(value: number): 'better' | 'worse' | 'no_change' {
  if (value > 0) return 'worse';
  if (value < 0) return 'better';
  return 'no_change';
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

function buildCompareOption(key: string, label: string, reports: ReportWithItems[]): CompareOption {
  const sortedReports = [...reports].sort(sortReportsOldestFirst);
  const grossProduction = sortedReports.reduce((sum, report) => sum + report.gross_production, 0);
  const totalExpenses = sortedReports.reduce((sum, report) => sum + report.total_expenses, 0);

  const categoryMap = new Map<
    string,
    {
      expense_amount: number;
      weightedPercentNumerator: number;
      weightedBenchmarkNumerator: number;
      baseGross: number;
    }
  >();

  for (const report of sortedReports) {
    for (const item of report.items) {
      const existing = categoryMap.get(item.category_name) || {
        expense_amount: 0,
        weightedPercentNumerator: 0,
        weightedBenchmarkNumerator: 0,
        baseGross: 0,
      };

      existing.expense_amount += item.expense_amount;
      existing.weightedPercentNumerator += (item.percent / 100) * report.gross_production;
      existing.weightedBenchmarkNumerator += (item.benchmark_percent / 100) * report.gross_production;
      existing.baseGross += report.gross_production;

      categoryMap.set(item.category_name, existing);
    }
  }

  const categoryTotals = Array.from(categoryMap.entries())
    .map(([category_name, totals]) => {
      const percent =
        totals.baseGross > 0 ? (totals.weightedPercentNumerator / totals.baseGross) * 100 : 0;
      const benchmark_percent =
        totals.baseGross > 0 ? (totals.weightedBenchmarkNumerator / totals.baseGross) * 100 : 0;

      return {
        category_name,
        expense_amount: totals.expense_amount,
        percent,
        benchmark_percent,
        variance_percent: percent - benchmark_percent,
      };
    })
    .sort((a, b) => b.percent - a.percent);

  return {
    key,
    label,
    reportCount: sortedReports.length,
    reportIds: sortedReports.map((report) => report.id),
    grossProduction,
    totalExpenses,
    totalExpensePercent: grossProduction > 0 ? (totalExpenses / grossProduction) * 100 : 0,
    categoryTotals,
  };
}

function buildMonthOptions(reports: ReportWithItems[]) {
  return [...reports]
    .sort(sortReportsNewestFirst)
    .map((report) => buildCompareOption(report.monthKey, report.month_label, [report]));
}

function buildQuarterOptions(reports: ReportWithItems[]) {
  const grouped = new Map<string, ReportWithItems[]>();

  for (const report of reports) {
    if (!grouped.has(report.quarterKey)) grouped.set(report.quarterKey, []);
    grouped.get(report.quarterKey)?.push(report);
  }

  return Array.from(grouped.entries())
    .map(([key, groupedReports]) =>
      buildCompareOption(key, groupedReports[0]?.quarterLabel || key, groupedReports)
    )
    .sort((a, b) => b.key.localeCompare(a.key));
}

function buildYearOptions(reports: ReportWithItems[]) {
  const grouped = new Map<string, ReportWithItems[]>();

  for (const report of reports) {
    if (!grouped.has(report.financialYearKey)) grouped.set(report.financialYearKey, []);
    grouped.get(report.financialYearKey)?.push(report);
  }

  return Array.from(grouped.entries())
    .map(([key, groupedReports]) =>
      buildCompareOption(key, groupedReports[0]?.financialYearLabel || key, groupedReports)
    )
    .sort((a, b) => Number(b.key) - Number(a.key));
}

function getFilteredTrendReports(reports: ReportWithItems[], range: TrendRange) {
  const sorted = [...reports].sort(sortReportsOldestFirst);

  if (range === 'all') return sorted;
  if (range === 'last-6-months') return sorted.slice(-6);
  if (sorted.length === 0) return sorted;

  const latest = sorted[sorted.length - 1];
  return sorted.filter((report) => report.financialYearKey === latest.financialYearKey);
}

function Card({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}) {
  const options: Array<{ label: string; value: ViewMode }> = [
    { label: 'Single Month', value: 'single-month' },
    { label: 'Compare Periods', value: 'compare-periods' },
    { label: 'Trends', value: 'trends' },
  ];

  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-xl px-4 py-2 text-sm font-medium transition',
            value === option.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CompareModeToggle({
  value,
  onChange,
}: {
  value: CompareMode;
  onChange: (value: CompareMode) => void;
}) {
  const options: Array<{ label: string; value: CompareMode }> = [
    { label: 'Month', value: 'month' },
    { label: 'Quarter', value: 'quarter' },
    { label: 'Year', value: 'year' },
  ];

  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-xl px-3 py-2 text-sm font-medium transition',
            value === option.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TrendRangeToggle({
  value,
  onChange,
}: {
  value: TrendRange;
  onChange: (value: TrendRange) => void;
}) {
  const options: Array<{ label: string; value: TrendRange }> = [
    { label: 'All months', value: 'all' },
    { label: 'Last 6 months', value: 'last-6-months' },
    { label: 'Current FY', value: 'current-fy' },
  ];

  return (
    <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-xl px-3 py-2 text-sm font-medium transition',
            value === option.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StatusSummary({ items }: { items: ReportItemRow[] }) {
  const counts = {
    green: items.filter((item) => item.status === 'green').length,
    orange: items.filter((item) => item.status === 'orange').length,
    red: items.filter((item) => item.status === 'red').length,
  };

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {(['green', 'orange', 'red'] as const).map((status) => (
        <div key={status} className={cn('rounded-2xl border p-4', statusClasses(status))}>
          <div className="text-sm font-medium capitalize">{status}</div>
          <div className="mt-1 text-2xl font-semibold">{counts[status]}</div>
          <div className="text-sm opacity-80">categories</div>
        </div>
      ))}
    </div>
  );
}

function HorizontalBarList({
  data,
}: {
  data: Array<{ label: string; value: number; target?: number }>;
}) {
  const maxValue = Math.max(1, ...data.map((item) => Math.max(item.value, item.target || 0)));

  return (
    <div className="space-y-4">
      {data.map((item, index) => {
        const width = (item.value / maxValue) * 100;
        const targetLeft = item.target !== undefined ? (item.target / maxValue) * 100 : null;

        return (
          <div key={`${item.label}-${index}`}>
            <div className="mb-2 flex items-center justify-between gap-4">
              <div className="truncate text-sm font-medium text-slate-700">{item.label}</div>
              <div className="shrink-0 text-sm text-slate-500">{formatCurrency(item.value)}</div>
            </div>
            <div className="relative h-3 rounded-full bg-slate-100">
              <div
                className="h-3 rounded-full bg-slate-800"
                style={{ width: `${Math.max(width, 2)}%` }}
              />
              {targetLeft !== null ? (
                <div
                  className="absolute top-[-3px] h-5 w-[2px] bg-blue-500"
                  style={{ left: `${targetLeft}%` }}
                  title={`Target ${formatCurrency(item.target || 0)}`}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DualLineChart({
  data,
  amountKey,
  percentKey,
  targetKey,
  amountLabel,
  percentLabel,
  targetLabel,
}: {
  data: Array<Record<string, unknown>>;
  amountKey: string;
  percentKey: string;
  targetKey?: string;
  amountLabel: string;
  percentLabel: string;
  targetLabel?: string;
}) {
  const width = 860;
  const height = 300;
  const padding = 36;

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);

  if (data.length === 0) {
    return <div className="text-sm text-slate-500">No chart data available.</div>;
  }

  const amountValues = data.map((row) => toNumber(row[amountKey]));
  const percentValues = data.map((row) => toNumber(row[percentKey]));
  const targetValues = targetKey ? data.map((row) => toNumber(row[targetKey])) : [];

  const maxAmount = Math.max(1, ...amountValues);
  const maxPercent = Math.max(1, ...percentValues, ...targetValues);
  const xStep = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;

  const amountPoints = data
    .map((row, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (toNumber(row[amountKey]) / maxAmount) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const percentPoints = data
    .map((row, index) => {
      const x = padding + index * xStep;
      const y = height - padding - (toNumber(row[percentKey]) / maxPercent) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const targetPoints =
    targetKey &&
    data
      .map((row, index) => {
        const x = padding + index * xStep;
        const y = height - padding - (toNumber(row[targetKey]) / maxPercent) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(' ');

  const hoveredRow = hoveredIndex !== null ? data[hoveredIndex] : null;

  function updateTooltipPosition(
    event:
      | React.MouseEvent<SVGRectElement>
      | React.MouseEvent<SVGCircleElement>
      | React.MouseEvent<SVGSVGElement>,
    index: number
  ) {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();

    if (!bounds) {
      setHoveredIndex(index);
      return;
    }

    let x = event.clientX - bounds.left + 14;
    let y = event.clientY - bounds.top - 14;

    const tooltipWidth = 220;
    const tooltipHeight = targetKey ? 110 : 88;

    if (x + tooltipWidth > bounds.width - 8) {
      x = bounds.width - tooltipWidth - 8;
    }

    if (y + tooltipHeight > bounds.height - 8) {
      y = bounds.height - tooltipHeight - 8;
    }

    if (x < 8) x = 8;
    if (y < 8) y = 8;

    setHoveredIndex(index);
    setTooltipPosition({ x, y });
  }

  function clearTooltip() {
    setHoveredIndex(null);
    setTooltipPosition(null);
  }

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2 text-slate-700">
          <span className="inline-block h-3 w-3 rounded-full bg-slate-800" />
          {amountLabel}
        </div>
        <div className="flex items-center gap-2 text-slate-700">
          <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" />
          {percentLabel}
        </div>
        {targetKey && targetLabel ? (
          <div className="flex items-center gap-2 text-slate-700">
            <span className="inline-block h-3 w-3 rounded-full bg-blue-500" />
            {targetLabel}
          </div>
        ) : null}
      </div>

      <div className="relative">
        {hoveredRow && tooltipPosition ? (
          <div
            className="pointer-events-none absolute z-20 w-[220px] rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm shadow-xl backdrop-blur"
            style={{
              left: tooltipPosition.x,
              top: tooltipPosition.y,
            }}
          >
            <div className="font-semibold text-slate-900">
              {String(hoveredRow.label ?? '')}
            </div>

            <div className="mt-2 space-y-1 text-slate-600">
              <div>
                <span className="font-medium text-slate-900">{amountLabel}:</span>{' '}
                {formatCurrency(toNumber(hoveredRow[amountKey]))}
              </div>

              <div>
                <span className="font-medium text-slate-900">{percentLabel}:</span>{' '}
                {formatPercent(toNumber(hoveredRow[percentKey]))}
              </div>

              {targetKey && targetLabel ? (
                <div>
                  <span className="font-medium text-slate-900">{targetLabel}:</span>{' '}
                  {formatPercent(toNumber(hoveredRow[targetKey]))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[760px]"
          onMouseLeave={clearTooltip}
        >
          <line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke="#CBD5E1"
          />
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={height - padding}
            stroke="#CBD5E1"
          />

          {hoveredIndex !== null ? (
            <line
              x1={padding + hoveredIndex * xStep}
              y1={padding}
              x2={padding + hoveredIndex * xStep}
              y2={height - padding}
              stroke="#CBD5E1"
              strokeDasharray="4 4"
            />
          ) : null}

          <polyline fill="none" stroke="#0F172A" strokeWidth="3" points={amountPoints} />
          <polyline fill="none" stroke="#10B981" strokeWidth="3" points={percentPoints} />
          {targetPoints ? (
            <polyline
              fill="none"
              stroke="#3B82F6"
              strokeWidth="3"
              strokeDasharray="6 4"
              points={targetPoints}
            />
          ) : null}

          {data.map((row, index) => {
            const x = padding + index * xStep;
            const amountY =
              height - padding - (toNumber(row[amountKey]) / maxAmount) * (height - padding * 2);
            const percentY =
              height - padding - (toNumber(row[percentKey]) / maxPercent) * (height - padding * 2);
            const targetY =
              targetKey
                ? height - padding - (toNumber(row[targetKey]) / maxPercent) * (height - padding * 2)
                : null;

            const isHovered = hoveredIndex === index;

            return (
              <g key={index}>
                <rect
                  x={x - Math.max(xStep / 2, 18)}
                  y={padding}
                  width={Math.max(xStep, 36)}
                  height={height - padding * 2}
                  fill="transparent"
                  onMouseEnter={(event) => updateTooltipPosition(event, index)}
                  onMouseMove={(event) => updateTooltipPosition(event, index)}
                />

                <circle
                  cx={x}
                  cy={amountY}
                  r={isHovered ? 6 : 4}
                  fill="#0F172A"
                  className="cursor-pointer transition-all"
                  onMouseEnter={(event) => updateTooltipPosition(event, index)}
                  onMouseMove={(event) => updateTooltipPosition(event, index)}
                />
                <circle
                  cx={x}
                  cy={percentY}
                  r={isHovered ? 6 : 4}
                  fill="#10B981"
                  className="cursor-pointer transition-all"
                  onMouseEnter={(event) => updateTooltipPosition(event, index)}
                  onMouseMove={(event) => updateTooltipPosition(event, index)}
                />
                {targetY !== null ? (
                  <circle
                    cx={x}
                    cy={targetY}
                    r={isHovered ? 6 : 4}
                    fill="#3B82F6"
                    className="cursor-pointer transition-all"
                    onMouseEnter={(event) => updateTooltipPosition(event, index)}
                    onMouseMove={(event) => updateTooltipPosition(event, index)}
                  />
                ) : null}

                <text
                  x={x}
                  y={height - 12}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#64748B"
                >
                  {String(row.label ?? '')}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SmallComparisonBarChart({
  titleA,
  titleB,
  amountA,
  amountB,
  percentA,
  percentB,
  targetA,
  targetB,
}: {
  titleA: string;
  titleB: string;
  amountA: number;
  amountB: number;
  percentA: number;
  percentB: number;
  targetA?: number;
  targetB?: number;
}) {
  const amountMax = Math.max(1, amountA, amountB);
  const percentMax = Math.max(1, percentA, percentB, targetA || 0, targetB || 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <div className="mb-3 text-sm font-medium text-slate-700">Expense Amount</div>
        <div className="space-y-4">
          {[
            { key: 'amount-a', label: titleA, value: amountA },
            { key: 'amount-b', label: titleB, value: amountB },
          ].map((item) => (
            <div key={item.key}>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <div className="font-medium text-slate-700">{item.label}</div>
                <div className="text-slate-500">{formatCurrency(item.value)}</div>
              </div>
              <div className="h-4 rounded-full bg-slate-100">
                <div
                  className="h-4 rounded-full bg-slate-800"
                  style={{ width: `${Math.max((item.value / amountMax) * 100, 2)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 text-sm font-medium text-slate-700">Expense % vs Target</div>
        <div className="space-y-4">
          {[
            { key: 'percent-a', label: titleA, value: percentA, target: targetA || 0 },
            { key: 'percent-b', label: titleB, value: percentB, target: targetB || 0 },
          ].map((item) => (
            <div key={item.key}>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <div className="font-medium text-slate-700">{item.label}</div>
                <div className="text-slate-500">
                  {formatPercent(item.value)} / target {formatPercent(item.target)}
                </div>
              </div>
              <div className="relative h-4 rounded-full bg-slate-100">
                <div
                  className="h-4 rounded-full bg-emerald-500"
                  style={{ width: `${Math.max((item.value / percentMax) * 100, 2)}%` }}
                />
                <div
                  className="absolute top-[-2px] h-5 w-[2px] bg-blue-500"
                  style={{ left: `${(item.target / percentMax) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProblemList({
  title,
  rows,
  type,
}: {
  title: string;
  rows: Array<{ label: string; value: number; subtext?: string }>;
  type: 'currency' | 'percent';
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 text-sm font-semibold text-slate-900">{title}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500">No data available.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium text-slate-900">{row.label}</div>
                <div className="text-sm font-semibold text-rose-700">
                  {type === 'currency' ? formatCurrency(row.value) : formatPercent(row.value)}
                </div>
              </div>
              {row.subtext ? <div className="mt-1 text-xs text-slate-500">{row.subtext}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExpenseReportsClient() {
  const singleMonthExportRef = useRef<HTMLDivElement | null>(null);
  const compareExportRef = useRef<HTMLDivElement | null>(null);
  const trendsExportRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [showPdfHeader, setShowPdfHeader] = useState(false);
  const [logoVisibleInPdf, setLogoVisibleInPdf] = useState(true);

  const [reports, setReports] = useState<ReportWithItems[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('single-month');

  const [selectedMonthKey, setSelectedMonthKey] = useState('');
  const [selectedBillingYear, setSelectedBillingYear] = useState('');
  const [selectedBillingMonth, setSelectedBillingMonth] = useState('');
  const [compareMode, setCompareMode] = useState<CompareMode>('quarter');
  const [selectedCompareA, setSelectedCompareA] = useState('');
  const [selectedCompareB, setSelectedCompareB] = useState('');
  const [selectedCompareCategory, setSelectedCompareCategory] = useState('');
  const [selectedMonthCompareA, setSelectedMonthCompareA] = useState('');
  const [selectedMonthCompareB, setSelectedMonthCompareB] = useState('');
  const [selectedMonthCategoryA, setSelectedMonthCategoryA] = useState('');
  const [selectedMonthCategoryB, setSelectedMonthCategoryB] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [trendRange, setTrendRange] = useState<TrendRange>('all');

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [reportsResponse, itemsResponse] = await Promise.all([
          supabase
            .from('xero_benchmark_reports')
            .select('*')
            .order('report_year', { ascending: true })
            .order('report_month', { ascending: true }),
          supabase.from('xero_benchmark_report_items').select('*'),
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
            quarterLabel: quarter.quarterLabel,
            financialYearKey: fy.financialYearKey,
            financialYearLabel: fy.financialYearLabel,
            items: (itemsByReportId[report.id] || []).sort((a, b) => b.expense_amount - a.expense_amount),
          };
        });

        setReports(mergedReports.sort(sortReportsNewestFirst));
      } catch (err: any) {
        console.error(err);
        setError(err?.message || 'Failed to load expense reports.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const reportsOldestFirst = useMemo(() => [...reports].sort(sortReportsOldestFirst), [reports]);

  const filteredTrendReports = useMemo(
    () => getFilteredTrendReports(reportsOldestFirst, trendRange),
    [reportsOldestFirst, trendRange]
  );

  const monthOptions = useMemo(
    () => reports.map((report) => ({ value: report.monthKey, label: report.month_label })),
    [reports]
  );

  const billingYearOptions = useMemo(
    () => Array.from(new Set(reports.map((report) => report.report_year))).sort((a, b) => b - a),
    [reports]
  );

  const billingMonthOptions = useMemo(() => {
    if (!selectedBillingYear) return [];

    return reports
      .filter((report) => report.report_year === Number(selectedBillingYear))
      .map((report) => ({
        value: String(report.report_month),
        label: getMonthName(report.report_month),
        monthNumber: report.report_month,
      }))
      .sort((a, b) => a.monthNumber - b.monthNumber);
  }, [reports, selectedBillingYear]);

  const compareOptions = useMemo(() => {
    if (compareMode === 'month') return buildMonthOptions(reports);
    if (compareMode === 'year') return buildYearOptions(reports);
    return buildQuarterOptions(reports);
  }, [reports, compareMode]);

  const categories = useMemo(
    () =>
      Array.from(new Set(reports.flatMap((report) => report.items.map((item) => item.category_name)))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [reports]
  );

  useEffect(() => {
    if (!selectedMonthKey && monthOptions.length > 0) {
      setSelectedMonthKey(monthOptions[0].value);
    }
  }, [monthOptions, selectedMonthKey]);

  useEffect(() => {
    if (!selectedBillingYear && billingYearOptions.length > 0) {
      setSelectedBillingYear(String(billingYearOptions[0]));
    }
  }, [billingYearOptions, selectedBillingYear]);

  useEffect(() => {
    if (!selectedBillingYear) return;

    const currentMonth = new Date().getMonth() + 1;
    const availableMonths = billingMonthOptions.map((option) => option.monthNumber);

    if (availableMonths.length === 0) {
      if (selectedBillingMonth !== '') setSelectedBillingMonth('');
      return;
    }

    const nextMonth =
      availableMonths.includes(currentMonth) ? String(currentMonth) : String(availableMonths[0]);

    if (!selectedBillingMonth || !availableMonths.includes(Number(selectedBillingMonth))) {
      setSelectedBillingMonth(nextMonth);
    }
  }, [billingMonthOptions, selectedBillingMonth, selectedBillingYear]);

  useEffect(() => {
    if (!selectedBillingYear || !selectedBillingMonth) return;

    const nextMonthKey = getMonthKey(Number(selectedBillingYear), Number(selectedBillingMonth));

    if (nextMonthKey !== selectedMonthKey) {
      setSelectedMonthKey(nextMonthKey);
    }
  }, [selectedBillingYear, selectedBillingMonth, selectedMonthKey]);

  useEffect(() => {
    if (!selectedCategory && categories.length > 0) setSelectedCategory(categories[0]);
    if (!selectedCompareCategory && categories.length > 0) setSelectedCompareCategory(categories[0]);
    if (!selectedMonthCategoryA && categories.length > 0) setSelectedMonthCategoryA(categories[0]);
    if (!selectedMonthCategoryB && categories.length > 1) setSelectedMonthCategoryB(categories[1]);
    else if (!selectedMonthCategoryB && categories.length > 0) setSelectedMonthCategoryB(categories[0]);
  }, [
    categories,
    selectedCategory,
    selectedCompareCategory,
    selectedMonthCategoryA,
    selectedMonthCategoryB,
  ]);

  useEffect(() => {
    const selectedReport = reports.find((report) => report.monthKey === selectedMonthKey);
    if (!selectedReport) return;

    const nextYear = String(selectedReport.report_year);
    const nextMonth = String(selectedReport.report_month);

    if (nextYear !== selectedBillingYear) {
      setSelectedBillingYear(nextYear);
    }

    if (nextMonth !== selectedBillingMonth) {
      setSelectedBillingMonth(nextMonth);
    }
  }, [reports, selectedMonthKey, selectedBillingYear, selectedBillingMonth]);

  useEffect(() => {
    if (compareOptions.length === 0) {
      setSelectedCompareA('');
      setSelectedCompareB('');
      return;
    }

    setSelectedCompareA((current) => {
      const exists = compareOptions.some((option) => option.key === current);
      return exists ? current : compareOptions[0]?.key || '';
    });

    setSelectedCompareB((current) => {
      const exists = compareOptions.some((option) => option.key === current && option.key !== selectedCompareA);
      if (exists && current !== selectedCompareA) return current;

      const firstDifferent = compareOptions.find(
        (option) => option.key !== (selectedCompareA || compareOptions[0]?.key)
      );
      return firstDifferent?.key || compareOptions[0]?.key || '';
    });
  }, [compareOptions, selectedCompareA]);

  useEffect(() => {
    if (monthOptions.length === 0) {
      setSelectedMonthCompareA('');
      setSelectedMonthCompareB('');
      return;
    }

    setSelectedMonthCompareA((current) => {
      const exists = monthOptions.some((option) => option.value === current);
      return exists ? current : monthOptions[0]?.value || '';
    });

    setSelectedMonthCompareB((current) => {
      const exists = monthOptions.some(
        (option) => option.value === current && option.value !== selectedMonthCompareA
      );
      if (exists && current !== selectedMonthCompareA) return current;

      const firstDifferent = monthOptions.find(
        (option) => option.value !== (selectedMonthCompareA || monthOptions[0]?.value)
      );
      return firstDifferent?.value || monthOptions[0]?.value || '';
    });
  }, [monthOptions, selectedMonthCompareA]);

  useEffect(() => {
    if (selectedCompareA && selectedCompareA === selectedCompareB) {
      const firstDifferent = compareOptions.find((option) => option.key !== selectedCompareA);
      if (firstDifferent) setSelectedCompareB(firstDifferent.key);
    }
  }, [selectedCompareA, selectedCompareB, compareOptions]);

  useEffect(() => {
    if (selectedMonthCompareA && selectedMonthCompareA === selectedMonthCompareB) {
      const firstDifferent = monthOptions.find((option) => option.value !== selectedMonthCompareA);
      if (firstDifferent) setSelectedMonthCompareB(firstDifferent.value);
    }
  }, [selectedMonthCompareA, selectedMonthCompareB, monthOptions]);

  const selectedMonthReport = useMemo(
    () => reports.find((report) => report.monthKey === selectedMonthKey) || null,
    [reports, selectedMonthKey]
  );

  const selectedCompareOptionA = useMemo(
    () => compareOptions.find((option) => option.key === selectedCompareA) || null,
    [compareOptions, selectedCompareA]
  );

  const selectedCompareOptionB = useMemo(
    () => compareOptions.find((option) => option.key === selectedCompareB) || null,
    [compareOptions, selectedCompareB]
  );

  const compareSummary = useMemo(() => {
    if (!selectedCompareOptionA || !selectedCompareOptionB) return null;

    return {
      expensePercentVariance:
        selectedCompareOptionB.totalExpensePercent - selectedCompareOptionA.totalExpensePercent,
      expenseAmountVariance:
        selectedCompareOptionB.totalExpenses - selectedCompareOptionA.totalExpenses,
      productionVariance:
        selectedCompareOptionB.grossProduction - selectedCompareOptionA.grossProduction,
    };
  }, [selectedCompareOptionA, selectedCompareOptionB]);

  const compareRows = useMemo<CompareRow[]>(() => {
    if (!selectedCompareOptionA || !selectedCompareOptionB) return [];

    const mapA = new Map(selectedCompareOptionA.categoryTotals.map((item) => [item.category_name, item]));
    const mapB = new Map(selectedCompareOptionB.categoryTotals.map((item) => [item.category_name, item]));

    const allCategoryNames = Array.from(
      new Set([
        ...selectedCompareOptionA.categoryTotals.map((item) => item.category_name),
        ...selectedCompareOptionB.categoryTotals.map((item) => item.category_name),
      ])
    );

    return allCategoryNames
      .map((category_name) => {
        const a = mapA.get(category_name);
        const b = mapB.get(category_name);

        const percentA = Number(a?.percent || 0);
        const percentB = Number(b?.percent || 0);
        const amountA = Number(a?.expense_amount || 0);
        const amountB = Number(b?.expense_amount || 0);
        const benchmarkA = Number(a?.benchmark_percent || 0);
        const benchmarkB = Number(b?.benchmark_percent || 0);
        const varianceToTargetA = Number(a?.variance_percent || 0);
        const varianceToTargetB = Number(b?.variance_percent || 0);
        const variance = percentB - percentA;

        return {
          category_name,
          amountA,
          amountB,
          percentA,
          percentB,
          benchmarkA,
          benchmarkB,
          varianceToTargetA,
          varianceToTargetB,
          variance,
          direction: compareDirectionFromVariance(variance),
        };
      })
      .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  }, [selectedCompareOptionA, selectedCompareOptionB]);

  const biggestWorsening = useMemo(
    () => compareRows.filter((row) => row.direction === 'worse').slice(0, 5),
    [compareRows]
  );
  const biggestImprovements = useMemo(
    () => compareRows.filter((row) => row.direction === 'better').slice(0, 5),
    [compareRows]
  );

  const selectedCompareCategoryRow = useMemo(
    () => compareRows.find((row) => row.category_name === selectedCompareCategory) || null,
    [compareRows, selectedCompareCategory]
  );

  const overallTrendData = useMemo(
    () =>
      filteredTrendReports.map((report) => ({
        label: report.month_label,
        amount: report.total_expenses,
        percent: report.total_expense_percent,
      })),
    [filteredTrendReports]
  );

  const categoryTrendData = useMemo(
    () =>
      filteredTrendReports.map((report) => {
        const item = report.items.find((entry) => entry.category_name === selectedCategory);

        return {
          label: report.month_label,
          monthKey: report.monthKey,
          amount: item?.expense_amount || 0,
          percent: item?.percent || 0,
          benchmark: item?.benchmark_percent || 0,
          variance: item?.variance_percent || 0,
          status: item?.status || 'red',
        };
      }),
    [filteredTrendReports, selectedCategory]
  );

  const topProblems = useMemo(() => {
    const topMonthExpenseCategories = selectedMonthReport
      ? [...selectedMonthReport.items]
          .sort((a, b) => b.variance_percent - a.variance_percent)
          .slice(0, 3)
          .map((item) => ({
            label: item.category_name,
            value: item.variance_percent,
            subtext: `${formatPercent(item.percent)} actual vs ${formatPercent(item.benchmark_percent)} target`,
          }))
      : [];

    const topCompareWorsening = [...biggestWorsening].slice(0, 3).map((item) => ({
      label: item.category_name,
      value: item.variance,
      subtext: `${formatPercent(item.percentA)} → ${formatPercent(item.percentB)}`,
    }));

    const latestReport = reports.length > 0 ? reports[0] : null;

    return {
      monthProblems: topMonthExpenseCategories,
      compareProblems: topCompareWorsening,
      latestSummary: latestReport
        ? {
            label: latestReport.month_label,
            value: latestReport.total_expense_percent,
            subtext: `${formatCurrency(latestReport.total_expenses)} total expenses`,
          }
        : null,
    };
  }, [selectedMonthReport, biggestWorsening, reports]);

  function getExportFileName() {
    if (viewMode === 'single-month' && selectedMonthReport) {
      return `expense-benchmark-${selectedMonthReport.monthKey}.pdf`;
    }

    if (viewMode === 'compare-periods' && selectedCompareOptionA && selectedCompareOptionB) {
      return `expense-benchmark-compare-${selectedCompareOptionA.key}-vs-${selectedCompareOptionB.key}.pdf`;
    }

    if (viewMode === 'trends') {
      return `expense-benchmark-trends-${trendRange}.pdf`;
    }

    return 'expense-benchmark-report.pdf';
  }

  function getActiveExportElement() {
    if (viewMode === 'single-month') return singleMonthExportRef.current;
    if (viewMode === 'compare-periods') return compareExportRef.current;
    return trendsExportRef.current;
  }

  function getPdfOrientation(): 'p' | 'l' {
    if (viewMode === 'single-month') return 'p';
    return 'l';
  }

  function getViewLabel() {
    if (viewMode === 'single-month') return 'Single Month';
    if (viewMode === 'compare-periods') return 'Compare Periods';
    return 'Trends';
  }

  function getExportSubtitle() {
    if (viewMode === 'single-month' && selectedMonthReport) {
      return `Month: ${selectedMonthReport.month_label}`;
    }

    if (viewMode === 'compare-periods' && selectedCompareOptionA && selectedCompareOptionB) {
      return `${selectedCompareOptionA.label} vs ${selectedCompareOptionB.label}`;
    }

    if (viewMode === 'trends') {
      const rangeLabel =
        trendRange === 'all'
          ? 'All months'
          : trendRange === 'last-6-months'
          ? 'Last 6 months'
          : 'Current financial year';

      return `Range: ${rangeLabel}`;
    }

    return 'Expense Benchmark Report';
  }

  async function handleExportPdf() {
    const element = getActiveExportElement();
    if (!element) return;

    try {
      setIsExportingPdf(true);
      setShowPdfHeader(true);

      await new Promise((resolve) => setTimeout(resolve, 180));

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ]);

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f8fafc',
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
      });

      const imageData = canvas.toDataURL('image/png');
      const orientation = getPdfOrientation();

      const pdf = new jsPDF({
        orientation,
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = (canvas.height * contentWidth) / canvas.width;
      const usablePageHeight = pageHeight - margin * 2;

      let heightLeft = contentHeight;
      let position = margin;

      pdf.addImage(imageData, 'PNG', margin, position, contentWidth, contentHeight);
      heightLeft -= usablePageHeight;

      while (heightLeft > 0) {
        position = margin - (contentHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imageData, 'PNG', margin, position, contentWidth, contentHeight);
        heightLeft -= usablePageHeight;
      }

      pdf.save(getExportFileName());
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Could not export the PDF. Please try again.');
    } finally {
      setShowPdfHeader(false);
      setIsExportingPdf(false);
    }
  }

  function PdfHeaderBlock() {
    if (!showPdfHeader) return null;

    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            {logoVisibleInPdf ? (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
                <Image
                  src={PRACTICE_LOGO_SRC}
                  alt={`${PRACTICE_NAME} logo`}
                  width={96}
                  height={96}
                  className="h-full w-full object-contain"
                  unoptimized
                  onError={() => setLogoVisibleInPdf(false)}
                />
              </div>
            ) : null}

            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {PRACTICE_NAME}
              </div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
                Expense Benchmark Report
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {getViewLabel()} · {getExportSubtitle()}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div className="font-medium text-slate-900">Export date</div>
            <div className="mt-1">{formatExportDate(new Date())}</div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
        <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-lg font-semibold text-slate-900">Loading expense reports...</div>
          <div className="mt-2 text-sm text-slate-500">Fetching saved reports and category items.</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
        <div className="mx-auto max-w-7xl rounded-2xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <div className="text-lg font-semibold text-rose-700">Could not load the dashboard</div>
          <div className="mt-2 text-sm text-rose-600">{error}</div>
        </div>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <header className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Expense Benchmark Reports</h1>
              <p className="mt-2 text-sm text-slate-500">
                No saved reports yet. Upload and process a Xero report to populate this page.
              </p>
            </div>

            <Link
              href="/imports/upload/xero-upload"
              className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Upload Xero Report
            </Link>
          </header>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
      {isExportingPdf ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 animate-pulse rounded-full bg-blue-600" />
              <div className="text-base font-semibold text-slate-900">Preparing PDF...</div>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Exporting your current view. This can take a few seconds for larger reports.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header
          data-html2canvas-ignore="true"
          className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Expense Benchmark Reports</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Review one month at a time, compare months, quarters, or years, and explore trends in a cleaner layout.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              className={cn(
                'inline-flex items-center rounded-2xl px-4 py-2 text-sm font-medium text-white',
                isExportingPdf ? 'cursor-not-allowed bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'
              )}
            >
              {isExportingPdf ? 'Exporting PDF...' : 'Export PDF'}
            </button>

            <Link
              href="/benchmarks/edit"
              className="inline-flex items-center rounded-2xl border border-slate-300 bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Edit Benchmarks
            </Link>

            <Link
              href="/imports/upload/xero-upload"
              className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Upload Xero Report
            </Link>
          </div>
        </header>

        <SectionCard
          title="Top Problems Panel"
          description="Quick view of the main issues to review first."
        >
          <div className="grid gap-4 lg:grid-cols-3">
            <ProblemList
              title={selectedMonthReport ? `Top Above-Target Categories in ${selectedMonthReport.month_label}` : 'Top Above-Target Categories'}
              rows={topProblems.monthProblems}
              type="percent"
            />

            <ProblemList
              title="Biggest Worsening in Current Comparison"
              rows={topProblems.compareProblems}
              type="percent"
            />

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900">Latest Month Summary</div>
              {topProblems.latestSummary ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-sm font-medium text-slate-900">{topProblems.latestSummary.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-rose-700">
                    {formatPercent(topProblems.latestSummary.value)}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">{topProblems.latestSummary.subtext}</div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">No summary available.</div>
              )}
            </div>
          </div>
        </SectionCard>

        {viewMode === 'single-month' && selectedMonthReport ? (
          <div ref={singleMonthExportRef} className="flex flex-col gap-6">
            <PdfHeaderBlock />

            <SectionCard
              title="Single Month"
              description="Focus on one month only."
              action={
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Year
                    </label>
                    <select
                      value={selectedBillingYear}
                      onChange={(e) => setSelectedBillingYear(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {billingYearOptions.map((year) => (
                        <option key={year} value={String(year)}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Month
                    </label>
                    <select
                      value={selectedBillingMonth}
                      onChange={(e) => setSelectedBillingMonth(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {billingMonthOptions.map((option) => (
                        <option key={option.monthNumber} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-4">
                <Card title="Selected Month" value={selectedMonthReport.month_label} subtitle={selectedMonthReport.quarterLabel} />
                <Card title="Gross Production" value={formatCurrency(selectedMonthReport.gross_production)} />
                <Card title="Total Expenses" value={formatCurrency(selectedMonthReport.total_expenses)} />
                <Card title="Expense %" value={formatPercent(selectedMonthReport.total_expense_percent)} />
              </div>
            </SectionCard>

            <SectionCard title="Status Summary" description="How many categories are green, orange, or red for this month.">
              <StatusSummary items={selectedMonthReport.items} />
            </SectionCard>

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <SectionCard title="Category Spend" description="Categories sorted by dollar amount with target markers.">
                <HorizontalBarList
                  data={selectedMonthReport.items.map((item) => ({
                    label: item.category_name,
                    value: item.expense_amount,
                    target:
                      selectedMonthReport.gross_production > 0
                        ? (item.benchmark_percent / 100) * selectedMonthReport.gross_production
                        : 0,
                  }))}
                />
              </SectionCard>

              <SectionCard title="Category Detail" description="Actual, target, variance, and status for each category.">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-slate-200 text-left text-slate-500">
                      <tr>
                        <th className="pb-3 pr-4 font-medium">Category</th>
                        <th className="pb-3 pr-4 font-medium">Amount</th>
                        <th className="pb-3 pr-4 font-medium">Actual %</th>
                        <th className="pb-3 pr-4 font-medium">Target %</th>
                        <th className="pb-3 pr-4 font-medium">Variance</th>
                        <th className="pb-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedMonthReport.items.map((item) => (
                        <tr key={item.id} className="border-b border-slate-100">
                          <td className="py-3 pr-4 font-medium text-slate-900">{item.category_name}</td>
                          <td className="py-3 pr-4 text-slate-700">{formatCurrency(item.expense_amount)}</td>
                          <td className="py-3 pr-4 text-slate-700">{formatPercent(item.percent)}</td>
                          <td className="py-3 pr-4">
                            <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', targetChipClass(item.benchmark_percent))}>
                              {formatPercent(item.benchmark_percent)}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2.5 py-1 text-xs font-medium',
                                varianceChipClass(compareDirectionFromVariance(item.variance_percent))
                              )}
                            >
                              {formatPercentVariance(item.variance_percent)}
                            </span>
                          </td>
                          <td className="py-3">
                            <span
                              className={cn(
                                'inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize',
                                statusClasses(item.status)
                              )}
                            >
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {viewMode === 'compare-periods' ? (
          <div ref={compareExportRef} className="flex flex-col gap-6">
            <PdfHeaderBlock />

            <SectionCard
              title="Compare Periods"
              description="Compare individual months, quarters, or financial years."
              action={<CompareModeToggle value={compareMode} onChange={setCompareMode} />}
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Compare By</label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
                    <CompareModeToggle value={compareMode} onChange={setCompareMode} />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Period A</label>
                  <select
                    value={selectedCompareA}
                    onChange={(e) => setSelectedCompareA(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {compareOptions.map((option) => (
                      <option key={option.key} value={option.key} disabled={option.key === selectedCompareB}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Period B</label>
                  <select
                    value={selectedCompareB}
                    onChange={(e) => setSelectedCompareB(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {compareOptions.map((option) => (
                      <option key={option.key} value={option.key} disabled={option.key === selectedCompareA}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </SectionCard>

            {selectedCompareOptionA && selectedCompareOptionB ? (
              <>
                <SectionCard
                  title="Comparison Summary"
                  description={`Comparing ${selectedCompareOptionA.label} against ${selectedCompareOptionB.label}.`}
                >
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <Card
                      title={`${selectedCompareOptionA.label} Expense %`}
                      value={formatPercent(selectedCompareOptionA.totalExpensePercent)}
                      subtitle={`${formatCurrency(selectedCompareOptionA.totalExpenses)} expenses on ${formatCurrency(selectedCompareOptionA.grossProduction)} production`}
                    />
                    <Card
                      title={`${selectedCompareOptionB.label} Expense %`}
                      value={formatPercent(selectedCompareOptionB.totalExpensePercent)}
                      subtitle={`${formatCurrency(selectedCompareOptionB.totalExpenses)} expenses on ${formatCurrency(selectedCompareOptionB.grossProduction)} production`}
                    />
                    <Card
                      title="Expense % Change"
                      value={formatPercentVariance(compareSummary?.expensePercentVariance || 0)}
                      subtitle="Lower is better for expense categories"
                    />
                    <Card
                      title="Expense Amount Change"
                      value={formatCurrencyVariance(compareSummary?.expenseAmountVariance || 0)}
                      subtitle={`${selectedCompareOptionA.label} → ${selectedCompareOptionB.label}`}
                    />
                    <Card
                      title="Production Change"
                      value={formatCurrencyVariance(compareSummary?.productionVariance || 0)}
                      subtitle="Gross production movement across the selected periods"
                    />
                    <Card
                      title="Months Included"
                      value={`${selectedCompareOptionA.reportCount} / ${selectedCompareOptionB.reportCount}`}
                      subtitle="Period A months / Period B months"
                    />
                  </div>
                </SectionCard>

                <div className="grid gap-6 lg:grid-cols-2">
                  <SectionCard title="Biggest Worsening" description="Categories with the largest increase in expense %.">
                    {biggestWorsening.length === 0 ? (
                      <div className="text-sm text-slate-500">No worsening found.</div>
                    ) : (
                      <div className="grid gap-3">
                        {biggestWorsening.map((item) => (
                          <div key={item.category_name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="font-medium text-slate-900">{item.category_name}</div>
                            <div className={cn('mt-1 text-lg font-semibold', varianceTextClass(item.direction))}>
                              {formatPercentVariance(item.variance)}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              {formatPercent(item.percentA)} → {formatPercent(item.percentB)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Biggest Improvements" description="Categories with the largest decrease in expense %.">
                    {biggestImprovements.length === 0 ? (
                      <div className="text-sm text-slate-500">No improvements found.</div>
                    ) : (
                      <div className="grid gap-3">
                        {biggestImprovements.map((item) => (
                          <div key={item.category_name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="font-medium text-slate-900">{item.category_name}</div>
                            <div className={cn('mt-1 text-lg font-semibold', varianceTextClass(item.direction))}>
                              {formatPercentVariance(item.variance)}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                              {formatPercent(item.percentA)} → {formatPercent(item.percentB)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>

                <SectionCard
                  title="Selected Category Comparison"
                  description="Pick one category and view a quick visual comparison for the two selected periods."
                  action={
                    <select
                      value={selectedCompareCategory}
                      onChange={(e) => setSelectedCompareCategory(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  }
                >
                  {selectedCompareCategoryRow ? (
                    <>
                      <div className="mb-5 grid gap-4 md:grid-cols-6">
                        <Card title={`${selectedCompareOptionA.label} Amount`} value={formatCurrency(selectedCompareCategoryRow.amountA)} />
                        <Card title={`${selectedCompareOptionB.label} Amount`} value={formatCurrency(selectedCompareCategoryRow.amountB)} />
                        <Card title={`${selectedCompareOptionA.label} %`} value={formatPercent(selectedCompareCategoryRow.percentA)} />
                        <Card title={`${selectedCompareOptionB.label} %`} value={formatPercent(selectedCompareCategoryRow.percentB)} />
                        <Card title={`${selectedCompareOptionA.label} Target`} value={formatPercent(selectedCompareCategoryRow.benchmarkA)} />
                        <Card title={`${selectedCompareOptionB.label} Target`} value={formatPercent(selectedCompareCategoryRow.benchmarkB)} />
                      </div>

                      <div className="mb-5 flex flex-wrap gap-3">
                        {(() => {
                          const amountDiff = selectedCompareCategoryRow.amountB - selectedCompareCategoryRow.amountA;
                          const percentDiff = selectedCompareCategoryRow.percentB - selectedCompareCategoryRow.percentA;

                          return (
                            <>
                              <span
                                className={cn(
                                  'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                                  varianceChipClass(compareDirectionFromVariance(amountDiff))
                                )}
                              >
                                Amount change: {formatCurrencyVariance(amountDiff)}
                              </span>

                              <span
                                className={cn(
                                  'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                                  varianceChipClass(compareDirectionFromVariance(percentDiff))
                                )}
                              >
                                Percent change: {formatPercentVariance(percentDiff)}
                              </span>

                              <span className={cn('inline-flex rounded-full px-3 py-1 text-xs font-medium', targetChipClass(selectedCompareCategoryRow.benchmarkB))}>
                                Period B target: {formatPercent(selectedCompareCategoryRow.benchmarkB)}
                              </span>
                            </>
                          );
                        })()}
                      </div>

                      <SmallComparisonBarChart
                        titleA={selectedCompareOptionA.label}
                        titleB={selectedCompareOptionB.label}
                        amountA={selectedCompareCategoryRow.amountA}
                        amountB={selectedCompareCategoryRow.amountB}
                        percentA={selectedCompareCategoryRow.percentA}
                        percentB={selectedCompareCategoryRow.percentB}
                        targetA={selectedCompareCategoryRow.benchmarkA}
                        targetB={selectedCompareCategoryRow.benchmarkB}
                      />
                    </>
                  ) : (
                    <div className="text-sm text-slate-500">No data found for this category in the selected periods.</div>
                  )}
                </SectionCard>

                <SectionCard title="Category Comparison" description="See how each category changed between the two selected periods.">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-slate-200 text-left text-slate-500">
                        <tr>
                          <th className="pb-3 pr-4 font-medium">Category</th>
                          <th className="pb-3 pr-4 font-medium">{selectedCompareOptionA.label} %</th>
                          <th className="pb-3 pr-4 font-medium">{selectedCompareOptionA.label} Target</th>
                          <th className="pb-3 pr-4 font-medium">{selectedCompareOptionB.label} %</th>
                          <th className="pb-3 pr-4 font-medium">{selectedCompareOptionB.label} Target</th>
                          <th className="pb-3 pr-4 font-medium">Change</th>
                          <th className="pb-3 pr-4 font-medium">Amount A</th>
                          <th className="pb-3 pr-4 font-medium">Amount B</th>
                          <th className="pb-3 font-medium">Direction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compareRows.map((row) => (
                          <tr key={row.category_name} className="border-b border-slate-100">
                            <td className="py-3 pr-4 font-medium text-slate-900">{row.category_name}</td>
                            <td className="py-3 pr-4 text-slate-700">{formatPercent(row.percentA)}</td>
                            <td className="py-3 pr-4">
                              <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', targetChipClass(row.benchmarkA))}>
                                {formatPercent(row.benchmarkA)}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-slate-700">{formatPercent(row.percentB)}</td>
                            <td className="py-3 pr-4">
                              <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', targetChipClass(row.benchmarkB))}>
                                {formatPercent(row.benchmarkB)}
                              </span>
                            </td>
                            <td className="py-3 pr-4">
                              <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', varianceChipClass(row.direction))}>
                                {formatPercentVariance(row.variance)}
                              </span>
                            </td>
                            <td className="py-3 pr-4 text-slate-700">{formatCurrency(row.amountA)}</td>
                            <td className="py-3 pr-4 text-slate-700">{formatCurrency(row.amountB)}</td>
                            <td className="py-3">
                              <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', varianceChipClass(row.direction))}>
                                {getDirectionLabel(row.direction)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              </>
            ) : null}
          </div>
        ) : null}

        {viewMode === 'trends' ? (
          <div ref={trendsExportRef} className="flex flex-col gap-6">
            <PdfHeaderBlock />

            <SectionCard
              title="Trends"
              description="Track expenses over time across all months or focus on a shorter range."
              action={<TrendRangeToggle value={trendRange} onChange={setTrendRange} />}
            >
              <div className="grid gap-4 md:grid-cols-4">
                <Card
                  title="Months in View"
                  value={String(filteredTrendReports.length)}
                  subtitle="Number of monthly reports shown in the current range"
                />
                <Card
                  title="Latest Month"
                  value={filteredTrendReports[filteredTrendReports.length - 1]?.month_label || '-'}
                />
                <Card
                  title="Latest Expense %"
                  value={formatPercent(filteredTrendReports[filteredTrendReports.length - 1]?.total_expense_percent || 0)}
                />
                <Card
                  title="Latest Total Expenses"
                  value={formatCurrency(filteredTrendReports[filteredTrendReports.length - 1]?.total_expenses || 0)}
                />
              </div>
            </SectionCard>

            <SectionCard title="Overall Expense Trend" description="Total expenses and total expense % by month.">
              <DualLineChart
                data={overallTrendData}
                amountKey="amount"
                percentKey="percent"
                amountLabel="Total Expenses"
                percentLabel="Expense %"
              />
            </SectionCard>

            <SectionCard
              title="Category Trend"
              description="Choose one category and compare actual % against target over time."
              action={
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              }
            >
              <div className="mb-5 grid gap-4 md:grid-cols-4">
                <Card
                  title="Selected Category"
                  value={selectedCategory || '-'}
                  subtitle="Current category in the chart and table below"
                />
                <Card
                  title="Latest Amount"
                  value={formatCurrency(categoryTrendData[categoryTrendData.length - 1]?.amount || 0)}
                />
                <Card
                  title="Latest Actual %"
                  value={formatPercent(categoryTrendData[categoryTrendData.length - 1]?.percent || 0)}
                />
                <Card
                  title="Latest Target %"
                  value={formatPercent(categoryTrendData[categoryTrendData.length - 1]?.benchmark || 0)}
                />
              </div>

              <DualLineChart
                data={categoryTrendData}
                amountKey="amount"
                percentKey="percent"
                targetKey="benchmark"
                amountLabel="Amount"
                percentLabel="Actual %"
                targetLabel="Target %"
              />
            </SectionCard>

            <SectionCard title="Category Trend Detail" description="Month-by-month detail for the selected category.">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-slate-200 text-left text-slate-500">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Month</th>
                      <th className="pb-3 pr-4 font-medium">Amount</th>
                      <th className="pb-3 pr-4 font-medium">Actual %</th>
                      <th className="pb-3 pr-4 font-medium">Target %</th>
                      <th className="pb-3 pr-4 font-medium">Variance</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryTrendData.map((row) => (
                      <tr key={row.monthKey} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-900">{row.label}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatCurrency(row.amount)}</td>
                        <td className="py-3 pr-4 text-slate-700">{formatPercent(row.percent)}</td>
                        <td className="py-3 pr-4">
                          <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', targetChipClass(row.benchmark))}>
                            {formatPercent(row.benchmark)}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', varianceChipClass(compareDirectionFromVariance(row.variance)))}>
                            {formatPercentVariance(row.variance)}
                          </span>
                        </td>
                        <td className="py-3">
                          <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize', statusClasses(row.status as 'green' | 'orange' | 'red'))}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </div>
    </div>
  );
}