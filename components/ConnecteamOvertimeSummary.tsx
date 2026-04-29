"use client";

import { useEffect, useMemo, useState } from "react";

type DaySummary = {
  date: string;
  total_hours: number;
  overtime_hours: number;
};

type StaffSummary = {
  user_id: string;
  staff_name?: string;
  total_hours: number;
  overtime_hours: number;
  overtime_cost?: number;
  long_days: number;
};

export default function ConnecteamOvertimeSummary({
  from,
  to,
}: {
  from: string;
  to: string;
}) {
  const [days, setDays] = useState<DaySummary[]>([]);
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);

      const [costResponse, summaryResponse] = await Promise.all([
        fetch(`/api/connecteam/overtime-cost?from=${from}&to=${to}`, {
          cache: "no-store",
        }),
        fetch(`/api/connecteam/overtime-summary?from=${from}&to=${to}`, {
          cache: "no-store",
        }),
      ]);

      const costJson = await costResponse.json();
      const summaryJson = await summaryResponse.json();

      setStaff(costJson.staff || summaryJson.staff || []);
      setDays(summaryJson.days || []);
      setLoading(false);
    }

    loadData();
  }, [from, to]);

  const weeklyTrends = useMemo(() => {
    const map = new Map<string, { week: string; hours: number }>();

    for (const day of days) {
      const week = getWeekLabel(day.date);
      const existing = map.get(week) ?? { week, hours: 0 };
      existing.hours += Number(day.overtime_hours || 0);
      map.set(week, existing);
    }

    return Array.from(map.values());
  }, [days]);

  const avgDailyOT =
    days.reduce((sum, d) => sum + Number(d.overtime_hours || 0), 0) /
    (days.length || 1);

  if (loading) {
    return (
      <section className="rounded-3xl border bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">
          Loading Connecteam overtime summary…
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Connecteam Overtime Summary
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Selected Connecteam range: {formatDate(from)} to {formatDate(to)}
        </p>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <ChartCard title="Overtime by day">
          <BarChart
            data={days.map((d) => ({
              label: formatDateWithDayShort(d.date),
              value: Number(d.overtime_hours || 0),
            }))}
          />
        </ChartCard>

        <ChartCard title="Weekly overtime trend">
          <BarChart
            data={weeklyTrends.map((w) => ({
              label: w.week,
              value: w.hours,
            }))}
          />
        </ChartCard>
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-4">
        <h3 className="mb-3 font-semibold">Overtime by Day</h3>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th>Date</th>
              <th>Day</th>
              <th>Total Hours</th>
              <th>Overtime Hours</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, index) => {
              const isProblemDay =
                Number(d.overtime_hours || 0) > Math.max(1, avgDailyOT * 1.5);

              return (
                <tr
                  key={`${d.date}-${index}`}
                  className={`border-t ${
                    isProblemDay ? "bg-red-50 font-semibold" : ""
                  }`}
                >
                  <td>{formatDate(d.date)}</td>
                  <td>{getDayName(d.date)}</td>
                  <td>{format(d.total_hours)}</td>
                  <td className="text-red-600">{format(d.overtime_hours)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

   
    </section>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <h3 className="mb-4 font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex h-72 items-end gap-2 overflow-x-auto border-b border-slate-200 pb-2">
      {data.map((item, index) => {
        const height = Math.max((item.value / max) * 220, item.value > 0 ? 8 : 2);

        return (
          <div
            key={`${item.label}-${index}`}
            className="flex min-w-[54px] flex-col items-center justify-end gap-2"
          >
            <div className="text-xs font-medium text-slate-600">
              {format(item.value)}
            </div>
            <div
              className="w-8 rounded-t-lg bg-slate-900"
              style={{ height }}
              title={`${item.label}: ${format(item.value)} hrs`}
            />
            <div className="h-10 text-center text-[10px] leading-tight text-slate-500">
              {item.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function format(value: number) {
  return Number(value || 0).toFixed(1);
}

function money(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function getDayName(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateWithDayShort(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function getWeekLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const monday = new Date(date);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);

  return `Week of ${new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
  }).format(monday)}`;
}