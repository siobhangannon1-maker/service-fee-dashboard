"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type BillingPeriod = {
  id: string;
  label: string;
  month: number;
  year: number;
  status: string;
};

type ImportRow = {
  id: string;
  file_name: string;
  storage_path: string | null;
  status: string;
  created_at: string;
  billing_period_id: string | null;
  linked: boolean;
  month: number | null;
};

type Tone = "default" | "success" | "error";

export default function ImportsUploadPage() {
  const [billingPeriods, setBillingPeriods] = useState<BillingPeriod[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [selectedBillingPeriodId, setSelectedBillingPeriodId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<Tone>("default");
  const [uploading, setUploading] = useState(false);
  const [processingImportId, setProcessingImportId] = useState<string | null>(null);
  const [unlinkingImportId, setUnlinkingImportId] = useState<string | null>(null);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPageData();
  }, []);

  function showMessage(nextMessage: string, nextTone: Tone = "default") {
    setMessage(nextMessage);
    setTone(nextTone);
  }

  async function loadPageData() {
    setLoading(true);
    setMessage("");

    try {
      const billingPeriodsRes = await fetch("/api/billing-periods", {
        method: "GET",
        cache: "no-store",
      });

      const billingPeriodsJson = await billingPeriodsRes.json();

      if (!billingPeriodsRes.ok) {
        throw new Error(
          billingPeriodsJson?.error || "Failed to load billing periods"
        );
      }

      const importsRes = await fetch("/api/imports/list", {
        method: "GET",
        cache: "no-store",
      });

      const importsJson = await importsRes.json();

      if (!importsRes.ok) {
        throw new Error(importsJson?.error || "Failed to load imports");
      }

      const nextBillingPeriods = Array.isArray(billingPeriodsJson.billingPeriods)
        ? billingPeriodsJson.billingPeriods
        : [];

      const nextImports = Array.isArray(importsJson.imports)
        ? importsJson.imports
        : [];

      setBillingPeriods(nextBillingPeriods);
      setImports(nextImports);

      if (nextBillingPeriods.length > 0) {
        setSelectedBillingPeriodId((current) => current || nextBillingPeriods[0].id);
      } else {
        setSelectedBillingPeriodId("");
      }
    } catch (error: any) {
      console.error("Imports page load error", error);
      showMessage(error?.message || "Failed to load page data", "error");
      setBillingPeriods([]);
      setImports([]);
      setSelectedBillingPeriodId("");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!selectedFile) {
      showMessage("Please choose a CSV file.", "error");
      return;
    }

    if (!selectedBillingPeriodId) {
      showMessage("Please select a billing month.", "error");
      return;
    }

    setUploading(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("billing_period_id", selectedBillingPeriodId);

      const res = await fetch("/api/imports/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Upload failed");
      }

      showMessage(data?.message || "CSV uploaded successfully.", "success");
      setSelectedFile(null);
      await loadPageData();
    } catch (error: any) {
      showMessage(error?.message || "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleProcessImport(importId: string) {
    setProcessingImportId(importId);
    setMessage("");

    try {
      const res = await fetch(`/api/imports/${importId}/process`, {
        method: "POST",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Processing failed");
      }

      showMessage(
        data?.message || "Import processed and linked to billing month.",
        "success"
      );
      await loadPageData();
    } catch (error: any) {
      showMessage(error?.message || "Processing failed", "error");
    } finally {
      setProcessingImportId(null);
    }
  }

  async function handleUnlinkImport(importId: string) {
    setUnlinkingImportId(importId);
    setMessage("");

    try {
      const res = await fetch(`/api/imports/${importId}`, {
        method: "PATCH",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to unlink import");
      }

      showMessage(data?.message || "Import unlinked.", "success");
      await loadPageData();
    } catch (error: any) {
      showMessage(error?.message || "Failed to unlink import", "error");
    } finally {
      setUnlinkingImportId(null);
    }
  }

  async function handleDeleteImport(importId: string) {
    const confirmed = window.confirm(
      "Delete this import? This will also remove its processed rows and summaries."
    );

    if (!confirmed) return;

    setDeletingImportId(importId);
    setMessage("");

    try {
      const res = await fetch(`/api/imports/${importId}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Failed to delete import");
      }

      showMessage(data?.message || "Import deleted.", "success");
      await loadPageData();
    } catch (error: any) {
      showMessage(error?.message || "Failed to delete import", "error");
    } finally {
      setDeletingImportId(null);
    }
  }

  function formatDate(value: string) {
    if (!value) return "-";
    return new Date(value).toLocaleString("en-AU");
  }

  function billingPeriodLabel(id: string | null) {
    if (!id) return "Not selected";
    return billingPeriods.find((p) => p.id === id)?.label || "Unknown";
  }

  function Badge({
    children,
    variant = "default",
  }: {
    children: React.ReactNode;
    variant?: "default" | "success" | "warning";
  }) {
    const className =
      variant === "success"
        ? "bg-emerald-100 text-emerald-700 border-emerald-200"
        : variant === "warning"
        ? "bg-amber-100 text-amber-700 border-amber-200"
        : "bg-slate-100 text-slate-700 border-slate-200";

    return (
      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${className}`}>
        {children}
      </span>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Production Report Imports</h1>
            <p className="mt-1 text-sm text-slate-600">
              Upload a CSV, choose the billing month, then process the import.
            </p>
          </div>

          <Link
            href="/billing"
            className="inline-flex rounded-2xl border bg-white px-4 py-2 text-sm"
          >
            Go to Billing Page
          </Link>
        </div>

        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Upload CSV</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm">Billing month</label>
              <select
                className="w-full rounded-2xl border bg-white px-3 py-2"
                value={selectedBillingPeriodId}
                onChange={(e) => setSelectedBillingPeriodId(e.target.value)}
                disabled={loading}
              >
                <option value="">
                  {loading ? "Loading billing months..." : "Select billing month"}
                </option>
                {billingPeriods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </select>

              <div className="mt-2 text-xs text-slate-500">
                Loaded billing months: {billingPeriods.length}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm">CSV file</label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-2xl border bg-white px-3 py-2"
              />
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={handleUpload}
              disabled={uploading || loading}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload CSV"}
            </button>
          </div>
        </div>

        {message && (
          <div
            className={`rounded-2xl border p-4 text-sm ${
              tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : tone === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {message}
          </div>
        )}

        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Imports</h2>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left">File</th>
                  <th className="px-3 py-2 text-left">Billing Month</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Linked</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr key={item.id} className="border-b align-top">
                    <td className="px-3 py-2">{item.file_name}</td>
                    <td className="px-3 py-2">
                      {billingPeriodLabel(item.billing_period_id)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={item.status === "processed" ? "success" : "default"}>
                        {item.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {item.linked ? (
                        <Badge variant="success">Linked</Badge>
                      ) : (
                        <Badge variant="warning">Unlinked</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{formatDate(item.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleProcessImport(item.id)}
                          disabled={processingImportId === item.id}
                          className="rounded-xl border px-3 py-1 disabled:opacity-50"
                        >
                          {processingImportId === item.id
                            ? "Processing..."
                            : "Read CSV and Save Rows"}
                        </button>

                        <button
                          onClick={() => handleUnlinkImport(item.id)}
                          disabled={unlinkingImportId === item.id || !item.linked}
                          className="rounded-xl border px-3 py-1 disabled:opacity-50"
                        >
                          {unlinkingImportId === item.id ? "Unlinking..." : "Unlink"}
                        </button>

                        <button
                          onClick={() => handleDeleteImport(item.id)}
                          disabled={deletingImportId === item.id}
                          className="rounded-xl border border-red-200 px-3 py-1 text-red-700 disabled:opacity-50"
                        >
                          {deletingImportId === item.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {imports.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-slate-500">
                      No imports yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}