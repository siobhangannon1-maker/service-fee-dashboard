"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PeriodOption = {
  key: string;
  label: string;
  payPeriodIds: string[];
  start: string;
  end: string;
};

type PeriodOptionsByView = {
  fortnight: PeriodOption[];
  month: PeriodOption[];
  quarter: PeriodOption[];
  year: PeriodOption[];
};

export default function PeriodSelector({
  currentView,
  currentPeriod,
  showStaff,
  periodOptionsByView,
}: {
  currentView: string;
  currentPeriod: string;
  showStaff: boolean;
  periodOptionsByView: PeriodOptionsByView;
}) {
  const router = useRouter();

  const safeCurrentView = isValidView(currentView) ? currentView : "fortnight";

  const [view, setView] = useState<keyof PeriodOptionsByView>(safeCurrentView);
  const [period, setPeriod] = useState(currentPeriod);

  const periodOptions = useMemo(() => {
    return periodOptionsByView[view] ?? periodOptionsByView.fortnight;
  }, [periodOptionsByView, view]);

  function handleViewChange(nextView: keyof PeriodOptionsByView) {
    const nextOptions = periodOptionsByView[nextView] ?? [];
    const nextPeriod = nextOptions[0]?.key ?? "";

    setView(nextView);
    setPeriod(nextPeriod);
  }

  function handleApply() {
    const params = new URLSearchParams();

    params.set("view", view);
    if (period) params.set("period", period);
    if (showStaff) params.set("staff", "1");

    router.push(`/practice-manager/staff-wages-overtime-analysis?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Time period
        <select
          value={view}
          onChange={(event) =>
            handleViewChange(event.target.value as keyof PeriodOptionsByView)
          }
          className="rounded-2xl border bg-white px-3 py-2"
        >
          <option value="fortnight">Fortnight</option>
          <option value="month">Month</option>
          <option value="quarter">ATO quarter</option>
          <option value="year">Year</option>
        </select>
      </label>

      <label className="flex min-w-[260px] flex-col gap-1 text-sm font-medium text-slate-700">
        Period
        <select
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          className="rounded-2xl border bg-white px-3 py-2"
        >
          {periodOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={handleApply}
        className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
      >
        Apply
      </button>
    </div>
  );
}

function isValidView(value: string): value is keyof PeriodOptionsByView {
  return ["fortnight", "month", "quarter", "year"].includes(value);
}
