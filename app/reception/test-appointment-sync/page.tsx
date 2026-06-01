// src/app/reception/test-appointment-sync/page.tsx

"use client";

import { useState } from "react";

export default function TestAppointmentSyncPage() {
  const [fromDate, setFromDate] = useState("2026-06-01");
  const [toDate, setToDate] = useState("2026-06-07");
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function syncAppointments() {
    setLoading(true);
    setResult("");

    const response = await fetch("/api/praktika/sync-appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fromDate, toDate }),
    });

    const data = await response.json();

    setResult(JSON.stringify(data, null, 2));
    setLoading(false);
  }

  return (
    <main className="p-6 max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Appointment Sync Test</h1>
        <p className="text-sm text-gray-600">
          Sync Praktika appointments into local tables.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium">From date</label>
        <input
          type="date"
          className="border rounded-lg p-2 w-full"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">To date</label>
        <input
          type="date"
          className="border rounded-lg p-2 w-full"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />
      </div>

      <button
        onClick={syncAppointments}
        disabled={loading}
        className="bg-black text-white px-4 py-2 rounded-lg disabled:opacity-50"
      >
        {loading ? "Syncing..." : "Sync appointments"}
      </button>

      {result && (
        <pre className="bg-gray-100 rounded-lg p-4 text-xs overflow-auto">
          {result}
        </pre>
      )}
    </main>
  );
}