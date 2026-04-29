"use client";

import type { ReactNode } from "react";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type StaffWagesTrendPoint = {
  key: string;
  label: string;
  shortLabel: string;
  start: string;
  end: string;
  totalWages: number;
  ordinaryWages: number;
  superAmount: number;
  labourHireCost: number;
  overtimeCost: number;
  overtimeHours: number;
};

type StaffWagesTrendsChartsProps = {
  rows: StaffWagesTrendPoint[];
  comparisonView: "month" | "quarter" | "year";
};

const moneyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function money(value: number) {
  return moneyFormatter.format(Number(value || 0));
}

function hours(value: number) {
  return `${Number(value || 0).toFixed(2)} hrs`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function periodLabel(view: "month" | "quarter" | "year") {
  if (view === "month") return "monthly";
  if (view === "quarter") return "quarterly";
  return "yearly";
}

function getChange(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">
        No prior period
      </span>
    );
  }

  const isUp = value >= 0;

  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-bold ${
        isUp ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {isUp ? "+" : ""}
      {value.toFixed(1)}% vs prior
    </span>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload as StaffWagesTrendPoint | undefined;
  if (!row) return null;

  return (
    <div className="min-w-[260px] rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-xl">
      <div className="font-bold text-slate-900">{row.label || label}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">
        {dateLabel(row.start)} to {dateLabel(row.end)}
      </div>

      <div className="mt-3 space-y-2">
        <TooltipRow label="Total wages" value={money(row.totalWages)} />
        <TooltipRow label="Labour hire" value={money(row.labourHireCost)} />
        <TooltipRow label="Overtime cost" value={money(row.overtimeCost)} />
        <TooltipRow label="Overtime hours" value={hours(row.overtimeHours)} />
        <div className="my-2 border-t border-slate-100" />
        <TooltipRow label="Ordinary wages" value={money(row.ordinaryWages)} />
        <TooltipRow label="Superannuation" value={money(row.superAmount)} />
      </div>
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-slate-500">{label}</span>
      <span className="font-bold text-slate-900">{value}</span>
    </div>
  );
}

function currencyAxis(value: number) {
  if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(1)}m`;
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}

function hoursAxis(value: number) {
  return `${value}h`;
}

export default function StaffWagesTrendsCharts({
  rows,
  comparisonView,
}: StaffWagesTrendsChartsProps) {
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];

  if (rows.length === 0) {
    return (
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Trends & comparison
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          No payroll periods are available for this comparison view yet.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-600">
              Trends & comparison
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
              {periodLabel(comparisonView).replace(/^./, (letter) =>
                letter.toUpperCase()
              )} wages and overtime trends
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Track total wages, labour hire, overtime cost, and overtime hours
              across comparable periods. Hover over any chart point to see the
              full breakdown for that period.
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            Showing {rows.length} {periodLabel(comparisonView)} periods
          </div>
        </div>

        {latest && (
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <TrendSummaryCard
              title="Latest total wages"
              value={money(latest.totalWages)}
              change={getChange(latest.totalWages, previous?.totalWages ?? 0)}
            />
            <TrendSummaryCard
              title="Latest labour hire"
              value={money(latest.labourHireCost)}
              change={getChange(
                latest.labourHireCost,
                previous?.labourHireCost ?? 0
              )}
            />
            <TrendSummaryCard
              title="Latest overtime cost"
              value={money(latest.overtimeCost)}
              change={getChange(latest.overtimeCost, previous?.overtimeCost ?? 0)}
            />
            <TrendSummaryCard
              title="Latest overtime hours"
              value={hours(latest.overtimeHours)}
              change={getChange(
                latest.overtimeHours,
                previous?.overtimeHours ?? 0
              )}
            />
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard
          title="Cost trend"
          description="Total wages, labour hire, and overtime cost by period."
        >
          <ResponsiveContainer width="100%" height={360}>
            <AreaChart data={rows} margin={{ top: 10, right: 18, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="totalWagesFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="labourHireFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0f766e" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="overtimeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.16} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="shortLabel"
                tick={{ fontSize: 12, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={currencyAxis}
                tick={{ fontSize: 12, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Area
                type="monotone"
                dataKey="totalWages"
                name="Total wages"
                stroke="#2563eb"
                strokeWidth={3}
                fill="url(#totalWagesFill)"
                activeDot={{ r: 6 }}
              />
              <Area
                type="monotone"
                dataKey="labourHireCost"
                name="Labour hire"
                stroke="#0f766e"
                strokeWidth={3}
                fill="url(#labourHireFill)"
                activeDot={{ r: 6 }}
              />
              <Area
                type="monotone"
                dataKey="overtimeCost"
                name="Overtime cost"
                stroke="#dc2626"
                strokeWidth={3}
                fill="url(#overtimeFill)"
                activeDot={{ r: 6 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Overtime hours trend"
          description="Total overtime hours paid in each comparison period."
        >
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={rows} margin={{ top: 10, right: 18, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="shortLabel"
                tick={{ fontSize: 12, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={hoursAxis}
                tick={{ fontSize: 12, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar
                dataKey="overtimeHours"
                name="Overtime hours"
                fill="#7c3aed"
                radius={[10, 10, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <h3 className="text-lg font-bold text-slate-900">Comparison table</h3>
          <p className="mt-1 text-sm text-slate-500">
            The same trend data shown in table form for quick checking.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3 text-right">Total wages</th>
                <th className="px-4 py-3 text-right">Labour hire</th>
                <th className="px-4 py-3 text-right">Overtime cost</th>
                <th className="px-4 py-3 text-right">Overtime hours</th>
                <th className="px-4 py-3 text-right">Ordinary wages</th>
                <th className="px-4 py-3 text-right">Super</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    <div>{row.label}</div>
                    <div className="mt-1 text-xs font-medium text-slate-500">
                      {dateLabel(row.start)} to {dateLabel(row.end)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {money(row.totalWages)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {money(row.labourHireCost)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {money(row.overtimeCost)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {hours(row.overtimeHours)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {money(row.ordinaryWages)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">
                    {money(row.superAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TrendSummaryCard({
  title,
  value,
  change,
}: {
  title: string;
  value: string;
  change: number | null;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
        {value}
      </div>
      <div className="mt-3">
        <ChangeBadge value={change} />
      </div>
    </div>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {children}
    </div>
  );
}
