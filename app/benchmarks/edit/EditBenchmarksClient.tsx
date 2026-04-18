"use client";

import { useEffect, useState } from "react";

type ExpenseBenchmark = {
  id?: number | null;
  category_name: string;
  target_percent: number;
  green_min: number;
  green_max: number;
  orange_min: number;
  orange_max: number;
  red_min: number;
  created_at?: string;
  updated_at?: string;
};

export default function EditBenchmarksClient() {
  const [benchmarks, setBenchmarks] = useState<ExpenseBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void loadBenchmarks();
  }, []);

  async function loadBenchmarks() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      const response = await fetch("/api/benchmarks");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to load benchmarks");
      }

      setBenchmarks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load benchmarks");
    } finally {
      setLoading(false);
    }
  }

  function updateField(
    index: number,
    field: keyof ExpenseBenchmark,
    value: string
  ) {
    setBenchmarks((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]:
                field === "category_name"
                  ? value
                  : value === ""
                  ? 0
                  : Number(value),
            }
          : row
      )
    );
  }

  function addNewCategoryRow() {
    setBenchmarks((current) => [
      ...current,
      {
        id: null,
        category_name: "",
        target_percent: 0,
        green_min: 0,
        green_max: 0,
        orange_min: 0,
        orange_max: 0,
        red_min: 0,
      },
    ]);
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError("");
      setMessage("");

      const response = await fetch("/api/benchmarks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(benchmarks),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save benchmarks");
      }

      setMessage("Benchmarks saved successfully");
      setBenchmarks(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save benchmarks");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <h1 style={headingStyle}>Edit Benchmarks</h1>
        <p>Loading benchmarks...</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={headingStyle}>Edit Benchmarks</h1>
      <p style={{ marginBottom: "20px" }}>
        Update benchmark categories and ranges, or add a new benchmark category.
      </p>

      {message && <div style={successStyle}>{message}</div>}
      {error && <div style={errorStyle}>{error}</div>}

      <div style={{ marginBottom: "16px", display: "flex", gap: "12px" }}>
        <button onClick={addNewCategoryRow} style={secondaryButtonStyle}>
          Add New Category
        </button>

        <button onClick={handleSave} disabled={saving} style={buttonStyle}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Target %</th>
              <th style={thStyle}>Green Min</th>
              <th style={thStyle}>Green Max</th>
              <th style={thStyle}>Orange Min</th>
              <th style={thStyle}>Orange Max</th>
              <th style={thStyle}>Red Min</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((row, index) => (
              <tr key={row.id ?? `new-${index}`}>
                <td style={tdStyle}>
                  <input
                    type="text"
                    value={row.category_name}
                    onChange={(e) =>
                      updateField(index, "category_name", e.target.value)
                    }
                    style={inputStyle}
                    placeholder="e.g. Admin Expenses"
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    step="0.01"
                    value={row.target_percent}
                    onChange={(e) =>
                      updateField(index, "target_percent", e.target.value)
                    }
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    step="0.01"
                    value={row.green_min}
                    onChange={(e) =>
                      updateField(index, "green_min", e.target.value)
                    }
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    step="0.01"
                    value={row.green_max}
                    onChange={(e) =>
                      updateField(index, "green_max", e.target.value)
                    }
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    step="0.01"
                    value={row.orange_min}
                    onChange={(e) =>
                      updateField(index, "orange_min", e.target.value)
                    }
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    step="0.01"
                    value={row.orange_max}
                    onChange={(e) =>
                      updateField(index, "orange_max", e.target.value)
                    }
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    type="number"
                    step="0.01"
                    value={row.red_min}
                    onChange={(e) =>
                      updateField(index, "red_min", e.target.value)
                    }
                    style={inputStyle}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  padding: "24px",
  fontFamily: "Arial, sans-serif",
};

const headingStyle: React.CSSProperties = {
  marginBottom: "12px",
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  minWidth: "1000px",
  backgroundColor: "#ffffff",
};

const thStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: "12px",
  textAlign: "left",
  backgroundColor: "#f3f4f6",
  fontWeight: 700,
};

const tdStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: "12px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  fontSize: "14px",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: "8px",
  padding: "10px 16px",
  fontSize: "14px",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  backgroundColor: "#e5e7eb",
  color: "#111827",
  border: "none",
  borderRadius: "8px",
  padding: "10px 16px",
  fontSize: "14px",
  cursor: "pointer",
};

const successStyle: React.CSSProperties = {
  marginBottom: "16px",
  padding: "12px",
  backgroundColor: "#dcfce7",
  color: "#166534",
  borderRadius: "8px",
};

const errorStyle: React.CSSProperties = {
  marginBottom: "16px",
  padding: "12px",
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  borderRadius: "8px",
};