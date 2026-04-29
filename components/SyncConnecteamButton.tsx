"use client";

import { useState } from "react";

export default function SyncConnecteamButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  async function handleSync() {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`/api/connecteam/sync?from=${from}&to=${to}`, {
        method: "GET",
      });

      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }

      setResult(data);
    } catch (err) {
      console.error(err);
      setResult({ success: false, error: "Sync failed" });
    }

    setLoading(false);
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
          Imports daily Connecteam timesheets used for overtime-day checks and
          staff hover details.
        </div>
      </div>

      <button
        type="button"
        onClick={handleSync}
        disabled={loading || !from || !to}
        className="mt-auto rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Syncing Connecteam..." : "Sync Connecteam"}
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
            {success ? "Connecteam sync complete" : "Connecteam sync needs attention"}
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
