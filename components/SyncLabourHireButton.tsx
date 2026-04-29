"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SyncLabourHireButtonProps = {
  defaultFrom: string;
  defaultTo: string;
};

export default function SyncLabourHireButton({
  defaultFrom,
  defaultTo,
}: SyncLabourHireButtonProps) {
  const router = useRouter();

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function handleSync() {
    setLoading(true);
    setResult(null);

    try {
      const url = `/api/xero/labour-hire-sync?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}`;

      const res = await fetch(url);
      const data = await res.json();

      setResult({
        requestUrl: url,
        ...data,
      });

      router.refresh();
    } catch (err: any) {
      setResult({
        success: false,
        error: err.message || "Labour hire sync failed",
      });
    } finally {
      setLoading(false);
    }
  }

  const success = result && result.success !== false && !result.error;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="grid gap-3">
        <DateField label="From date" value={from} disabled={loading} onChange={setFrom} />
        <DateField label="To date" value={to} disabled={loading} onChange={setTo} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
        <div className="font-bold text-slate-900">What this sync updates</div>
        <div className="mt-1">
          Pulls Xero account 440 Labour Hire so temporary staffing costs are
          included in the wage analysis.
        </div>
      </div>

      <button
        type="button"
        onClick={handleSync}
        disabled={loading || !from || !to}
        className="mt-auto rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Syncing labour hire..." : "Sync Labour Hire"}
      </button>

      {result && (
        <div
          className={`rounded-2xl border p-3 text-xs ${
            success
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <div className="font-bold">
            {success ? "Labour hire sync complete" : "Labour hire sync needs attention"}
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-white/70 p-3 text-[11px] leading-5">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
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
