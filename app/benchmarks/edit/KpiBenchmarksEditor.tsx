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
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Practice KPI Benchmarks</h2>
        <p>Loading KPI benchmarks...</p>
      </section>
    );
  }

  return (
    <section style={sectionStyle}>
      <h2 style={headingStyle}>Practice KPI Benchmarks</h2>

      <p style={subheadingStyle}>
        Enter percentage values as normal percentages, for example 5 = 5%.
        Other metrics like hours should be entered as plain numbers.
      </p>

      {message ? <div style={successStyle}>{message}</div> : null}
      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>KPI</th>
              <th style={thStyle}>Key</th>
              <th style={thStyle}>Target</th>
              <th style={thStyle}>Green Min</th>
              <th style={thStyle}>Green Max</th>
              <th style={thStyle}>Amber Min</th>
              <th style={thStyle}>Amber Max</th>
              <th style={thStyle}>Red Min</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={row.metric_key}>
                <td style={tdStyle}>
                  <input
                    value={row.metric_label}
                    onChange={(event) =>
                      updateField(index, "metric_label", event.target.value)
                    }
                    style={inputStyle}
                  />
                </td>

                <td style={tdStyle}>
                  <code>{row.metric_key}</code>
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
                  <td key={field} style={tdStyle}>
                    <input
                      type="number"
                      step="0.01"
                      value={getValue(row, field)}
                      onChange={(event) =>
                        updateField(index, field, event.target.value)
                      }
                      style={inputStyle}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={saveRows}
          disabled={saving}
          style={{
            ...buttonStyle,
            opacity: saving ? 0.7 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving..." : "Save KPI Benchmarks"}
        </button>
      </div>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  marginTop: 40,
  paddingTop: 28,
  borderTop: "2px solid #e5e7eb",
};

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 8,
};

const subheadingStyle: React.CSSProperties = {
  color: "#475569",
  lineHeight: 1.5,
  marginBottom: 16,
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  minWidth: 980,
  backgroundColor: "#fff",
};

const thStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: 12,
  textAlign: "left",
  backgroundColor: "#f3f4f6",
  fontWeight: 700,
};

const tdStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: 12,
  verticalAlign: "top",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  fontSize: 14,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  boxSizing: "border-box",
  backgroundColor: "#fff",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 14,
};

const successStyle: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  backgroundColor: "#dcfce7",
  color: "#166534",
  borderRadius: 8,
};

const errorStyle: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  borderRadius: 8,
};