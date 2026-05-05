"use client";

import { useEffect, useState } from "react";

type PracticeKpiBenchmark = {
  id?: string | null;
  metric_key: string;
  metric_label: string;
  metric_type: "percentage" | "number" | "currency" | "hours";
  higher_is_better: boolean;
  target_value: number;
  green_min: number;
  green_max: number;
  orange_min: number;
  orange_max: number;
  red_min: number;
};

const DEFAULT_ROWS: PracticeKpiBenchmark[] = [
  {
    metric_key: "referral_booking_rate",
    metric_label: "Referral Booking Rate",
    metric_type: "percentage",
    higher_is_better: true,
    target_value: 0.85,
    green_min: 0.85,
    green_max: 1,
    orange_min: 0.7,
    orange_max: 0.8499,
    red_min: 0,
  },
  {
    metric_key: "gap_pct",
    metric_label: "Gap %",
    metric_type: "percentage",
    higher_is_better: false,
    target_value: 0.15,
    green_min: 0,
    green_max: 0.15,
    orange_min: 0.1501,
    orange_max: 0.2,
    red_min: 0.2001,
  },
  {
    metric_key: "fta_pct",
    metric_label: "FTA %",
    metric_type: "percentage",
    higher_is_better: false,
    target_value: 0.05,
    green_min: 0,
    green_max: 0.05,
    orange_min: 0.0501,
    orange_max: 0.08,
    red_min: 0.0801,
  },
  {
    metric_key: "cancel_no_rebook_pct",
    metric_label: "Cancellation No Rebook %",
    metric_type: "percentage",
    higher_is_better: false,
    target_value: 0.1,
    green_min: 0,
    green_max: 0.1,
    orange_min: 0.1001,
    orange_max: 0.15,
    red_min: 0.1501,
  },
  {
    metric_key: "overtime_hours",
    metric_label: "Overtime Hours",
    metric_type: "hours",
    higher_is_better: false,
    target_value: 10,
    green_min: 0,
    green_max: 10,
    orange_min: 10.01,
    orange_max: 20,
    red_min: 20.01,
  },
  {
    metric_key: "billing_staffing_pct",
    metric_label: "Billing / Staffing %",
    metric_type: "percentage",
    higher_is_better: false,
    target_value: 0.25,
    green_min: 0,
    green_max: 0.25,
    orange_min: 0.2501,
    orange_max: 0.3,
    red_min: 0.3001,
  },
];

function fieldClassName() {
  return "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";
}

function mergeRows(rows: PracticeKpiBenchmark[]) {
  const map = new Map(DEFAULT_ROWS.map((row) => [row.metric_key, row]));

  rows.forEach((row) => {
    map.set(row.metric_key, {
      ...map.get(row.metric_key),
      ...row,
    });
  });

  return Array.from(map.values());
}

async function readJsonSafely(response: Response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

function toDisplayPercent(value: number) {
  return String(Math.round(value * 10000) / 100);
}

function fromDisplayPercent(value: string) {
  if (value.trim() === "") return 0;
  return Number(value) / 100;
}

function getValue(row: PracticeKpiBenchmark, field: keyof PracticeKpiBenchmark) {
  const value = row[field];

  if (typeof value !== "number") return String(value ?? "");

  if (row.metric_type === "percentage") {
    return toDisplayPercent(value);
  }

  return String(value);
}

export default function KpiBenchmarksEditor() {
  const [rows, setRows] = useState<PracticeKpiBenchmark[]>(DEFAULT_ROWS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadRows();
  }, []);

  async function loadRows() {
    try {
      setLoading(true);
      setMessage("");
      setError("");

      const response = await fetch("/api/kpi-benchmarks");
      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to load KPI benchmarks");
      }

      setRows(mergeRows(Array.isArray(data) ? data : []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load KPI benchmarks");
    } finally {
      setLoading(false);
    }
  }

  function updateField(
    index: number,
    field: keyof PracticeKpiBenchmark,
    value: string
  ) {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;

        const numericFields: Array<keyof PracticeKpiBenchmark> = [
          "target_value",
          "green_min",
          "green_max",
          "orange_min",
          "orange_max",
          "red_min",
        ];

        if (numericFields.includes(field)) {
          return {
            ...row,
            [field]:
              row.metric_type === "percentage"
                ? fromDisplayPercent(value)
                : Number(value || 0),
          };
        }

        return {
          ...row,
          [field]: value,
        };
      })
    );
  }

  async function saveRows() {
    try {
      setSaving(true);
      setMessage("");
      setError("");

      const response = await fetch("/api/kpi-benchmarks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(rows),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to save KPI benchmarks");
      }

      setRows(mergeRows(Array.isArray(data?.data) ? data.data : []));
      setMessage("KPI benchmarks saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save KPI benchmarks");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">
          Practice KPI Benchmarks
        </h2>
        <p className="mt-2 text-sm text-slate-500">Loading KPI benchmarks...</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Practice KPI Benchmarks
          </h2>

          <p className="mt-1 text-sm leading-6 text-slate-500">
            Enter percentage values as normal percentages, for example 5 = 5%.
            Other metrics like hours should be entered as plain numbers.
          </p>
        </div>

        <button
          type="button"
          onClick={saveRows}
          disabled={saving}
          className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save KPI Benchmarks"}
        </button>
      </div>

      {message ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-[980px] w-full divide-y divide-slate-100 bg-white text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                KPI
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Key
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Target
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Green Min
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Green Max
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Amber Min
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Amber Max
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                Red Min
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={row.metric_key} className="hover:bg-slate-50">
                <td className="px-4 py-3 align-top">
                  <input
                    value={row.metric_label}
                    onChange={(event) =>
                      updateField(index, "metric_label", event.target.value)
                    }
                    className={fieldClassName()}
                  />
                </td>

                <td className="px-4 py-3 align-top">
                  <code className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">
                    {row.metric_key}
                  </code>
                </td>

                {(
                  [
                    "target_value",
                    "green_min",
                    "green_max",
                    "orange_min",
                    "orange_max",
                    "red_min",
                  ] as const
                ).map((field) => (
                  <td key={field} className="px-4 py-3 align-top">
                    <input
                      type="number"
                      step="0.01"
                      value={getValue(row, field)}
                      onChange={(event) =>
                        updateField(index, field, event.target.value)
                      }
                      className={fieldClassName()}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
