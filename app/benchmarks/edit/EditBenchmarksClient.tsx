"use client";

import { useEffect, useMemo, useState } from "react";
import PageLayout from "@/components/ui/PageLayout";
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

function fieldClassName() {
  return "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500";
}

function textareaClassName(extra = "") {
  return `w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${extra}`;
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-white shadow-sm backdrop-blur">
      <div className="text-xs font-semibold uppercase tracking-wide text-white/70">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-white/70">{helper}</div>
    </div>
  );
}

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

  async function readJsonSafely(response: Response) {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`API returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }

  async function loadBenchmarks() {
    try {
      setLoading(true);
      setError("");
      setMessage("");

      const response = await fetch("/api/benchmarks");
      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(data?.error || "Failed to load benchmarks");
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

    const result = await readJsonSafely(response);

    if (!response.ok) {
      throw new Error(result?.error || "Failed to save benchmarks");
    }

    setBenchmarks((Array.isArray(result?.data) ? result.data : []).map(withDefaultAdvice));

    const renamedMappings = Array.isArray(result?.renamedMappings)
      ? result.renamedMappings
      : [];

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

    const result = await readJsonSafely(response);

    if (!response.ok) {
      throw new Error(
        result?.message || `Failed to process ${year}-${String(month).padStart(2, "0")}`
      );
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

  const canInteract = !saving && !reprocessing;

  if (loading) {
    return (
      <PageLayout
        eyebrow="Admin"
        title="Edit Benchmarks"
        description="Manage expense benchmark thresholds, advice text, and KPI targets."
      >
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          Loading benchmarks...
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="Admin"
      title="Edit Benchmarks"
      description="Manage expense benchmark categories, traffic-light thresholds, advice popovers, and KPI benchmark targets."
    >
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-6 py-7">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
            <div>
              <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
                Benchmark configuration
              </div>

              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Keep benchmark rules and guidance consistent.
              </h2>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
                Update target ranges, category names, and hover advice text. Reprocess months when
                saved reports need to be refreshed with the latest benchmark settings.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label="Categories"
                value={benchmarks.length}
                helper="Expense benchmark rows"
              />
              <StatCard
                label="Advice"
                value={completedAdviceCount}
                helper="Rows with guidance"
              />
              <StatCard
                label="Status"
                value={reprocessing ? "Running" : saving ? "Saving" : "Ready"}
                helper="Current workflow"
              />
            </div>
          </div>
        </div>
      </section>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5">
          <h3 className="text-base font-semibold text-slate-950">Important</h3>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
            <p>
              Saving benchmark changes does not automatically update saved monthly benchmark
              reports.
            </p>
            <p>
              Use <strong>Save and Reprocess Range</strong> to refresh selected months on{" "}
              <strong>benchmark/expense-reports</strong> and{" "}
              <strong>practice-manager/benchmark-analysis</strong>.
            </p>
            <p>
              If you changed a category name, also review{" "}
              <strong>benchmarks/mappings</strong>.
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-950">
            How advice text works
          </h3>
          <div className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
            <p>
              Each benchmark can have separate popover text for green, orange,
              and red statuses.
            </p>
            <p>
              Put one action per line in the actions box. These lines appear as
              bullet-style action items in report popovers.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">
              Save and reprocess
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Save changes only, or save and refresh benchmark reports for a selected range.
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <button
              type="button"
              onClick={addNewCategoryRow}
              disabled={!canInteract}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              Add Category
            </button>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  From
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={fromYear}
                    onChange={(e) => setFromYear(e.target.value)}
                    className={fieldClassName()}
                    disabled={!canInteract}
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
                    className={fieldClassName()}
                    disabled={!canInteract}
                  >
                    {monthOptions.map((month) => (
                      <option key={`from-month-${month.value}`} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  To
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={toYear}
                    onChange={(e) => setToYear(e.target.value)}
                    className={fieldClassName()}
                    disabled={!canInteract}
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
                    className={fieldClassName()}
                    disabled={!canInteract}
                  >
                    {monthOptions.map((month) => (
                      <option key={`to-month-${month.value}`} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!canInteract}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            >
              {saving && !reprocessing ? "Saving..." : "Save Changes"}
            </button>

            <button
              type="button"
              onClick={handleSaveAndReprocessRange}
              disabled={!canInteract}
              className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
            >
              {reprocessing ? "Saving and Reprocessing..." : "Save and Reprocess"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="text-lg font-semibold text-slate-950">
            Expense benchmark categories
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Edit target percentages and traffic-light ranges for each expense category.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-[1220px] w-full divide-y divide-slate-100 bg-white text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Category
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Advice
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Target %
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Green Min
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Green Max
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Orange Min
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Orange Max
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Red Min
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {benchmarks.map((row, index) => {
                const rowKey = String(row.id ?? `new-${index}`);
                const isExpanded = Boolean(expandedRows[rowKey]);

                return (
                  <FragmentRows key={rowKey}>
                    <tr className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top">
                        <input
                          type="text"
                          value={row.category_name}
                          onChange={(e) => updateField(index, "category_name", e.target.value)}
                          className={fieldClassName()}
                          placeholder="e.g. Staff Wages and Superannuation"
                        />
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div className="flex min-w-[230px] items-center justify-between gap-3">
                          <div className="text-xs text-slate-500">
                            Popover guidance
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleAdviceRow(rowKey)}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                          >
                            {isExpanded ? "Hide Advice" : "Edit Advice"}
                          </button>
                        </div>
                      </td>

                      {(
                        [
                          "target_percent",
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
                            value={row[field]}
                            onChange={(e) => updateField(index, field, e.target.value)}
                            className={fieldClassName()}
                          />
                        </td>
                      ))}
                    </tr>

                    {isExpanded ? (
                      <tr>
                        <td colSpan={8} className="bg-slate-50 px-4 py-4">
                          <div className="grid gap-4 xl:grid-cols-3">
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
      </section>

      <KpiBenchmarksEditor />
    </PageLayout>
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
    <div className={statusCardClassName(tone)}>
      <div className="text-base font-semibold text-slate-950">
        {capitalize(tone)} popover
      </div>

      <label className="block text-sm font-medium text-slate-700">
        Heading
        <input
          type="text"
          value={String(row[fieldMap.heading] || "")}
          onChange={(e) => updateField(index, fieldMap.heading, e.target.value)}
          className={`mt-1 ${fieldClassName()}`}
          placeholder={DEFAULT_STATUS_CONTENT[tone].heading}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Intro text
        <textarea
          value={String(row[fieldMap.intro] || "")}
          onChange={(e) => updateField(index, fieldMap.intro, e.target.value)}
          className={`mt-1 ${textareaClassName("min-h-[84px]")}`}
          placeholder={DEFAULT_STATUS_CONTENT[tone].intro}
          rows={3}
        />
      </label>

      <label className="block text-sm font-medium text-slate-700">
        Actions (one per line)
        <textarea
          value={String(row[fieldMap.actions] || "")}
          onChange={(e) => updateField(index, fieldMap.actions, e.target.value)}
          className={`mt-1 ${textareaClassName("min-h-[140px]")}`}
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

function statusCardClassName(tone: StatusTone) {
  const toneClass: Record<StatusTone, string> = {
    green: "border-emerald-200 bg-emerald-50",
    orange: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  };

  return `rounded-2xl border ${toneClass[tone]} p-4 shadow-sm`;
}
