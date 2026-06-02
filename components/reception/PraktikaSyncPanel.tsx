"use client";

import { useState } from "react";

async function readJsonSafely(response: Response) {
  const text = await response.text();

  if (!text) {
    return {
      error: `Request failed with status ${response.status}. No response body.`,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: `Request failed with status ${
        response.status
      }. Response was not JSON: ${text.slice(0, 200)}`,
    };
  }
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIsoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function PraktikaSyncPanel() {
  const [loading, setLoading] = useState<
    "recent" | "all" | "appointments" | null
  >(null);

  const [message, setMessage] = useState("");
  const [fromDate, setFromDate] = useState(todayIsoDate());
  const [toDate, setToDate] = useState(plusDaysIsoDate(14));

  async function syncPatients(mode: "recent" | "all") {
    setLoading(mode);
    setMessage("");

    const response = await fetch("/api/praktika/sync-patients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode,
        pageSize: 500,
        maxPages: mode === "all" ? 100 : 2,
      }),
    });

    const data = await readJsonSafely(response);
    setLoading(null);

    if (!response.ok) {
      setMessage(data.error || `Sync failed with status ${response.status}`);
      return;
    }

    setMessage(`Synced ${data.rowsUpserted} patients`);
    window.setTimeout(() => setMessage(""), 4000);
  }

  async function syncAppointments() {
    setLoading("appointments");
    setMessage("");

    const response = await fetch("/api/praktika/sync-appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fromDate,
        toDate,
      }),
    });

    const data = await readJsonSafely(response);
    setLoading(null);

    if (!response.ok) {
      setMessage(
        data.error || `Appointment sync failed with status ${response.status}`
      );
      return;
    }

    setMessage(`Synced ${data.syncedCount || 0} appointments`);
    window.setTimeout(() => setMessage(""), 5000);
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
      <div>
        <div className="mb-2 font-semibold text-slate-700">Patient sync</div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => syncPatients("recent")}
            disabled={loading !== null}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading === "recent" ? "Syncing..." : "Sync recent patients"}
          </button>

          <button
            type="button"
            onClick={() => syncPatients("all")}
            disabled={loading !== null}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading === "all" ? "Syncing all..." : "Sync all patients"}
          </button>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-slate-700">
            Appointment sync
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/reception/location-rules"
              className="font-semibold text-blue-600 hover:underline"
            >
              Location rules →
            </a>

            <a
              href="/reception/appointment-confirmations"
              className="font-semibold text-blue-600 hover:underline"
            >
              Confirmations →
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
              From
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
              To
            </span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
            />
          </label>

          <button
            type="button"
            onClick={syncAppointments}
            disabled={loading !== null || !fromDate || !toDate}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading === "appointments"
              ? "Syncing appointments..."
              : "Sync appointments"}
          </button>
        </div>
      </div>

      {message && <div className="text-slate-600">{message}</div>}
    </div>
  );
}