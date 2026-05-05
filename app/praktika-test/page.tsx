"use client";

import { useState } from "react";

type ProviderPerformanceRow = {
  iPracticeId?: string;
  iProviderId?: string;
  vchProviderName?: string;
  iTotalPatients?: string;
  iDaysWorked?: string;
  nScheduledHours?: string;
  nBilledHours?: string;
  nActualFees?: string;
  nBilledAmount?: string;
  iTotalAppointments?: string;
  iNewPatients?: string;
  iTotalFTAs?: string;
  iTotalCancellations?: string;
  nRebookingPercent?: string;
};

export default function PraktikaTestPage() {
  const [fromDate, setFromDate] = useState("2026-04-29");
  const [toDate, setToDate] = useState("2026-04-29");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProviderPerformanceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<any>(null);

  async function fetchProviderPerformance() {
    setLoading(true);
    setError(null);
    setRows([]);
    setRawResponse(null);

    try {
      const response = await fetch("/api/praktika/provider-performance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromDate,
          toDate,
        }),
      });

      const json = await response.json();

      setRawResponse(json);

      if (!response.ok) {
        setError(json.error || "Request failed");
        return;
      }

      setRows(json.data || []);
    } catch (err) {
      console.error(err);
      setError("Failed to fetch Provider Performance report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Praktika Provider Performance Test</h1>
          <p className="mt-2 text-sm text-gray-600">
            This page fetches Provider Performance data from Praktika using your
            server-side session cookie.
          </p>
        </div>

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium">From date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium">To date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={fetchProviderPerformance}
                disabled={loading}
                className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                {loading ? "Fetching..." : "Fetch Provider Performance"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Rows returned: {rows.length}</h2>

          <div className="overflow-x-auto">
            <table className="min-w-full border text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-3 py-2 text-left">Provider</th>
                  <th className="border px-3 py-2 text-right">Patients</th>
                  <th className="border px-3 py-2 text-right">Days Worked</th>
                  <th className="border px-3 py-2 text-right">Scheduled Hours</th>
                  <th className="border px-3 py-2 text-right">Billed Hours</th>
                  <th className="border px-3 py-2 text-right">Actual Fees</th>
                  <th className="border px-3 py-2 text-right">Billed Amount</th>
                  <th className="border px-3 py-2 text-right">Appointments</th>
                  <th className="border px-3 py-2 text-right">New Patients</th>
                  <th className="border px-3 py-2 text-right">FTAs</th>
                  <th className="border px-3 py-2 text-right">Cancellations</th>
                  <th className="border px-3 py-2 text-right">Rebooking %</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.iProviderId || "provider"}-${index}`}>
                    <td className="border px-3 py-2">{row.vchProviderName}</td>
                    <td className="border px-3 py-2 text-right">{row.iTotalPatients}</td>
                    <td className="border px-3 py-2 text-right">{row.iDaysWorked}</td>
                    <td className="border px-3 py-2 text-right">{row.nScheduledHours}</td>
                    <td className="border px-3 py-2 text-right">{row.nBilledHours}</td>
                    <td className="border px-3 py-2 text-right">{row.nActualFees}</td>
                    <td className="border px-3 py-2 text-right">{row.nBilledAmount}</td>
                    <td className="border px-3 py-2 text-right">{row.iTotalAppointments}</td>
                    <td className="border px-3 py-2 text-right">{row.iNewPatients}</td>
                    <td className="border px-3 py-2 text-right">{row.iTotalFTAs}</td>
                    <td className="border px-3 py-2 text-right">{row.iTotalCancellations}</td>
                    <td className="border px-3 py-2 text-right">{row.nRebookingPercent}</td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td className="border px-3 py-4 text-center text-gray-500" colSpan={12}>
                      No rows loaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {rawResponse && (
          <details className="rounded-lg border bg-white p-4 shadow-sm">
            <summary className="cursor-pointer font-semibold">Raw response</summary>
            <pre className="mt-4 max-h-96 overflow-auto rounded bg-gray-100 p-4 text-xs">
              {JSON.stringify(rawResponse, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
}