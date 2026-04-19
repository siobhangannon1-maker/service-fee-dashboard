"use client";

import Link from "next/link";
import { parseXeroProfitLossCsv } from "@/lib/parse-xero-profit-loss-csv";
import { useEffect, useMemo, useRef, useState } from "react";
import Toast from "@/components/ui/Toast";
import {
  getStatusColors,
  getStatusLabel,
  type BenchmarkStatus,
} from "@/lib/benchmark-status";

type BillingPeriod = {
  id: string;
  label: string;
  month: number;
  year: number;
  status?: string;
};

type ResultRow = {
  category_name: string;
  expense_amount: number;
  actual_percent: number;
  target_percent: number;
  variance_from_target: number;
  status: BenchmarkStatus;
};

type ReportData = {
  month_key: string;
  gross_production: number;
  total_expenses: number;
  total_expense_percent: number;
  results: ResultRow[];
};

type XeroImportItem = {
  id: string;
  file_name: string;
  storage_path: string | null;
  status: "uploaded" | "processed" | "failed" | string;
  created_at: string;
  processed_at: string | null;
  billing_period_id: string | null;
  billing_period_label: string | null;
  month: number | null;
  year: number | null;
  linked: boolean;
  is_processed: boolean;
  download_url?: string | null;
};

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function getDefaultYear(periods: BillingPeriod[]) {
  if (!periods.length) return "";

  const years = Array.from(new Set(periods.map((p) => p.year))).sort((a, b) => b - a);

  return String(years[0] ?? "");
}

function getDefaultMonth(periods: BillingPeriod[], year: number) {
  const monthsForYear = periods
    .filter((p) => p.year === year)
    .map((p) => p.month)
    .sort((a, b) => a - b);

  if (!monthsForYear.length) return "";

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  if (year === currentYear && monthsForYear.includes(currentMonth)) {
    return String(currentMonth);
  }

  return String(monthsForYear[0] ?? "");
}

