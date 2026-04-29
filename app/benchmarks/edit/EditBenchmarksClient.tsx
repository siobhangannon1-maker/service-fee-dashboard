"use client";

import { useEffect, useMemo, useState } from "react";
import KpiBenchmarksEditor from "./KpiBenchmarksEditor";

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
  green_heading?: string;
  green_intro?: string;
  green_actions_text?: string;
  orange_heading?: string;
  orange_intro?: string;
  orange_actions_text?: string;
  red_heading?: string;
  red_intro?: string;
  red_actions_text?: string;
};

type StatusTone = "green" | "orange" | "red";

const DEFAULT_STATUS_CONTENT: Record<
  StatusTone,
  { heading: string; intro: string; actionsText: string }
> = {
  green: {
    heading: "On target",
    intro: "This benchmark is currently being met.",
    actionsText: "Keep monitoring this category monthly",
  },
  orange: {
    heading: "Suggested actions",
    intro: "This benchmark is close to target. Monitor it before it worsens.",
    actionsText: "Watch the trend next month\nReview any recent cost increases",
  },
  red: {
    heading: "Suggested actions",
    intro: "This benchmark is above target. Review the items below first.",
    actionsText:
      "Review supplier invoices\nCompare against prior months\nCheck whether this cost rose faster than production",
  },
};

