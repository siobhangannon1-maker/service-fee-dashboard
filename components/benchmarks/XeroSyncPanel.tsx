'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type SyncMode = 'raw' | 'process' | 'full';

type SyncResponse = {
  success?: boolean;
  message?: string;
  summary?: Record<string, unknown>;
};

type BillingMonthOption = {
  value: string;
  label: string;
  monthNumber: number;
};

type XeroSyncPanelProps = {
  availableYears: number[];
  selectedYear: string;
  selectedMonth: string;
  onYearChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  billingMonthOptions: BillingMonthOption[];
  onSyncComplete?: () => Promise<void> | void;
};

function buildMonthKey(year: string, month: string) {
  if (!year || !month) return '';
  return `${year}-${String(month).padStart(2, '0')}`;
}

export default function XeroSyncPanel({
  availableYears,
  selectedYear,
  selectedMonth,
  onYearChange,
  onMonthChange,
  billingMonthOptions,
  onSyncComplete,
}: XeroSyncPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [lastAction, setLastAction] = useState<SyncMode | null>(null);
  const [result, setResult] = useState<SyncResponse | null>(null);

  const monthKey = useMemo(
    () => buildMonthKey(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const canRun = Boolean(selectedYear && selectedMonth) && !isRunning;

  async function runAction(mode: SyncMode) {
    if (!selectedYear || !selectedMonth) {
      setResult({
        success: false,
        message: 'Please select a year and month first.',
      });
      return;
    }

    const year = Number(selectedYear);
    const month = Number(selectedMonth);

    try {
      setIsRunning(true);
      setLastAction(mode);
      setResult(null);

      if (mode === 'raw') {
        const rawResponse = await fetch('/api/xero/sync-profit-and-loss', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ year, month }),
        });

        const rawJson = (await rawResponse.json()) as SyncResponse;

        if (!rawResponse.ok) {
          throw new Error(rawJson.message || 'Raw Profit & Loss sync failed.');
        }

        setResult(rawJson);
      }

      if (mode === 'process') {
        const processResponse = await fetch('/api/xero/process-profit-and-loss', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ year, month }),
        });

        const processJson = (await processResponse.json()) as SyncResponse;

        if (!processResponse.ok) {
          throw new Error(processJson.message || 'Benchmark processing failed.');
        }

        setResult(processJson);
      }

      if (mode === 'full') {
        const rawResponse = await fetch('/api/xero/sync-profit-and-loss', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ year, month }),
        });

        const rawJson = (await rawResponse.json()) as SyncResponse;

        if (!rawResponse.ok) {
          throw new Error(rawJson.message || 'Raw Profit & Loss sync failed.');
        }

        const processResponse = await fetch('/api/xero/process-profit-and-loss', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ year, month }),
        });

        const processJson = (await processResponse.json()) as SyncResponse;

        if (!processResponse.ok) {
          throw new Error(processJson.message || 'Benchmark processing failed.');
        }

        setResult({
          success: true,
          message: 'Full Xero sync completed successfully.',
          summary: processJson.summary,
        });
      }

      await onSyncComplete?.();
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown sync error',
      });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Xero Sync</h2>
          <p className="mt-1 text-sm text-slate-500">
            Sync raw Profit &amp; Loss data from Xero, then process it into this dashboard’s
            benchmark tables.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/imports/upload/xero-upload"
            className="inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Upload Xero CSV
          </Link>

          <Link
            href="/benchmarks/mappings"
            className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Edit Mappings
          </Link>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Year
            </label>
            <select
              value={selectedYear}
              onChange={(e) => onYearChange(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Select year</option>
              {availableYears.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              <option value="">Select month</option>
              {billingMonthOptions.map((option) => (
                <option key={option.monthNumber} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Selected Period
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {monthKey || 'No month selected'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canRun}
            onClick={() => runAction('raw')}
            className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning && lastAction === 'raw' ? 'Syncing Raw P&L...' : 'Sync Raw P&L'}
          </button>

          <button
            type="button"
            disabled={!canRun}
            onClick={() => runAction('process')}
            className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning && lastAction === 'process'
              ? 'Processing Benchmark...'
              : 'Process Benchmark'}
          </button>

          <button
            type="button"
            disabled={!canRun}
            onClick={() => runAction('full')}
            className="inline-flex items-center rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isRunning && lastAction === 'full' ? 'Running Full Sync...' : 'Run Full Sync'}
          </button>
        </div>
      </div>

      {result ? (
        <div
          className={`mx-5 mb-5 rounded-2xl border px-4 py-3 text-sm ${
            result.success
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <div className="font-medium">{result.success ? 'Success' : 'Error'}</div>
          <div className="mt-1">{result.message || 'No message returned.'}</div>

          {result.summary ? (
            <pre className="mt-3 overflow-x-auto rounded-xl bg-white/70 p-3 text-xs text-slate-700">
              {JSON.stringify(result.summary, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}