async function safeReadJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned a non-JSON response (${response.status}). Check the API route for a crash, missing route, or server-side error.`
    );
  }
}

function formatCurrency(value: number) {
  return `$${Number(value).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getImportStatusClasses(status: string) {
  if (status === "processed") {
    return "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "uploaded") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }

  if (status === "failed") {
    return "border border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border border-slate-200 bg-slate-100 text-slate-700";
}

export default function XeroUploadPage() {
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [selectedBillingPeriodId, setSelectedBillingPeriodId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [report, setReport] = useState<ReportData | null>(null);
  const [imports, setImports] = useState<XeroImportItem[]>([]);

  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [loading, setLoading] = useState(false);
  const [loadingImports, setLoadingImports] = useState(false);
  const [busyImportId, setBusyImportId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadBillingPeriods();
    void loadImports();
  }, []);

  async function loadBillingPeriods() {
    try {
      const res = await fetch("/api/billing-periods", {
        method: "GET",
        cache: "no-store",
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ||
            `Failed to load billing periods (${res.status})`
        );
      }

      const nextBillingPeriods = Array.isArray(
        (data as { billingPeriods?: BillingPeriod[] } | null)?.billingPeriods
      )
        ? ((data as { billingPeriods?: BillingPeriod[] }).billingPeriods ?? [])
        : [];

      setBillingPeriods(nextBillingPeriods);

      const defaultYear = getDefaultYear(nextBillingPeriods);
      setSelectedYear(defaultYear);

      const numericDefaultYear = Number(defaultYear);
      const defaultMonth = Number.isNaN(numericDefaultYear)
        ? ""
        : getDefaultMonth(nextBillingPeriods, numericDefaultYear);

      setSelectedMonth(defaultMonth);

      if (!Number.isNaN(numericDefaultYear) && defaultMonth) {
        const defaultPeriod =
          nextBillingPeriods.find(
            (period) =>
              period.year === numericDefaultYear &&
              period.month === Number(defaultMonth)
          ) || null;

        setSelectedBillingPeriodId(defaultPeriod?.id || "");
      } else {
        setSelectedBillingPeriodId("");
      }
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to load billing periods");
    }
  }

  async function loadImports() {
    try {
      setLoadingImports(true);

      const res = await fetch("/api/xero-imports", {
        method: "GET",
        cache: "no-store",
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ||
            `Failed to load Xero imports (${res.status})`
        );
      }

      const nextImports = Array.isArray((data as { imports?: XeroImportItem[] } | null)?.imports)
        ? ((data as { imports?: XeroImportItem[] }).imports ?? [])
        : [];

      setImports(nextImports);
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to load Xero imports");
    } finally {
      setLoadingImports(false);
    }
  }

  const availableYears = useMemo(() => {
    return Array.from(new Set(billingPeriods.map((period) => period.year))).sort(
      (a, b) => b - a
    );
  }, [billingPeriods]);

  const availableMonthsForSelectedYear = useMemo(() => {
    if (!selectedYear) return [];

    const year = Number(selectedYear);

    return billingPeriods
      .filter((period) => period.year === year)
      .sort((a, b) => a.month - b.month);
  }, [billingPeriods, selectedYear]);

  useEffect(() => {
    if (!selectedYear) {
      setSelectedMonth("");
      setSelectedBillingPeriodId("");
      return;
    }

    const year = Number(selectedYear);

    if (Number.isNaN(year)) {
      setSelectedMonth("");
      setSelectedBillingPeriodId("");
      return;
    }

    const validMonths = billingPeriods
      .filter((period) => period.year === year)
      .map((period) => period.month)
      .sort((a, b) => a - b);

    if (!validMonths.length) {
      setSelectedMonth("");
      setSelectedBillingPeriodId("");
      return;
    }

    const currentSelectedMonth = Number(selectedMonth);

    if (!selectedMonth || !validMonths.includes(currentSelectedMonth)) {
      const nextMonth = getDefaultMonth(billingPeriods, year);
      setSelectedMonth(nextMonth);

      const matchedPeriod =
        billingPeriods.find(
          (period) => period.year === year && period.month === Number(nextMonth)
        ) || null;

      setSelectedBillingPeriodId(matchedPeriod?.id || "");
      return;
    }

    const matchedPeriod =
      billingPeriods.find(
        (period) => period.year === year && period.month === currentSelectedMonth
      ) || null;

    setSelectedBillingPeriodId(matchedPeriod?.id || "");
  }, [billingPeriods, selectedYear, selectedMonth]);

  const selectedBillingPeriod = useMemo(() => {
    return billingPeriods.find((period) => period.id === selectedBillingPeriodId) || null;
  }, [billingPeriods, selectedBillingPeriodId]);

  const duplicateImport = useMemo(() => {
    return imports.find((item) => item.billing_period_id === selectedBillingPeriodId);
  }, [imports, selectedBillingPeriodId]);

  async function handleUploadAndProcess() {
    let importId: string | null = null;

    try {
      setLoading(true);
      setMessage("");
      setReport(null);

      if (!selectedFile) {
        throw new Error("Please choose a CSV file.");
      }

      if (!selectedBillingPeriodId) {
        throw new Error("Please choose a billing month.");
      }

      const billingPeriod = billingPeriods.find(
        (period) => period.id === selectedBillingPeriodId
      );

      if (!billingPeriod) {
        throw new Error("Invalid billing period.");
      }

      if (duplicateImport) {
        throw new Error(
          `A Xero CSV is already linked to this billing month (${duplicateImport.file_name}). Unlink or delete it first.`
        );
      }

      const uploadForm = new FormData();
      uploadForm.append("file", selectedFile);
      uploadForm.append("billing_period_id", selectedBillingPeriodId);

      const uploadRes = await fetch("/api/xero-imports/upload", {
        method: "POST",
        body: uploadForm,
      });

      const uploadData = await safeReadJson(uploadRes);

      if (!uploadRes.ok) {
        throw new Error(
          (uploadData as { error?: string } | null)?.error ||
            `Failed to upload file (${uploadRes.status})`
        );
      }

      importId = (uploadData as { importId?: string } | null)?.importId || null;

      if (!importId) {
        throw new Error("Upload succeeded but no import ID was returned.");
      }

      const fileText = await selectedFile.text();
      const cleanedRows = parseXeroProfitLossCsv(fileText);

      const processRes = await fetch("/api/xero-benchmark-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: billingPeriod.year,
          month: billingPeriod.month,
          rows: cleanedRows,
          importId,
        }),
      });

      const processData = await safeReadJson(processRes);

      if (!processRes.ok) {
        throw new Error(
          (processData as { error?: string } | null)?.error ||
            `Failed to process Xero file (${processRes.status})`
        );
      }

      if (!processData) {
        throw new Error("The server returned an empty response.");
      }

      setReport(processData as ReportData);
      setTone("success");
      setMessage("Xero CSV uploaded, processed, and saved successfully.");
      setSelectedFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadImports();
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Upload failed");
      await loadImports();
    } finally {
      setLoading(false);
    }
  }

  async function handleLink(importId: string) {
    try {
      setBusyImportId(importId);
      setMessage("");

      if (!selectedBillingPeriodId) {
        throw new Error("Please choose a billing month first.");
      }

      const conflictingImport = imports.find(
        (item) => item.id !== importId && item.billing_period_id === selectedBillingPeriodId
      );

      if (conflictingImport) {
        throw new Error(
          `Another Xero CSV is already linked to this billing month (${conflictingImport.file_name}).`
        );
      }

      const res = await fetch("/api/xero-imports/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: importId,
          billingPeriodId: selectedBillingPeriodId,
        }),
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ||
            `Failed to link import (${res.status})`
        );
      }

      setTone("success");
      setMessage("Import linked successfully.");
      await loadImports();
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to link import");
    } finally {
      setBusyImportId(null);
    }
  }

  async function handleUnlink(importId: string) {
    try {
      setBusyImportId(importId);
      setMessage("");

      const res = await fetch("/api/xero-imports/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: importId,
        }),
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ||
            `Failed to unlink import (${res.status})`
        );
      }

      setTone("success");
      setMessage("Import unlinked successfully.");
      await loadImports();
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to unlink import");
    } finally {
      setBusyImportId(null);
    }
  }

  async function handleDelete(importId: string) {
    const confirmed = window.confirm(
      "Delete this uploaded CSV, its log row, and the stored Xero file?"
    );

    if (!confirmed) return;

    try {
      setBusyImportId(importId);
      setMessage("");

      const res = await fetch(
        `/api/xero-imports/delete?id=${encodeURIComponent(importId)}`,
        {
          method: "DELETE",
        }
      );

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ||
            `Failed to delete import (${res.status})`
        );
      }

      setTone("success");
      setMessage("Import deleted successfully.");
      await loadImports();
    } catch (err) {
      setTone("error");
      setMessage(err instanceof Error ? err.message : "Failed to delete import");
    } finally {
      setBusyImportId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">
              Upload Xero Profit and Loss CSV
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Upload a CSV, process it into benchmark data, and manage uploaded files.
            </p>
          </div>

          <Link
            href="/benchmark/expense-reports"
            className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Back to Benchmark Reports
          </Link>
        </div>

        {message ? (
          <div className="mt-4">
            <Toast message={message} tone={tone} />
          </div>
        ) : null}

        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Upload CSV</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Billing year
              </label>
              <select
                className="w-full rounded-2xl border border-slate-200 px-3 py-2"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                <option value="">Select year</option>
                {availableYears.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Billing month
              </label>
              <select
                className="w-full rounded-2xl border border-slate-200 px-3 py-2"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                disabled={!selectedYear}
              >
                <option value="">Select month</option>
                {availableMonthsForSelectedYear.map((period) => (
                  <option key={period.id} value={String(period.month)}>
                    {MONTH_LABELS[period.month - 1]}
                  </option>
                ))}
              </select>

              {selectedBillingPeriod ? (
                <div className="mt-2 text-sm text-slate-600">
                  Selected:{" "}
                  <span className="font-semibold text-slate-900">
                    {selectedBillingPeriod.label}
                  </span>
                </div>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                CSV file
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          {duplicateImport ? (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              A CSV is already linked to this billing month:
              <span className="ml-1 font-semibold">{duplicateImport.file_name}</span>.
              Delete or unlink it before uploading another one.
            </div>
          ) : null}

          {selectedFile ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <span className="font-medium">Selected file:</span> {selectedFile.name}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              No CSV file selected yet.
            </div>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={handleUploadAndProcess}
              disabled={loading || !!duplicateImport}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
            >
              {loading ? "Uploading and Processing..." : "Upload and Process"}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Uploaded CSV files
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                See what has been uploaded, what month it is linked to, and manage files.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadImports()}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {loadingImports ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {imports.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              No Xero CSV files uploaded yet.
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">File</th>
                    <th className="pb-3 pr-4 font-medium">Linked month</th>
                    <th className="pb-3 pr-4 font-medium">Uploaded</th>
                    <th className="pb-3 pr-4 font-medium">Processed</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((item) => {
                    const linkDisabled =
                      busyImportId === item.id ||
                      (!!selectedBillingPeriodId &&
                        item.billing_period_id !== selectedBillingPeriodId &&
                        !!duplicateImport);

                    return (
                      <tr
                        key={item.id}
                        className="border-b border-slate-100 align-top hover:bg-slate-50/60"
                      >
                        <td className="py-4 pr-4">
                          <div className="font-medium text-slate-900">
                            {item.file_name}
                          </div>

                          {item.download_url ? (
                            <a
                              href={item.download_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1 inline-flex text-xs font-medium text-sky-700 hover:text-sky-800"
                            >
                              Download file
                            </a>
                          ) : (
                            <div className="mt-1 text-xs text-slate-400">
                              Download unavailable
                            </div>
                          )}
                        </td>

                        <td className="py-4 pr-4 text-slate-700">
                          {item.billing_period_label || "Not linked"}
                        </td>

                        <td className="py-4 pr-4 text-slate-700">
                          {formatDateTime(item.created_at)}
                        </td>

                        <td className="py-4 pr-4 text-slate-700">
                          {formatDateTime(item.processed_at)}
                        </td>

                        <td className="py-4 pr-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${getImportStatusClasses(
                              item.status
                            )}`}
                          >
                            {item.status}
                          </span>
                        </td>

                        <td className="py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleLink(item.id)}
                              disabled={linkDisabled}
                              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              title={
                                linkDisabled && duplicateImport && item.billing_period_id !== selectedBillingPeriodId
                                  ? "Another import is already linked to the selected billing month"
                                  : ""
                              }
                            >
                              Link
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleUnlink(item.id)}
                              disabled={busyImportId === item.id}
                              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Unlink
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDelete(item.id)}
                              disabled={busyImportId === item.id}
                              className="rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {report ? (
          <>
            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Summary</h2>

              <div className="mt-5 grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Month</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {report.month_key}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Gross Production</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatCurrency(report.gross_production)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Total Expenses</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {formatCurrency(report.total_expenses)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">Expense %</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {report.total_expense_percent.toFixed(2)}%
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">
                Benchmark result details
              </h2>

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-slate-200 text-left text-slate-500">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Category</th>
                      <th className="pb-3 pr-4 font-medium">Amount</th>
                      <th className="pb-3 pr-4 font-medium">%</th>
                      <th className="pb-3 pr-4 font-medium">Target %</th>
                      <th className="pb-3 pr-4 font-medium">Variance</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map((row) => {
                      const colors = getStatusColors(row.status);

                      return (
                        <tr
                          key={row.category_name}
                          className="border-b border-slate-100 align-top hover:bg-slate-50/60"
                        >
                          <td className="py-4 pr-4 text-slate-900">
                            {row.category_name}
                          </td>
                          <td className="py-4 pr-4 text-slate-700">
                            {formatCurrency(row.expense_amount)}
                          </td>
                          <td className="py-4 pr-4 text-slate-700">
                            {row.actual_percent.toFixed(2)}%
                          </td>
                          <td className="py-4 pr-4 text-slate-700">
                            {row.target_percent.toFixed(2)}%
                          </td>
                          <td className="py-4 pr-4 text-slate-700">
                            {row.variance_from_target.toFixed(2)}%
                          </td>
                          <td className="py-4">
                            <span
                              className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                              style={{
                                background: colors.background,
                                color: colors.text,
                                border: `1px solid ${colors.border}`,
                              }}
                            >
                              {getStatusLabel(row.status)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}