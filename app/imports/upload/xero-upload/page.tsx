"use client";

import Link from "next/link";
import { parseXeroProfitLossCsv } from "@/lib/parse-xero-profit-loss-csv";
import { useEffect, useMemo, useRef, useState } from "react";
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
};

async function safeReadJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned non-JSON response with status ${response.status}`);
  }
}

function formatCurrency(value: number) {
  return `$${Number(value).toLocaleString(undefined, {
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
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200";
  }

  return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
}

export default function XeroUploadPage() {
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [selectedBillingPeriodId, setSelectedBillingPeriodId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [report, setReport] = useState<ReportData | null>(null);
  const [imports, setImports] = useState<XeroImportItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadingImports, setLoadingImports] = useState(false);
  const [busyImportId, setBusyImportId] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadBillingPeriods();
    void loadImports();
  }, []);

  async function loadBillingPeriods() {
    try {
      setError("");

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

      if (nextBillingPeriods.length > 0) {
        setSelectedBillingPeriodId((prev) => prev || nextBillingPeriods[0].id);
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load billing periods");
      }
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
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load Xero imports");
      }
    } finally {
      setLoadingImports(false);
    }
  }

  async function handleUploadAndProcess() {
    let importId: string | null = null;

    try {
      setLoading(true);
      setError("");
      setMessage("");
      setReport(null);

      if (!selectedFile) {
        throw new Error("Please choose a CSV file");
      }

      if (!selectedBillingPeriodId) {
        throw new Error("Please select a billing month");
      }

      const billingPeriod = billingPeriods.find(
        (period) => period.id === selectedBillingPeriodId
      );

      if (!billingPeriod) {
        throw new Error("Invalid billing period");
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
        throw new Error("The server returned an empty response");
      }

      setReport(processData as ReportData);
      setMessage("Xero file uploaded, processed, and saved successfully.");
      setSelectedFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await loadImports();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Upload failed");
      }

      await loadImports();
    } finally {
      setLoading(false);
    }
  }

  async function handleLink(importId: string) {
    try {
      setBusyImportId(importId);
      setError("");
      setMessage("");

      if (!selectedBillingPeriodId) {
        throw new Error("Please select a billing month first.");
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

      setMessage("Import linked successfully.");
      await loadImports();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to link import");
      }
    } finally {
      setBusyImportId(null);
    }
  }

  async function handleUnlink(importId: string) {
    try {
      setBusyImportId(importId);
      setError("");
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

      setMessage("Import unlinked successfully.");
      await loadImports();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to unlink import");
      }
    } finally {
      setBusyImportId(null);
    }
  }

  async function handleDelete(importId: string) {
    const confirmed = window.confirm(
      "Delete this Xero upload record and stored file?"
    );

    if (!confirmed) return;

    try {
      setBusyImportId(importId);
      setError("");
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

      setMessage("Import deleted successfully.");
      await loadImports();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to delete import");
      }
    } finally {
      setBusyImportId(null);
    }
  }

  const selectedBillingPeriodLabel = useMemo(() => {
    return (
      billingPeriods.find((period) => period.id === selectedBillingPeriodId)?.label ||
      "No month selected"
    );
  }, [billingPeriods, selectedBillingPeriodId]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 p-6">
      <div className="mx-auto max-w-7xl">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-7 text-white">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-200">
                  Benchmark reporting
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                  Xero Expense Upload
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">
                  Upload your Xero Profit and Loss CSV, process it into benchmark data,
                  and manage a clean log of Xero imports.
                </p>
              </div>

              <Link
                href="/benchmark/expense-reports"
                className="inline-flex rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/15"
              >
                Return to Benchmark Reports
              </Link>
            </div>
          </div>

          <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Upload and process
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Select the billing month, choose a CSV file, then upload and process it.
              </p>

              {error ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {message ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {message}
                </div>
              ) : null}

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="billing-period"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    Billing month
                  </label>
                  <select
                    id="billing-period"
                    value={selectedBillingPeriodId}
                    onChange={(e) => setSelectedBillingPeriodId(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                  >
                    <option value="">Select billing month</option>
                    {billingPeriods.map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    CSV file
                  </label>

                  <input
                    ref={fileInputRef}
                    id="xero-file"
                    type="file"
                    accept=".csv"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Choose CSV file
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {selectedFile ? (
                  <>
                    <span className="font-medium text-slate-900">Selected file:</span>{" "}
                    {selectedFile.name}
                  </>
                ) : (
                  "No file selected"
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleUploadAndProcess}
                  disabled={loading}
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Uploading & Processing..." : "Upload & Process"}
                </button>

                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  Selected month: {selectedBillingPeriodLabel}
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Upload status guide
              </h2>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div className="rounded-2xl bg-white px-4 py-3">
                  <span className="font-medium text-slate-900">Uploaded:</span> file stored and log row created
                </div>
                <div className="rounded-2xl bg-white px-4 py-3">
                  <span className="font-medium text-slate-900">Processed:</span> benchmark processing completed successfully
                </div>
                <div className="rounded-2xl bg-white px-4 py-3">
                  <span className="font-medium text-slate-900">Failed:</span> upload exists but processing did not complete
                </div>
                <div className="rounded-2xl bg-white px-4 py-3">
                  <span className="font-medium text-slate-900">Linked month:</span> billing period currently attached to the upload
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Xero upload log
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                See what has been uploaded, whether it has been processed, and manage linking.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadImports()}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {loadingImports ? "Refreshing..." : "Refresh log"}
            </button>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left">
                  <th className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    File
                  </th>
                  <th className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Uploaded
                  </th>
                  <th className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Processed
                  </th>
                  <th className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Linked month
                  </th>
                  <th className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadingImports ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-sm text-slate-500">
                      Loading imports...
                    </td>
                  </tr>
                ) : imports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-sm text-slate-500">
                      No Xero uploads yet.
                    </td>
                  </tr>
                ) : (
                  imports.map((item) => (
                    <tr key={item.id} className="align-top">
                      <td className="border-b border-slate-100 px-4 py-4">
                        <div className="font-medium text-slate-900">{item.file_name}</div>
                      </td>

                      <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-600">
                        {formatDateTime(item.created_at)}
                      </td>

                      <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-600">
                        {formatDateTime(item.processed_at)}
                      </td>

                      <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-600">
                        {item.billing_period_label || "Not linked"}
                      </td>

                      <td className="border-b border-slate-100 px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getImportStatusClasses(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </span>
                      </td>

                      <td className="border-b border-slate-100 px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleLink(item.id)}
                            disabled={busyImportId === item.id}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            Link
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleUnlink(item.id)}
                            disabled={busyImportId === item.id}
                            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            Unlink
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDelete(item.id)}
                            disabled={busyImportId === item.id}
                            className="rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {report ? (
          <>
            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Summary
              </h2>

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
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                Benchmark result details
              </h2>

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Category
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Amount
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        %
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Target %
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Variance
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map((row) => {
                      const colors = getStatusColors(row.status);

                      return (
                        <tr key={row.category_name}>
                          <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-900">
                            {row.category_name}
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-600">
                            {formatCurrency(row.expense_amount)}
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-600">
                            {row.actual_percent.toFixed(2)}%
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-600">
                            {row.target_percent.toFixed(2)}%
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4 text-sm text-slate-600">
                            {row.variance_from_target.toFixed(2)}%
                          </td>
                          <td className="border-b border-slate-100 px-4 py-4">
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