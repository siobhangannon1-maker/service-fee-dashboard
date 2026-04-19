"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Toast from "@/components/ui/Toast";

type Provider = {
  id: string;
  name: string;
};

type BillingPeriod = {
  id: string;
  label: string;
  status: string;
  month: number;
  year: number;
};

type AfterpayImport = {
  id: string;
  file_name: string;
  storage_path: string;
  provider_id: string | null;
  provider_name: string | null;
  billing_period_id: string | null;
  billing_period_label: string | null;
  status: string;
  row_count: number | null;
  total_fee_excl_tax: number;
  imported_entry_id: string | null;
  created_at: string;
  processed_at: string | null;
  download_url?: string | null;
};

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function getCurrentBillingPeriodId(periods: BillingPeriod[]) {
  if (!periods.length) return "";

  const today = new Date();
  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const match = periods.find((p) => p.month === month && p.year === year);

  return match?.id || periods[0]?.id || "";
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

function formatMoney(value: number) {
  return value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getStatusBadgeClasses(status: string) {
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

async function safeReadJson(response: Response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Server returned a non-JSON response (${response.status}). Check the API route for a crash, missing route, or server-side error.`
    );
  }
}

export default function UploadAfterpayPage() {
  const supabase = createClient();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [imports, setImports] = useState<AfterpayImport[]>([]);

  const [providerId, setProviderId] = useState("");
  const [billingPeriodId, setBillingPeriodId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");

  const [file, setFile] = useState<File | null>(null);

  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"default" | "success" | "error">("default");
  const [loading, setLoading] = useState(false);
  const [loadingImports, setLoadingImports] = useState(false);
  const [busyImportId, setBusyImportId] = useState<string | null>(null);

  useEffect(() => {
    void loadData();
    void loadImports();
  }, []);

  async function loadData() {
    const { data: providerData, error: providerError } = await supabase
      .from("providers")
      .select("id, name")
      .order("name");

    if (providerError) {
      setTone("error");
      setMessage(`Error loading providers: ${providerError.message}`);
      return;
    }

    const { data: periodData, error: periodError } = await supabase
      .from("billing_periods")
      .select("id, label, status, month, year")
      .order("year", { ascending: false })
      .order("month", { ascending: true });

    if (periodError) {
      setTone("error");
      setMessage(`Error loading billing periods: ${periodError.message}`);
      return;
    }

    const nextProviders = (providerData || []) as Provider[];
    const nextPeriods = (periodData || []) as BillingPeriod[];

    setProviders(nextProviders);
    setBillingPeriods(nextPeriods);

    setProviderId((prev) => prev || nextProviders[0]?.id || "");

    const defaultPeriodId = getCurrentBillingPeriodId(nextPeriods);
    const defaultPeriod =
      nextPeriods.find((period) => period.id === defaultPeriodId) || null;

    setBillingPeriodId((prev) => prev || defaultPeriodId);

    setSelectedYear((prev) => {
      if (prev) return prev;

      if (defaultPeriod) return String(defaultPeriod.year);

      const latestYear = nextPeriods[0]?.year;
      return latestYear ? String(latestYear) : "";
    });

    setSelectedMonth((prev) => {
      if (prev) return prev;

      if (defaultPeriod) return String(defaultPeriod.month);

      const currentMonth = new Date().getMonth() + 1;
      return String(currentMonth);
    });
  }

  async function loadImports() {
    try {
      setLoadingImports(true);

      const res = await fetch("/api/afterpay-imports", {
        method: "GET",
        cache: "no-store",
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to load imports");
      }

      setImports(data?.imports || []);
    } catch (error) {
      setTone("error");
      setMessage(
        error instanceof Error ? error.message : "Failed to load imports"
      );
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

    const yearNumber = Number(selectedYear);

    return billingPeriods
      .filter((period) => period.year === yearNumber)
      .map((period) => period.month)
      .filter((month, index, array) => array.indexOf(month) === index)
      .sort((a, b) => a - b);
  }, [billingPeriods, selectedYear]);

  useEffect(() => {
    if (!availableYears.length) return;

    if (!selectedYear || !availableYears.includes(Number(selectedYear))) {
      setSelectedYear(String(availableYears[0]));
    }
  }, [availableYears, selectedYear]);

  useEffect(() => {
    if (!selectedYear) return;

    const yearNumber = Number(selectedYear);
    const currentMonth = new Date().getMonth() + 1;

    const hasCurrentMonthInYear = availableMonthsForSelectedYear.includes(currentMonth);

    if (
      !selectedMonth ||
      !availableMonthsForSelectedYear.includes(Number(selectedMonth))
    ) {
      if (hasCurrentMonthInYear) {
        setSelectedMonth(String(currentMonth));
      } else if (availableMonthsForSelectedYear.length) {
        setSelectedMonth(String(availableMonthsForSelectedYear[0]));
      } else {
        setSelectedMonth("");
      }
      return;
    }

    const matchingPeriod = billingPeriods.find(
      (period) =>
        period.year === yearNumber && period.month === Number(selectedMonth)
    );

    setBillingPeriodId(matchingPeriod?.id || "");
  }, [
    selectedYear,
    selectedMonth,
    availableMonthsForSelectedYear,
    billingPeriods,
  ]);

  const selectedBillingPeriod = useMemo(() => {
    return billingPeriods.find((period) => period.id === billingPeriodId) || null;
  }, [billingPeriods, billingPeriodId]);

  const selectedBillingPeriodLocked = selectedBillingPeriod?.status === "locked";

  const duplicateImport = useMemo(() => {
    return imports.find(
      (item) =>
        item.provider_id === providerId &&
        item.billing_period_id === billingPeriodId
    );
  }, [imports, providerId, billingPeriodId]);

  function getImportBillingPeriod(importItem: AfterpayImport) {
    if (!importItem.billing_period_id) return null;
    return (
      billingPeriods.find((period) => period.id === importItem.billing_period_id) || null
    );
  }

  function isImportLocked(importItem: AfterpayImport) {
    const period = getImportBillingPeriod(importItem);
    return period?.status === "locked";
  }

  async function handleUpload() {
    try {
      setLoading(true);
      setMessage("");

      if (!file) {
        throw new Error("Please choose a CSV file.");
      }

      if (!providerId || !billingPeriodId) {
        throw new Error("Please choose a provider and billing month.");
      }

      if (selectedBillingPeriodLocked) {
        throw new Error("The selected billing month is locked.");
      }

      if (duplicateImport) {
        throw new Error(
          `An Afterpay CSV has already been uploaded for this provider and billing month (${duplicateImport.file_name}). Unlink or delete it first.`
        );
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("provider_id", providerId);
      formData.append("billing_period_id", billingPeriodId);

      const res = await fetch("/api/afterpay-imports/upload", {
        method: "POST",
        body: formData,
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(data?.error || "Upload failed");
      }

      setTone("success");
      setMessage(data?.message || "Afterpay CSV uploaded successfully.");
      setFile(null);

      await loadImports();
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLink(importId: string) {
    try {
      setBusyImportId(importId);
      setMessage("");

      if (!billingPeriodId) {
        throw new Error("Please choose a billing month first.");
      }

      if (selectedBillingPeriodLocked) {
        throw new Error("The selected billing month is locked.");
      }

      const selectedImport = imports.find((item) => item.id === importId);

      const conflictingImport = imports.find(
        (item) =>
          item.id !== importId &&
          item.provider_id === selectedImport?.provider_id &&
          item.billing_period_id === billingPeriodId
      );

      if (conflictingImport) {
        throw new Error(
          `Another Afterpay CSV is already linked to this provider and billing month (${conflictingImport.file_name}).`
        );
      }

      const res = await fetch("/api/afterpay-imports/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          importId,
          billingPeriodId,
        }),
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(data?.error || "Link failed");
      }

      setTone("success");
      setMessage("Import linked successfully.");
      await loadImports();
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Link failed");
    } finally {
      setBusyImportId(null);
    }
  }

  async function handleUnlink(importId: string) {
    try {
      setBusyImportId(importId);
      setMessage("");

      const importItem = imports.find((item) => item.id === importId);

      if (importItem && isImportLocked(importItem)) {
        throw new Error("This import is linked to a locked billing month.");
      }

      const res = await fetch("/api/afterpay-imports/unlink", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          importId,
        }),
      });

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(data?.error || "Unlink failed");
      }

      setTone("success");
      setMessage("Import unlinked successfully.");
      await loadImports();
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Unlink failed");
    } finally {
      setBusyImportId(null);
    }
  }

  async function handleDelete(importId: string) {
    const importItem = imports.find((item) => item.id === importId);

    if (importItem && isImportLocked(importItem)) {
      setTone("error");
      setMessage("This import is linked to a locked billing month and cannot be deleted.");
      return;
    }

    const confirmed = window.confirm(
      "Delete this uploaded CSV, its log row, and the linked Afterpay billing entry?"
    );

    if (!confirmed) return;

    try {
      setBusyImportId(importId);
      setMessage("");

      const res = await fetch(
        `/api/afterpay-imports/delete?id=${encodeURIComponent(importId)}`,
        {
          method: "DELETE",
        }
      );

      const data = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(data?.error || "Delete failed");
      }

      setTone("success");
      setMessage("Import deleted successfully.");
      await loadImports();
    } catch (error) {
      setTone("error");
      setMessage(error instanceof Error ? error.message : "Delete failed");
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
              Upload Afterpay Reconciliation Spreadsheet
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Upload a CSV, import the Merchant Fee excl Tax total, and manage
              uploaded files.
            </p>
          </div>

          <Link
            href="/billing-details"
            className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Back to Billing Detail Entries
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
                Provider
              </label>
              <select
                className="w-full rounded-2xl border border-slate-200 px-3 py-2"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
              >
                <option value="">Select provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Year
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
                Month
              </label>
              <select
                className="w-full rounded-2xl border border-slate-200 px-3 py-2"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                <option value="">Select month</option>
                {availableMonthsForSelectedYear.map((month) => {
                  const monthOption = MONTH_OPTIONS.find(
                    (option) => option.value === month
                  );

                  return (
                    <option key={month} value={String(month)}>
                      {monthOption?.label || `Month ${month}`}
                    </option>
                  );
                })}
              </select>

              {selectedBillingPeriod ? (
                <div className="mt-2 text-sm text-slate-600">
                  Status:{" "}
                  <span
                    className={
                      selectedBillingPeriodLocked
                        ? "font-semibold text-amber-700"
                        : "font-semibold text-emerald-700"
                    }
                  >
                    {selectedBillingPeriod.status}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {selectedBillingPeriodLocked ? (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              The selected billing month is locked. Uploading and linking are disabled.
            </div>
          ) : null}

          {duplicateImport ? (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              A CSV is already linked to this provider and billing month:
              <span className="ml-1 font-semibold">{duplicateImport.file_name}</span>.
              Delete or unlink it before uploading another one.
            </div>
          ) : null}

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              CSV file
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          {file ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <span className="font-medium">Selected file:</span> {file.name}
            </div>
          ) : null}

          <div className="mt-6">
            <button
              type="button"
              onClick={handleUpload}
              disabled={loading || !!duplicateImport || selectedBillingPeriodLocked}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
            >
              {loading ? "Uploading..." : "Upload and Import"}
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
              No Afterpay CSV files uploaded yet.
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-slate-500">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">File</th>
                    <th className="pb-3 pr-4 font-medium">Provider</th>
                    <th className="pb-3 pr-4 font-medium">Linked month</th>
                    <th className="pb-3 pr-4 font-medium">Uploaded</th>
                    <th className="pb-3 pr-4 font-medium">Processed</th>
                    <th className="pb-3 pr-4 font-medium">Rows</th>
                    <th className="pb-3 pr-4 font-medium">Total</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((item) => {
                    const linkedPeriod = getImportBillingPeriod(item);
                    const itemLocked = isImportLocked(item);

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
                          {item.provider_name || "—"}
                        </td>

                        <td className="py-4 pr-4 text-slate-700">
                          <div>{item.billing_period_label || "Not linked"}</div>
                          {linkedPeriod ? (
                            <div className="mt-1 text-xs text-slate-500">
                              Status:{" "}
                              <span
                                className={
                                  itemLocked
                                    ? "font-medium text-amber-700"
                                    : "font-medium text-emerald-700"
                                }
                              >
                                {linkedPeriod.status}
                              </span>
                            </div>
                          ) : null}
                        </td>

                        <td className="py-4 pr-4 text-slate-700">
                          {formatDateTime(item.created_at)}
                        </td>

                        <td className="py-4 pr-4 text-slate-700">
                          {formatDateTime(item.processed_at)}
                        </td>

                        <td className="py-4 pr-4 text-slate-700">
                          {item.row_count ?? "—"}
                        </td>

                        <td className="py-4 pr-4 text-slate-700 font-medium">
                          ${formatMoney(item.total_fee_excl_tax || 0)}
                        </td>

                        <td className="py-4 pr-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${getStatusBadgeClasses(
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
                              disabled={
                                busyImportId === item.id || selectedBillingPeriodLocked
                              }
                              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              title={
                                selectedBillingPeriodLocked
                                  ? "Cannot link to a locked billing month"
                                  : ""
                              }
                            >
                              Link
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleUnlink(item.id)}
                              disabled={busyImportId === item.id || itemLocked}
                              className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              title={
                                itemLocked
                                  ? "Cannot unlink an import linked to a locked billing month"
                                  : ""
                              }
                            >
                              Unlink
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDelete(item.id)}
                              disabled={busyImportId === item.id || itemLocked}
                              className="rounded-xl border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              title={
                                itemLocked
                                  ? "Cannot delete an import linked to a locked billing month"
                                  : ""
                              }
                            >
                              Delete
                            </button>
                          </div>

                          {itemLocked ? (
                            <div className="mt-2 text-xs text-amber-700">
                              Actions are disabled because this import is linked to a locked billing month.
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}