export default function EditBenchmarksClient() {
  const [benchmarks, setBenchmarks] = useState<ExpenseBenchmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const currentDate = new Date();
  const currentYear = String(currentDate.getFullYear());
  const currentMonth = String(currentDate.getMonth() + 1);

  const [fromYear, setFromYear] = useState(currentYear);
  const [fromMonth, setFromMonth] = useState(currentMonth);
  const [toYear, setToYear] = useState(currentYear);
  const [toMonth, setToMonth] = useState(currentMonth);

  const availableYears = useMemo(() => {
    const thisYear = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, index) => String(thisYear - index));
  }, []);

  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => {
      const monthNumber = index + 1;
      return {
        value: String(monthNumber),
        label: new Intl.DateTimeFormat("en-AU", { month: "long" }).format(
          new Date(2000, index, 1)
        ),
      };
    });
  }, []);

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

      setBenchmarks((Array.isArray(data) ? data : []).map(withDefaultAdvice));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load benchmarks");
    } finally {
      setLoading(false);
    }
  }

  function updateField(index: number, field: keyof ExpenseBenchmark, value: string) {
    setBenchmarks((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: isNumericBenchmarkField(field)
                ? value === ""
                  ? 0
                  : Number(value)
                : value,
            }
          : row
      )
    );
  }

  function addNewCategoryRow() {
    setBenchmarks((current) => [
      ...current,
      withDefaultAdvice({
        id: null,
        category_name: "",
        target_percent: 0,
        green_min: 0,
        green_max: 0,
        orange_min: 0,
        orange_max: 0,
        red_min: 0,
      }),
    ]);
  }

  function toggleAdviceRow(key: string) {
    setExpandedRows((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  async function saveBenchmarksOnly() {
    const payload = benchmarks.map((row) => ({
      ...row,
      category_name: row.category_name.trim(),
      green_heading: (row.green_heading || "").trim(),
      green_intro: (row.green_intro || "").trim(),
      green_actions_text: normalizeActionsText(row.green_actions_text),
      orange_heading: (row.orange_heading || "").trim(),
      orange_intro: (row.orange_intro || "").trim(),
      orange_actions_text: normalizeActionsText(row.orange_actions_text),
      red_heading: (row.red_heading || "").trim(),
      red_intro: (row.red_intro || "").trim(),
      red_actions_text: normalizeActionsText(row.red_actions_text),
    }));

    const response = await fetch("/api/benchmarks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to save benchmarks");
    }

    setBenchmarks((Array.isArray(result.data) ? result.data : []).map(withDefaultAdvice));

    const renamedMappings = Array.isArray(result.renamedMappings) ? result.renamedMappings : [];

    if (renamedMappings.length > 0) {
      const renameText = renamedMappings
        .map((item: { oldName: string; newName: string }) => `${item.oldName} → ${item.newName}`)
        .join(", ");

      return {
        renamedMappings,
        saveMessage: `Benchmarks saved successfully. Updated mappings: ${renameText}`,
      };
    }

    return {
      renamedMappings: [],
      saveMessage: "Benchmarks saved successfully.",
    };
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError("");
      setMessage("");

      const result = await saveBenchmarksOnly();
      setMessage(
        `${result.saveMessage} Reprocess the affected months to update the reports pages.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save benchmarks");
    } finally {
      setSaving(false);
    }
  }

  function buildMonthRange(
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number
  ) {
    const start = new Date(startYear, startMonth - 1, 1);
    const end = new Date(endYear, endMonth - 1, 1);

    if (start > end) {
      throw new Error("The From period must be earlier than or equal to the To period.");
    }

    const months: Array<{ year: number; month: number; label: string }> = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;

      months.push({
        year,
        month,
        label: `${year}-${String(month).padStart(2, "0")}`,
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
  }

  async function processSingleMonth(year: number, month: number) {
    const response = await fetch("/api/xero/process-profit-and-loss", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ year, month }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || `Failed to process ${year}-${String(month).padStart(2, "0")}`);
    }
  }

  async function handleSaveAndReprocessRange() {
    try {
      setSaving(true);
      setReprocessing(true);
      setError("");
      setMessage("");

      const saveResult = await saveBenchmarksOnly();

      const startYear = Number(fromYear);
      const startMonth = Number(fromMonth);
      const endYear = Number(toYear);
      const endMonth = Number(toMonth);

      if (
        !Number.isInteger(startYear) ||
        !Number.isInteger(startMonth) ||
        !Number.isInteger(endYear) ||
        !Number.isInteger(endMonth)
      ) {
        throw new Error("Please choose a valid From and To month.");
      }

      const monthsToProcess = buildMonthRange(startYear, startMonth, endYear, endMonth);

      for (const item of monthsToProcess) {
        await processSingleMonth(item.year, item.month);
      }

      setMessage(
        `${saveResult.saveMessage} Reprocessed ${monthsToProcess.length} month(s): ${monthsToProcess[0].label} to ${monthsToProcess[monthsToProcess.length - 1].label}.`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save benchmarks and reprocess the selected range"
      );
    } finally {
      setSaving(false);
      setReprocessing(false);
    }
  }

  const completedAdviceCount = useMemo(() => {
    return benchmarks.filter(
      (row) =>
        Boolean(row.green_intro || row.green_actions_text) ||
        Boolean(row.orange_intro || row.orange_actions_text) ||
        Boolean(row.red_intro || row.red_actions_text)
    ).length;
  }, [benchmarks]);

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
      <p style={subheadingStyle}>
        Update benchmark categories and ranges, add new benchmark categories, and edit the text that
        appears inside the green, orange, and red hover popovers on the benchmarks page.
      </p>

      <div style={infoPanelStyle}>
        <div style={infoTitleStyle}>Important</div>
        <div style={infoTextStyle}>
          Saving benchmark changes does not automatically update your saved monthly benchmark reports.
        </div>
        <div style={infoTextStyle}>
          Use <strong>Save and Reprocess Range</strong> to refresh the selected months on
          <strong> benchmark/expense-reports</strong> and
          <strong> practice-manager/benchmark-analysis</strong>.
        </div>
        <div style={infoTextStyle}>
          If you changed a category name, also review <strong>benchmarks/mappings</strong>.
        </div>
      </div>

      <div style={infoPanelStyle}>
        <div style={infoTitleStyle}>How the advice text works</div>
        <div style={infoTextStyle}>
          Each benchmark can now have separate popover text for green, orange, and red. Put one
          action per line in the actions box. Those lines will be shown as the bullet-style action
          items in the popover.
        </div>
        <div style={infoTextStyle}>
          Advice added for <strong>{completedAdviceCount}</strong> of <strong>{benchmarks.length}</strong>{" "}
          benchmark categories.
        </div>
      </div>

      {message && <div style={successStyle}>{message}</div>}
      {error && <div style={errorStyle}>{error}</div>}

      <div style={toolbarStyle}>
        <button
          onClick={addNewCategoryRow}
          style={secondaryButtonStyle}
          disabled={saving || reprocessing}
        >
          Add New Category
        </button>

        <div style={rangeGroupStyle}>
          <div style={rangeBlockStyle}>
            <div style={rangeLabelStyle}>From</div>
            <select
              value={fromYear}
              onChange={(e) => setFromYear(e.target.value)}
              style={selectStyle}
              disabled={saving || reprocessing}
            >
              {availableYears.map((year) => (
                <option key={`from-year-${year}`} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)}
              style={selectStyle}
              disabled={saving || reprocessing}
            >
              {monthOptions.map((month) => (
                <option key={`from-month-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>

          <div style={rangeBlockStyle}>
            <div style={rangeLabelStyle}>To</div>
            <select
              value={toYear}
              onChange={(e) => setToYear(e.target.value)}
              style={selectStyle}
              disabled={saving || reprocessing}
            >
              {availableYears.map((year) => (
                <option key={`to-year-${year}`} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <select
              value={toMonth}
              onChange={(e) => setToMonth(e.target.value)}
              style={selectStyle}
              disabled={saving || reprocessing}
            >
              {monthOptions.map((month) => (
                <option key={`to-month-${month.value}`} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || reprocessing}
          style={secondaryButtonStyle}
        >
          {saving && !reprocessing ? "Saving..." : "Save Changes"}
        </button>

        <button
          onClick={handleSaveAndReprocessRange}
          disabled={saving || reprocessing}
          style={buttonStyle}
        >
          {reprocessing ? "Saving and Reprocessing..." : "Save and Reprocess Range"}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Advice</th>
              <th style={thStyle}>Target %</th>
              <th style={thStyle}>Green Min</th>
              <th style={thStyle}>Green Max</th>
              <th style={thStyle}>Orange Min</th>
              <th style={thStyle}>Orange Max</th>
              <th style={thStyle}>Red Min</th>
              <th style={thStyle}>Advice Text</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((row, index) => {
              const rowKey = String(row.id ?? `new-${index}`);
              const isExpanded = Boolean(expandedRows[rowKey]);

              return (
                <FragmentRows key={rowKey}>
                  <tr>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row.category_name}
                        onChange={(e) => updateField(index, "category_name", e.target.value)}
                        style={inputStyle}
                        placeholder="e.g. Staff Wages and Superannuation"
                      />
                    </td>
                    <td style={tdStyle}>
                      <div style={adviceCellStyle}>
                        <div style={adviceSummaryStyle}>
                          <div style={adviceSummaryTextStyle}>Edit popover text.</div>
                          <button
                            type="button"
                            onClick={() => toggleAdviceRow(rowKey)}
                            style={smallSecondaryButtonStyle}
                          >
                            {isExpanded ? "Hide Advice" : "Edit Advice"}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.target_percent}
                        onChange={(e) => updateField(index, "target_percent", e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.green_min}
                        onChange={(e) => updateField(index, "green_min", e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.green_max}
                        onChange={(e) => updateField(index, "green_max", e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.orange_min}
                        onChange={(e) => updateField(index, "orange_min", e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.orange_max}
                        onChange={(e) => updateField(index, "orange_max", e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.red_min}
                        onChange={(e) => updateField(index, "red_min", e.target.value)}
                        style={inputStyle}
                      />
                    </td>
                  </tr>

                  {isExpanded ? (
                    <tr>
                      <td style={expandedTdStyle} colSpan={8}>
                        <div style={adviceGridStyle}>
                          <StatusEditorCard
                            tone="green"
                            row={row}
                            index={index}
                            updateField={updateField}
                          />
                          <StatusEditorCard
                            tone="orange"
                            row={row}
                            index={index}
                            updateField={updateField}
                          />
                          <StatusEditorCard
                            tone="red"
                            row={row}
                            index={index}
                            updateField={updateField}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </FragmentRows>
              );
            })}
          </tbody>
        </table>
      </div>

      <KpiBenchmarksEditor />
    </main>
  );
}

function FragmentRows({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

function StatusEditorCard({
  tone,
  row,
  index,
  updateField,
}: {
  tone: StatusTone;
  row: ExpenseBenchmark;
  index: number;
  updateField: (index: number, field: keyof ExpenseBenchmark, value: string) => void;
}) {
  const fieldMap = getStatusFieldMap(tone);

  return (
    <div style={statusCardStyle(tone)}>
      <div style={statusCardTitleStyle}>{capitalize(tone)} popover</div>

      <label style={labelStyle}>
        Heading
        <input
          type="text"
          value={String(row[fieldMap.heading] || "")}
          onChange={(e) => updateField(index, fieldMap.heading, e.target.value)}
          style={inputStyle}
          placeholder={DEFAULT_STATUS_CONTENT[tone].heading}
        />
      </label>

      <label style={labelStyle}>
        Intro text
        <textarea
          value={String(row[fieldMap.intro] || "")}
          onChange={(e) => updateField(index, fieldMap.intro, e.target.value)}
          style={textareaStyle}
          placeholder={DEFAULT_STATUS_CONTENT[tone].intro}
          rows={3}
        />
      </label>

      <label style={labelStyle}>
        Actions (one per line)
        <textarea
          value={String(row[fieldMap.actions] || "")}
          onChange={(e) => updateField(index, fieldMap.actions, e.target.value)}
          style={largeTextareaStyle}
          placeholder={DEFAULT_STATUS_CONTENT[tone].actionsText}
          rows={6}
        />
      </label>
    </div>
  );
}

function withDefaultAdvice(row: ExpenseBenchmark): ExpenseBenchmark {
  return {
    ...row,
    green_heading: row.green_heading ?? DEFAULT_STATUS_CONTENT.green.heading,
    green_intro: row.green_intro ?? DEFAULT_STATUS_CONTENT.green.intro,
    green_actions_text: row.green_actions_text ?? DEFAULT_STATUS_CONTENT.green.actionsText,
    orange_heading: row.orange_heading ?? DEFAULT_STATUS_CONTENT.orange.heading,
    orange_intro: row.orange_intro ?? DEFAULT_STATUS_CONTENT.orange.intro,
    orange_actions_text: row.orange_actions_text ?? DEFAULT_STATUS_CONTENT.orange.actionsText,
    red_heading: row.red_heading ?? DEFAULT_STATUS_CONTENT.red.heading,
    red_intro: row.red_intro ?? DEFAULT_STATUS_CONTENT.red.intro,
    red_actions_text: row.red_actions_text ?? DEFAULT_STATUS_CONTENT.red.actionsText,
  };
}

function getStatusFieldMap(tone: StatusTone) {
  if (tone === "green") {
    return {
      heading: "green_heading" as keyof ExpenseBenchmark,
      intro: "green_intro" as keyof ExpenseBenchmark,
      actions: "green_actions_text" as keyof ExpenseBenchmark,
    };
  }

  if (tone === "orange") {
    return {
      heading: "orange_heading" as keyof ExpenseBenchmark,
      intro: "orange_intro" as keyof ExpenseBenchmark,
      actions: "orange_actions_text" as keyof ExpenseBenchmark,
    };
  }

  return {
    heading: "red_heading" as keyof ExpenseBenchmark,
    intro: "red_intro" as keyof ExpenseBenchmark,
    actions: "red_actions_text" as keyof ExpenseBenchmark,
  };
}

function isNumericBenchmarkField(field: keyof ExpenseBenchmark) {
  return [
    "target_percent",
    "green_min",
    "green_max",
    "orange_min",
    "orange_max",
    "red_min",
  ].includes(field);
}

function normalizeActionsText(value: string | undefined) {
  return (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const pageStyle: React.CSSProperties = {
  padding: "24px",
  fontFamily: "Arial, sans-serif",
  maxWidth: "1600px",
  margin: "0 auto",
};

const headingStyle: React.CSSProperties = {
  marginBottom: "12px",
};

const subheadingStyle: React.CSSProperties = {
  marginBottom: "20px",
  color: "#475569",
  lineHeight: 1.5,
};

const infoPanelStyle: React.CSSProperties = {
  marginBottom: "16px",
  padding: "16px",
  backgroundColor: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "12px",
};

const infoTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: "8px",
  color: "#1e3a8a",
};

const infoTextStyle: React.CSSProperties = {
  color: "#1e40af",
  fontSize: "14px",
  lineHeight: 1.5,
  marginBottom: "6px",
};

const toolbarStyle: React.CSSProperties = {
  marginBottom: "16px",
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  alignItems: "center",
};

const rangeGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: "16px",
  flexWrap: "wrap",
  alignItems: "center",
};

const rangeBlockStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};

const rangeLabelStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#334155",
  minWidth: "36px",
};

const selectStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: "14px",
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  backgroundColor: "#ffffff",
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
  minWidth: "1220px",
  backgroundColor: "#ffffff",
};

const thStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: "12px",
  textAlign: "left",
  backgroundColor: "#f3f4f6",
  fontWeight: 700,
  verticalAlign: "top",
};

const tdStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  padding: "12px",
  verticalAlign: "top",
};

const expandedTdStyle: React.CSSProperties = {
  ...tdStyle,
  backgroundColor: "#f8fafc",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  fontSize: "14px",
  border: "1px solid #cbd5e1",
  borderRadius: "6px",
  boxSizing: "border-box",
  backgroundColor: "#ffffff",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: "84px",
  resize: "vertical",
  fontFamily: "Arial, sans-serif",
};

const largeTextareaStyle: React.CSSProperties = {
  ...textareaStyle,
  minHeight: "140px",
  whiteSpace: "pre-wrap",
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

const smallSecondaryButtonStyle: React.CSSProperties = {
  backgroundColor: "#e2e8f0",
  color: "#0f172a",
  border: "none",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "13px",
  cursor: "pointer",
  whiteSpace: "nowrap",
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

const adviceCellStyle: React.CSSProperties = {
  minWidth: "260px",
};

const adviceSummaryStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
};

const adviceSummaryTextStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: "13px",
  lineHeight: 1.4,
};

const adviceGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "16px",
  alignItems: "start",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "#334155",
};

const statusCardTitleStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  marginBottom: "12px",
};

function statusCardStyle(tone: StatusTone): React.CSSProperties {
  const toneStyles: Record<StatusTone, React.CSSProperties> = {
    green: {
      backgroundColor: "#ecfdf5",
      border: "1px solid #a7f3d0",
    },
    orange: {
      backgroundColor: "#fffbeb",
      border: "1px solid #fde68a",
    },
    red: {
      backgroundColor: "#fef2f2",
      border: "1px solid #fecaca",
    },
  };

  return {
    borderRadius: "12px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    ...toneStyles[tone],
  };
}