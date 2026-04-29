"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

type SyncSummary = {
  from: string | null;
  to: string | null;
  force: boolean;
  limit: number;
  offset: number;
  nextOffset: number;
  matchingPayRuns: number;
  payRunsCheckedThisRequest: number;
  payRunsSynced: number;
  payRunsSkipped: number;
  wageLinesInserted: number;
  overtimeHours: number;
  overtimeAmount: number;
  checkedSoFar: number;
  hasMore: boolean;
  progressLabel: string;
};

type SyncResponse = {
  success: boolean;
  message?: string;
  error?: string;
  summary?: SyncSummary;
  nextBackfillRequest?: string | null;
};

export default function SyncPayrollButton({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [offset, setOffset] = useState(0);

  const [isSyncingNext, setIsSyncingNext] = useState(false);
  const [isSyncingFullRange, setIsSyncingFullRange] = useState(false);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<SyncSummary | null>(null);

  const isBusy = isSyncingNext || isSyncingFullRange;

  async function syncOnePayRun(syncOffset: number) {
    const params = new URLSearchParams();
    params.set("from", from);
    params.set("to", to);
    params.set("force", "1");
    params.set("limit", "1");
    params.set("offset", String(syncOffset));

    const response = await fetch(`/api/xero/payroll/sync?${params.toString()}`, {
      method: "POST",
    });

    const text = await response.text();

    let json: SyncResponse;

    try {
      json = text
        ? (JSON.parse(text) as SyncResponse)
        : {
            success: false,
            error: "Empty response from payroll sync API.",
          };
    } catch {
      json = {
        success: false,
        error: text || "Payroll sync API returned invalid JSON.",
      };
    }

    if (!response.ok || !json.success) {
      throw new Error(json.error || "Xero payroll sync failed.");
    }

    if (!json.summary) {
      throw new Error("Sync completed but no summary was returned.");
    }

    return json.summary;
  }

  async function handleSyncNextPayRun() {
    setIsSyncingNext(true);
    setError(null);
    setStatus(`Syncing pay run offset ${offset}...`);

    try {
      const summary = await syncOnePayRun(offset);

      setLastSummary(summary);
      setOffset(summary.nextOffset);

      setStatus(
        `Done. ${summary.progressLabel}. Synced ${summary.payRunsSynced}, skipped ${summary.payRunsSkipped}.`
      );

      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Sync failed.");
      setStatus(null);
    } finally {
      setIsSyncingNext(false);
    }
  }

  async function handleSyncFullRange() {
    setIsSyncingFullRange(true);
    setError(null);

    let currentOffset = offset;

    try {
      while (true) {
        setStatus(`Syncing pay run offset ${currentOffset}...`);

        const summary = await syncOnePayRun(currentOffset);

        setLastSummary(summary);
        setOffset(summary.nextOffset);

        setStatus(
          `${summary.progressLabel}. Last request synced ${summary.payRunsSynced}, skipped ${summary.payRunsSkipped}.`
        );

        currentOffset = summary.nextOffset;

        if (!summary.hasMore) {
          setStatus(`Full range complete. ${summary.progressLabel}.`);
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Full range sync failed.");
    } finally {
      setIsSyncingFullRange(false);
    }
  }

  function resetOffset() {
    setOffset(0);
    setStatus(null);
    setError(null);
    setLastSummary(null);
  }

  function useSelectedDashboardDates() {
    setFrom(defaultFrom);
    setTo(defaultTo);
    resetOffset();
  }

  function useCurrentFinancialYear() {
    setFrom("2025-07-01");
    setTo("2026-06-30");
    resetOffset();
  }

  function usePreviousFinancialYear() {
    setFrom("2024-07-01");
    setTo("2025-06-30");
    resetOffset();
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid gap-3">
        <DateField label="From date" value={from} disabled={isBusy} onChange={(value) => { setFrom(value); resetOffset(); }} />
        <DateField label="To date" value={to} disabled={isBusy} onChange={(value) => { setTo(value); resetOffset(); }} />
      </div>

      <div className="grid gap-2">
        <PresetButton disabled={isBusy} onClick={useSelectedDashboardDates}>Use selected dashboard dates</PresetButton>
        <PresetButton disabled={isBusy} onClick={useCurrentFinancialYear}>Use FY 2025–2026</PresetButton>
        <PresetButton disabled={isBusy} onClick={usePreviousFinancialYear}>Use FY 2024–2025</PresetButton>
      </div>

      <div className="mt-auto grid gap-2">
        <button
          type="button"
          onClick={handleSyncNextPayRun}
          disabled={isBusy || !from || !to}
          className="rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSyncingNext ? "Syncing next pay run..." : "Sync Next Pay Run"}
        </button>

        <button
          type="button"
          onClick={handleSyncFullRange}
          disabled={isBusy || !from || !to}
          className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSyncingFullRange ? "Backfilling full range..." : "Sync Full Range"}
        </button>

        <button
          type="button"
          onClick={resetOffset}
          disabled={isBusy}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to first pay run
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <div className="grid grid-cols-2 gap-2">
          <StatusItem label="Sync range" value={`${from} to ${to}`} />
          <StatusItem label="Next offset" value={String(offset)} />
          {lastSummary && (
            <>
              <StatusItem label="Matching pay runs" value={String(lastSummary.matchingPayRuns)} />
              <StatusItem label="Progress" value={lastSummary.progressLabel} />
              <StatusItem label="Last synced" value={String(lastSummary.payRunsSynced)} />
              <StatusItem label="Wage lines" value={String(lastSummary.wageLinesInserted)} />
            </>
          )}
        </div>

        {status && (
          <div className="mt-3 rounded-xl bg-blue-50 px-3 py-2 font-semibold text-blue-700">
            {status}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 font-semibold text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-bold text-slate-600">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}

function PresetButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="font-bold text-slate-500">{label}</div>
      <div className="mt-0.5 break-words font-semibold text-slate-900">{value}</div>
    </div>
  );
}
