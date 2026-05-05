"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PeriodType = "month" | "quarter" | "year" | "custom";
type ViewMode = "compare" | "current";

type Row = {
  referrer_id: string;
  clinic_name: string;
  suburb: string | null;
  post_code: string | null;
  referrals: number;
  rank: number | null;
  previous_referrals: number | null;
  previous_rank: number | null;
  referral_change: number | null;
  rank_change: number | null;
  is_new_top_referrer: boolean;
  left_top_3: boolean;
  left_top_20: boolean;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const QUARTERS = [
  { label: "Q1: Jul–Sep", value: 1, startMonth: 6, endMonth: 8 },
  { label: "Q2: Oct–Dec", value: 2, startMonth: 9, endMonth: 11 },
  { label: "Q3: Jan–Mar", value: 3, startMonth: 0, endMonth: 2 },
  { label: "Q4: Apr–Jun", value: 4, startMonth: 3, endMonth: 5 },
];

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthRange(year: number, monthIndex: number) {
  return {
    start: toIsoDate(new Date(year, monthIndex, 1)),
    end: toIsoDate(new Date(year, monthIndex + 1, 0)),
  };
}

function getQuarterRange(year: number, quarter: number) {
  const selected = QUARTERS.find((q) => q.value === quarter) || QUARTERS[0];

  return {
    start: toIsoDate(new Date(year, selected.startMonth, 1)),
    end: toIsoDate(new Date(year, selected.endMonth + 1, 0)),
  };
}

function getYearRange(year: number) {
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function getRange(config: {
  type: PeriodType;
  year: number;
  month: number;
  quarter: number;
  customStart: string;
  customEnd: string;
}) {
  if (config.type === "month") return getMonthRange(config.year, config.month);
  if (config.type === "quarter")
    return getQuarterRange(config.year, config.quarter);
  if (config.type === "year") return getYearRange(config.year);

  return {
    start: config.customStart,
    end: config.customEnd,
  };
}

function referralChangeLabel(value: number | null) {
  if (value === null) return "—";
  if (value > 0) return `+${value}`;
  return String(value);
}

function rankChangeLabel(value: number | null) {
  if (value === null) return "—";
  if (value > 0) return `↑ ${value}`;
  if (value < 0) return `↓ ${Math.abs(value)}`;
  return "—";
}

function statusLabel(row: Row) {
  const labels: string[] = [];

  if (row.is_new_top_referrer) labels.push("🆕 New");
  if ((row.rank_change || 0) >= 10) labels.push("🚀 Rising");
  if ((row.rank_change || 0) <= -10) labels.push("📉 Dropping");
  if (row.left_top_3) labels.push("⚠️ Left top 3");
  if (row.left_top_20) labels.push("⚠️ Left top 20");

  return labels.join(" ") || "—";
}

function PeriodSelector({
  title,
  type,
  setType,
  year,
  setYear,
  month,
  setMonth,
  quarter,
  setQuarter,
  customStart,
  setCustomStart,
  customEnd,
  setCustomEnd,
  yearOptions,
}: {
  title: string;
  type: PeriodType;
  setType: (value: PeriodType) => void;
  year: number;
  setYear: (value: number) => void;
  month: number;
  setMonth: (value: number) => void;
  quarter: number;
  setQuarter: (value: number) => void;
  customStart: string;
  setCustomStart: (value: string) => void;
  customEnd: string;
  setCustomEnd: (value: string) => void;
  yearOptions: number[];
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label>
          <div className="mb-1 text-sm font-medium">Period type</div>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as PeriodType)}
            className="w-full rounded-2xl border bg-white px-3 py-2"
          >
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
            <option value="year">Year</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>

        {type !== "custom" && (
          <label>
            <div className="mb-1 text-sm font-medium">Year</div>
            <select
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="w-full rounded-2xl border bg-white px-3 py-2"
            >
              {yearOptions.map((yearOption) => (
                <option key={yearOption} value={yearOption}>
                  {yearOption}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === "month" && (
          <label>
            <div className="mb-1 text-sm font-medium">Month</div>
            <select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
              className="w-full rounded-2xl border bg-white px-3 py-2"
            >
              {MONTHS.map((monthName, index) => (
                <option key={monthName} value={index}>
                  {monthName}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === "quarter" && (
          <label>
            <div className="mb-1 text-sm font-medium">Quarter</div>
            <select
              value={quarter}
              onChange={(event) => setQuarter(Number(event.target.value))}
              className="w-full rounded-2xl border bg-white px-3 py-2"
            >
              {QUARTERS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === "custom" && (
          <>
            <label>
              <div className="mb-1 text-sm font-medium">Start date</div>
              <input
                type="date"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="w-full rounded-2xl border bg-white px-3 py-2"
              />
            </label>

            <label>
              <div className="mb-1 text-sm font-medium">End date</div>
              <input
                type="date"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="w-full rounded-2xl border bg-white px-3 py-2"
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export default function ReferrerPerformancePage() {
  const now = new Date();

  const [viewMode, setViewMode] = useState<ViewMode>("compare");

  const [currentType, setCurrentType] = useState<PeriodType>("month");
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentQuarter, setCurrentQuarter] = useState(() => {
  const month = now.getMonth();
  if (month >= 6 && month <= 8) return 1;
  if (month >= 9 && month <= 11) return 2;
  if (month >= 0 && month <= 2) return 3;
  return 4;
});
  const [currentCustomStart, setCurrentCustomStart] = useState("2026-04-01");
  const [currentCustomEnd, setCurrentCustomEnd] = useState("2026-04-30");

  const [comparisonType, setComparisonType] = useState<PeriodType>("month");
  const [comparisonYear, setComparisonYear] = useState(now.getFullYear());
  const [comparisonMonth, setComparisonMonth] = useState(
    Math.max(0, now.getMonth() - 1)
  );
  const [comparisonQuarter, setComparisonQuarter] = useState(() => {
  const month = now.getMonth();
  if (month >= 6 && month <= 8) return 4;
  if (month >= 9 && month <= 11) return 1;
  if (month >= 0 && month <= 2) return 2;
  return 3;
});
  const [comparisonCustomStart, setComparisonCustomStart] =
    useState("2026-03-01");
  const [comparisonCustomEnd, setComparisonCustomEnd] = useState("2026-03-31");

  const [minimumReferrals, setMinimumReferrals] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [currentTotal, setCurrentTotal] = useState(0);
  const [previousTotal, setPreviousTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const yearOptions = useMemo(() => {
    const years = [];
    for (let year = now.getFullYear() + 1; year >= now.getFullYear() - 10; year--) {
      years.push(year);
    }
    return years;
  }, [now]);

  const currentRange = getRange({
    type: currentType,
    year: currentYear,
    month: currentMonth,
    quarter: currentQuarter,
    customStart: currentCustomStart,
    customEnd: currentCustomEnd,
  });

  const comparisonRange = getRange({
    type: comparisonType,
    year: comparisonYear,
    month: comparisonMonth,
    quarter: comparisonQuarter,
    customStart: comparisonCustomStart,
    customEnd: comparisonCustomEnd,
  });

  async function loadData() {
    setLoading(true);
    setMessage("");

    try {
      const params = new URLSearchParams({
        mode: viewMode,
        currentStart: currentRange.start,
        currentEnd: currentRange.end,
      });

      if (viewMode === "compare") {
        params.set("comparisonStart", comparisonRange.start);
        params.set("comparisonEnd", comparisonRange.end);
      }

      const res = await fetch(`/api/referrers/performance?${params.toString()}`, {
        cache: "no-store",
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Could not load referrer performance.");
      }

      setRows(json.results || []);
      setCurrentTotal(json.current_total_referrals || 0);
      setPreviousTotal(json.previous_total_referrals ?? null);
    } catch (error: any) {
      setMessage(error?.message || "Could not load referrer performance.");
      setRows([]);
      setCurrentTotal(0);
      setPreviousTotal(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewMode,
    currentType,
    currentYear,
    currentMonth,
    currentQuarter,
    currentCustomStart,
    currentCustomEnd,
    comparisonType,
    comparisonYear,
    comparisonMonth,
    comparisonQuarter,
    comparisonCustomStart,
    comparisonCustomEnd,
  ]);

  const visibleRows = rows.filter(
    (row) => row.rank !== null && row.referrals >= minimumReferrals
  );

  const topRows = visibleRows.slice(0, 20);

  const bigRisers = visibleRows
    .filter((row) => (row.rank_change || 0) >= 10)
    .slice(0, 10);

  const bigDrops = visibleRows
    .filter((row) => (row.rank_change || 0) <= -10)
    .slice(0, 10);

  const newTop20 = visibleRows.filter(
    (row) => row.rank !== null && row.rank <= 20 && row.is_new_top_referrer
  );

  const leftTop20 = rows.filter((row) => row.left_top_20);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">
              Referrer Performance
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Compare any month, quarter, year, or custom date range.
            </p>
          </div>

          <Link
            href="/benchmark/referrals"
            className="rounded-2xl border bg-white px-4 py-2 text-sm hover:bg-slate-100"
          >
            Back to Referral Map
          </Link>
        </div>

        <section className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setViewMode("compare")}
              className={`rounded-2xl px-4 py-2 text-sm ${
                viewMode === "compare"
                  ? "bg-slate-900 text-white"
                  : "border bg-white text-slate-700"
              }`}
            >
              Compare periods
            </button>

            <button
              onClick={() => setViewMode("current")}
              className={`rounded-2xl px-4 py-2 text-sm ${
                viewMode === "current"
                  ? "bg-slate-900 text-white"
                  : "border bg-white text-slate-700"
              }`}
            >
              Current period only
            </button>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <PeriodSelector
            title="Current period"
            type={currentType}
            setType={setCurrentType}
            year={currentYear}
            setYear={setCurrentYear}
            month={currentMonth}
            setMonth={setCurrentMonth}
            quarter={currentQuarter}
            setQuarter={setCurrentQuarter}
            customStart={currentCustomStart}
            setCustomStart={setCurrentCustomStart}
            customEnd={currentCustomEnd}
            setCustomEnd={setCurrentCustomEnd}
            yearOptions={yearOptions}
          />

          {viewMode === "compare" && (
            <PeriodSelector
              title="Comparison period"
              type={comparisonType}
              setType={setComparisonType}
              year={comparisonYear}
              setYear={setComparisonYear}
              month={comparisonMonth}
              setMonth={setComparisonMonth}
              quarter={comparisonQuarter}
              setQuarter={setComparisonQuarter}
              customStart={comparisonCustomStart}
              setCustomStart={setComparisonCustomStart}
              customEnd={comparisonCustomEnd}
              setCustomEnd={setComparisonCustomEnd}
              yearOptions={yearOptions}
            />
          )}
        </section>

        <section className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4 text-sm">
              Current:{" "}
              <strong>
                {currentRange.start} to {currentRange.end}
              </strong>
            </div>

            {viewMode === "compare" && (
              <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                Comparison:{" "}
                <strong>
                  {comparisonRange.start} to {comparisonRange.end}
                </strong>
              </div>
            )}

            <label className="rounded-2xl bg-slate-50 p-4 text-sm">
              Minimum referrals
              <input
                type="number"
                min={1}
                value={minimumReferrals}
                onChange={(event) =>
                  setMinimumReferrals(Number(event.target.value || 1))
                }
                className="mt-2 w-full rounded-xl border bg-white px-3 py-2"
              />
            </label>
          </div>
        </section>

        {message && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {message}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Current referrals</div>
            <div className="mt-2 text-3xl font-semibold">{currentTotal}</div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Comparison referrals</div>
            <div className="mt-2 text-3xl font-semibold">
              {viewMode === "compare" ? previousTotal ?? 0 : "—"}
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">New top 20</div>
            <div className="mt-2 text-3xl font-semibold">
              {viewMode === "compare" ? newTop20.length : "—"}
            </div>
          </div>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="text-sm text-slate-500">Left top 20</div>
            <div className="mt-2 text-3xl font-semibold">
              {viewMode === "compare" ? leftTop20.length : "—"}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex justify-between">
            <div>
              <h2 className="text-xl font-semibold">Top 20 referrers</h2>
              <p className="mt-1 text-sm text-slate-600">
                Ranked by current selected period.
              </p>
            </div>
            {loading && <div className="text-sm text-slate-500">Loading...</div>}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="px-3 py-2 text-left">Rank</th>
                  <th className="px-3 py-2 text-left">Referrer</th>
                  <th className="px-3 py-2 text-left">Current</th>
                  <th className="px-3 py-2 text-left">Comparison</th>
                  <th className="px-3 py-2 text-left">Referral change</th>
                  <th className="px-3 py-2 text-left">Rank change</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>

              <tbody>
                {topRows.map((row) => (
                  <tr key={row.referrer_id} className="border-b">
                    <td className="px-3 py-2 font-semibold">#{row.rank}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.clinic_name}</div>
                      <div className="text-xs text-slate-500">
                        {row.suburb || "Unknown suburb"}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-semibold">{row.referrals}</td>
                    <td className="px-3 py-2">
                      {viewMode === "compare"
                        ? `${row.previous_referrals ?? 0}${
                            row.previous_rank
                              ? ` (#${row.previous_rank})`
                              : ""
                          }`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {viewMode === "compare"
                        ? referralChangeLabel(row.referral_change)
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {viewMode === "compare"
                        ? rankChangeLabel(row.rank_change)
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {viewMode === "compare" ? statusLabel(row) : "—"}
                    </td>
                  </tr>
                ))}

                {topRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-slate-500">
                      No referrer data found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {viewMode === "compare" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Big risers</h2>
              <div className="mt-4 space-y-2">
                {bigRisers.map((row) => (
                  <div key={row.referrer_id} className="rounded-2xl bg-emerald-50 p-3 text-sm">
                    <strong>{row.clinic_name}</strong> rose{" "}
                    <strong>{row.rank_change}</strong> rank places and changed by{" "}
                    <strong>{referralChangeLabel(row.referral_change)}</strong>{" "}
                    referrals.
                  </div>
                ))}
                {bigRisers.length === 0 && (
                  <div className="text-sm text-slate-500">No big risers.</div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Big drops</h2>
              <div className="mt-4 space-y-2">
                {bigDrops.map((row) => (
                  <div key={row.referrer_id} className="rounded-2xl bg-red-50 p-3 text-sm">
                    <strong>{row.clinic_name}</strong> dropped{" "}
                    <strong>{Math.abs(row.rank_change || 0)}</strong> rank places and changed by{" "}
                    <strong>{referralChangeLabel(row.referral_change)}</strong>{" "}
                    referrals.
                  </div>
                ))}
                {bigDrops.length === 0 && (
                  <div className="text-sm text-slate-500">No big drops.</div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}