"use client";

import { useMemo, useState } from "react";
import PraktikaSessionPanel from "@/components/PraktikaSessionPanel";

type BulkItem = {
  id: string;
  file_name: string | null;
  created_at: string | null;

  extracted_patient_first_name: string | null;
  extracted_patient_last_name: string | null;
  extracted_patient_dob: string | null;

  praktika_patient_id: string | null;
  praktika_patient_number: string | null;
  praktika_match_status: string | null;
  praktika_match_confidence: number | null;
  praktika_match_reason: string | null;
  praktika_match_candidates: any[] | null;

  praktika_filing_status: string | null;
  praktika_filing_error: string | null;
  praktika_filed_at: string | null;

  attachment_extraction_status?: string | null;
  attachment_needs_ocr?: boolean | null;

  bulk_uploaded_by: string | null;
  bulk_uploaded_by_email: string | null;
  bulk_uploaded_by_name: string | null;
};

async function readJsonResponse(res: Response) {
  const text = await res.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `API returned non-JSON response. Status ${res.status}. Preview: ${text.slice(
        0,
        180,
      )}`,
    );
  }
}

function confidencePercent(value: number | null | undefined) {
  if (value == null) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function getPatientName(item: BulkItem) {
  return [item.extracted_patient_first_name, item.extracted_patient_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function getInitials(nameOrEmail?: string | null) {
  const value = String(nameOrEmail || "").trim();

  if (!value) return "?";

  const namePart = value.includes("@") ? value.split("@")[0] : value;

  const parts = namePart
    .replace(/[._-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${
    parts[parts.length - 1][0] || ""
  }`.toUpperCase();
}

function getMatchBadgeClass(status?: string | null) {
  if (status === "matched_existing" || status === "confirmed_manual") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "possible_match") {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }

  if (status === "failed" || status === "no_match") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function getFilingBadgeClass(status?: string | null) {
  if (status === "completed") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (status === "failed") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  if (status === "running") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  return "bg-slate-50 text-slate-700 ring-slate-200";
}

export default function BulkPraktikaDocumentFilingPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [items, setItems] = useState<BulkItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const readyItems = useMemo(() => {
    return items.filter(
      (item) =>
        item.praktika_patient_id &&
        item.praktika_filing_status !== "completed",
    );
  }, [items]);

  const needsReviewCount = useMemo(() => {
    return items.filter(
      (item) =>
        !item.praktika_patient_id ||
        item.praktika_match_status === "possible_match" ||
        item.praktika_match_status === "failed" ||
        item.praktika_match_status === "no_match",
    ).length;
  }, [items]);

  function onChooseFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    setFiles(selected);
    setMessage("");
  }

  async function refreshBatch(nextBatchId = batchId) {
    if (!nextBatchId) return;

    const res = await fetch(
      `/api/ai/bulk-document-filing/list?batchId=${encodeURIComponent(
        nextBatchId,
      )}`,
      { cache: "no-store" },
    );

    const json = await readJsonResponse(res);

    if (!json.ok) {
      setMessage(json.error || "Failed to load batch.");
      return;
    }

    setItems(json.items || []);
  }

  async function processBatch(nextBatchId = batchId) {
    if (!nextBatchId) {
      setMessage("Upload files first.");
      return;
    }

    setBusy(true);
    setMessage("Extracting text and matching patients...");

    try {
      const res = await fetch("/api/ai/bulk-document-filing/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ batchId: nextBatchId }),
      });

      const json = await readJsonResponse(res);

      if (!json.ok) {
        setMessage(json.error || "Processing failed.");
        return;
      }

      setItems(json.items || []);
      setMessage("Text extraction and patient matching complete. Please review before filing.");
    } catch (error: any) {
      setMessage(error?.message || "Processing failed.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles() {
    if (files.length === 0) {
      setMessage("Choose files first.");
      return;
    }

    setBusy(true);
    setMessage("Uploading files...");

    try {
      const formData = new FormData();

      for (const file of files) {
        formData.append("files", file);
      }

      const res = await fetch("/api/ai/bulk-document-filing/upload", {
        method: "POST",
        body: formData,
      });

      const json = await readJsonResponse(res);

      if (!json.ok) {
        setMessage(json.error || "Upload failed.");
        return;
      }

      setBatchId(json.batchId);
      setItems(json.items || []);
      setMessage(
        `Uploaded ${json.items?.length || 0} file(s). Extracting text and matching patients...`,
      );

      await processBatch(json.batchId);
    } catch (error: any) {
      setMessage(error?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function selectCandidate(itemId: string, candidate: any) {
    setBusy(true);
    setMessage("Saving selected patient...");

    try {
      const res = await fetch("/api/ai/bulk-document-filing/select-patient", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: itemId,
          patient: candidate,
        }),
      });

      const json = await readJsonResponse(res);

      if (!json.ok) {
        setMessage(json.error || "Failed to select patient.");
        return;
      }

      await refreshBatch();
      setMessage("Patient selected. This document is ready for human-approved filing.");
    } catch (error: any) {
      setMessage(error?.message || "Failed to select patient.");
    } finally {
      setBusy(false);
    }
  }

  async function fileSelected() {
    if (!batchId) return;

    setBusy(true);
    setMessage("Filing selected documents to Praktika...");

    try {
      const selectedIds = readyItems.map((item) => item.id);

      const res = await fetch("/api/ai/bulk-document-filing/file-selected", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemIds: selectedIds,
        }),
      });

      const json = await readJsonResponse(res);

      if (!json.ok) {
        setMessage(json.error || "Filing failed.");
        await refreshBatch();
        return;
      }

      await refreshBatch();
      setMessage(
        `Filed ${json.completed || 0} document(s). Failed: ${
          json.failed || 0
        }.`,
      );
    } catch (error: any) {
      setMessage(error?.message || "Filing failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-950">
          Bulk Praktika Document Filing
        </h1>

        <p className="mt-2 text-sm text-slate-600">
          Upload letters, PDFs, and images. The system will automatically
          extract text and match each document to a Praktika patient. Reception
          still approves patient selection and filing.
        </p>
      </div>

      <div className="mb-6">
        <PraktikaSessionPanel scope="user" title="My Praktika Session" />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium text-slate-900">
          Upload documents
        </label>

        <input
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp"
          onChange={onChooseFiles}
          className="mt-3 block w-full rounded-lg border border-slate-300 p-2 text-sm"
        />

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || files.length === 0}
            onClick={uploadFiles}
            className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working..." : "Upload + extract text + match patients"}
          </button>

          <button
            type="button"
            disabled={busy || !batchId}
            onClick={() => processBatch()}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retry extraction + matching
          </button>

          <button
            type="button"
            disabled={busy || readyItems.length === 0}
            onClick={fileSelected}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            File selected documents ({readyItems.length})
          </button>
        </div>

        {message ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {message}
          </p>
        ) : null}

        {items.length > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Uploaded
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-950">
                {items.length}
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-amber-700">
                Needs review
              </div>
              <div className="mt-1 text-xl font-semibold text-amber-900">
                {needsReviewCount}
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                Ready to file
              </div>
              <div className="mt-1 text-xl font-semibold text-emerald-900">
                {readyItems.length}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-950">
            Review documents
          </h2>
        </div>

        {items.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No uploaded documents yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    File
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    Uploaded by
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    Extracted patient
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    Match
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    Filing
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">
                    Possible patients
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((item) => {
                  const candidates = Array.isArray(item.praktika_match_candidates)
                    ? item.praktika_match_candidates
                    : [];

                  const uploaderLabel =
                    item.bulk_uploaded_by_name ||
                    item.bulk_uploaded_by_email ||
                    "Unknown user";

                  return (
                    <tr key={item.id} className="align-top">
                      <td className="px-4 py-4">
                        <div className="font-medium text-slate-950">
                          {item.file_name || "Untitled file"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {item.id}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Extraction:{" "}
                          {item.attachment_extraction_status || "not checked"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div
                          title={uploaderLabel}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white"
                        >
                          {getInitials(uploaderLabel)}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="text-slate-950">
                          {getPatientName(item) || "Not extracted"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          DOB: {item.extracted_patient_dob || "—"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${getMatchBadgeClass(
                            item.praktika_match_status,
                          )}`}
                        >
                          {item.praktika_match_status || "not_checked"}
                        </span>

                        <div className="mt-2 text-xs text-slate-500">
                          Confidence:{" "}
                          {confidencePercent(item.praktika_match_confidence)}
                        </div>

                        {item.praktika_patient_id ? (
                          <div className="mt-1 text-xs text-emerald-700">
                            Selected Praktika ID: {item.praktika_patient_id}
                          </div>
                        ) : null}

                        {item.praktika_match_reason ? (
                          <div className="mt-2 max-w-sm text-xs text-slate-500">
                            {item.praktika_match_reason}
                          </div>
                        ) : null}
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ring-1 ${getFilingBadgeClass(
                            item.praktika_filing_status,
                          )}`}
                        >
                          {item.praktika_filing_status || "pending"}
                        </span>

                        {item.praktika_filed_at ? (
                          <div className="mt-2 text-xs text-slate-500">
                            Filed:{" "}
                            {new Date(item.praktika_filed_at).toLocaleString()}
                          </div>
                        ) : null}

                        {item.praktika_filing_error ? (
                          <div className="mt-2 max-w-sm text-xs text-red-700">
                            {item.praktika_filing_error}
                          </div>
                        ) : null}
                      </td>

                      <td className="px-4 py-4">
                        {candidates.length === 0 ? (
                          <div className="text-xs text-slate-500">
                            No candidates.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {candidates.slice(0, 5).map((candidate: any) => {
                              const selected =
                                String(candidate.id) ===
                                String(item.praktika_patient_id || "");

                              return (
                                <button
                                  key={`${item.id}-${candidate.id}`}
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    selectCandidate(item.id, candidate)
                                  }
                                  className={`block w-full rounded-lg border p-3 text-left text-xs ${
                                    selected
                                      ? "border-emerald-500 bg-emerald-50"
                                      : "border-slate-200 bg-white hover:bg-slate-50"
                                  }`}
                                >
                                  <div className="font-semibold text-slate-950">
                                    {candidate.firstName} {candidate.lastName}
                                  </div>

                                  <div className="mt-1 text-slate-600">
                                    ID: {candidate.id} · DOB:{" "}
                                    {candidate.dob || "—"} · Score:{" "}
                                    {confidencePercent(candidate.matchScore)}
                                  </div>

                                  <div className="mt-1 text-slate-500">
                                    {candidate.matchReason || ""}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}