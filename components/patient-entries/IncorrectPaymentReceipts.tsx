"use client";
import { useEffect, useRef, useState } from "react";
import {
  MAX_RECEIPT_BYTES,
  receiptForProvider,
  type Receipt,
} from "@/lib/billing/receipt-contract";

type Option = { id: string; name: string };
export function usePaymentReceipts(
  periodId: string,
  refresh: number,
  entryId?: string,
) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReceipts([]);
    setError("");
    if (!periodId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(
      `/api/incorrect-payment-receipts?period=${encodeURIComponent(periodId)}${entryId ? `&entry=${encodeURIComponent(entryId)}` : ""}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Receipts unavailable.");
        if (!controller.signal.aborted) setReceipts(data.receipts);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Receipts unavailable.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [periodId, refresh, entryId]);
  return { receipts, error, loading };
}
function statusLabel(receipt: Receipt) {
  return receipt.status === "draft"
    ? "Draft — save the financial entry before billing"
    : receipt.status === "attached"
      ? "Attached to Xero"
      : receipt.status === "failed"
        ? "Failed"
        : receipt.status === "attaching"
          ? "Attaching / awaiting reconciliation"
          : receipt.status === "deleting"
            ? "Deletion incomplete — retry delete"
            : "Pending";
}
function ReceiptStatuses({ receipt }: { receipt: Receipt }) {
  if (receipt.status === "deleting") return <p>{statusLabel(receipt)}</p>;
  if (receipt.linked_entry?.deleted_at)
    return <p>Financial entry deleted — not included in billing</p>;
  return receipt.destinations?.length ? (
    <div>
      {receipt.destinations.map((destination) => (
        <p key={destination.provider_id}>
          {destination.provider?.name || "Provider"}:{" "}
          {statusLabel({ ...receipt, status: destination.status })}
          {destination.last_error ? ` · ${destination.last_error}` : ""}
        </p>
      ))}
    </div>
  ) : (
    <p>{statusLabel(receipt)}</p>
  );
}
export function BillingReceiptStatus({
  receipts,
  error,
  loading,
  providerId,
}: {
  receipts: Receipt[];
  error: string;
  loading: boolean;
  providerId: string;
}) {
  const rows = receipts
    .map((r) => receiptForProvider(r, providerId))
    .filter((r): r is Receipt => !!r);
  if (error)
    return (
      <p role="alert" className="mt-2 text-sm text-red-700">
        Incorrect payment receipts: {error}
      </p>
    );
  if (loading)
    return (
      <p className="mt-2 text-sm text-slate-600">
        Loading incorrect payment receipts…
      </p>
    );
  const pending = rows.filter((r) => r.status === "pending");
  const failed = rows.filter(
    (r) => r.status === "failed" || r.status === "attaching",
  );
  return (
    <div className="mt-2 text-sm text-slate-600">
      <p>
        Incorrect payment receipts: {pending.length} pending attachment
        {pending.length === 1 ? "" : "s"}
      </p>
      <p>
        {rows.filter((r) => r.status === "attached").length} attached to Xero ·{" "}
        {failed.length} failed / awaiting retry
      </p>
      {rows.filter((r) => r.status !== "deleting").length > 8 && (
        <p role="alert" className="mt-2 text-red-700">
          Too many receipts for one Xero invoice. The statement and production
          report need two of its ten attachment slots. Export will be blocked
          until the total fits.
        </p>
      )}
      {rows.length > 0 && (
        <details className="mt-3 rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer font-medium text-slate-800">
            View incorrect payment receipts ({rows.length})
          </summary>
          <ul className="mt-2 divide-y divide-slate-200">
            {rows.map((receipt) => (
              <li key={receipt.id} className="py-3">
                <p className="break-words font-medium text-slate-900">
                  {receipt.original_filename}
                </p>
                <p>
                  Payment date:{" "}
                  {receipt.payment_date
                    ? receipt.payment_date.split("-").reverse().join("/")
                    : "Not recorded"}
                </p>
                <ReceiptStatuses receipt={receipt} />
                {receipt.last_error && (
                  <p className="text-red-700">{receipt.last_error}</p>
                )}
                {receipt.status !== "deleting" && (
                  <div className="mt-2 flex gap-4">
                    <a
                      className="font-medium text-blue-700 underline"
                      href={`/api/incorrect-payment-receipts/${receipt.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview
                      <span className="sr-only">
                        {" "}
                        {receipt.original_filename}
                      </span>
                    </a>
                    <a
                      className="font-medium text-blue-700 underline"
                      href={`/api/incorrect-payment-receipts/${receipt.id}?download=1`}
                    >
                      Download
                      <span className="sr-only">
                        {" "}
                        {receipt.original_filename}
                      </span>
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
type QueuedReceipt = { id: string; file: File };
function SelectedReceiptPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return url ? (
    <img
      src={url}
      alt={`Selected photo: ${file.name}`}
      className="mt-2 max-h-48 max-w-full rounded border object-contain"
    />
  ) : null;
}
export default function IncorrectPaymentReceipts({
  providers,
  periods,
  periodId,
  providerId,
  onBusyChange,
  paymentMode = false,
  required = false,
  intendedProviderId,
  entryId,
  onSelectionChange,
  onDraftCreated,
}: {
  providers: Option[];
  periods: { id: string; label: string; status: string }[];
  periodId: string;
  providerId: string;
  onBusyChange?: (busy: boolean) => void;
  paymentMode?: boolean;
  required?: boolean;
  intendedProviderId?: string;
  entryId?: string;
  onSelectionChange?: (ids: string[]) => void;
  onDraftCreated?: (id: string) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const { receipts, error, loading } = usePaymentReceipts(
    periodId,
    refresh,
    paymentMode ? entryId : undefined,
  );
  const [uploadedIds, setUploadedIds] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueuedReceipt[]>([]);
  const [busy, setBusy] = useState(false);
  const activeRequest = useRef(false);
  const [message, setMessage] = useState("");
  const filesInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const period = periods.find((p) => p.id === periodId);
  const provider = providers.find((p) => p.id === providerId);
  const locked = period?.status !== "open";
  const intended = providers.find((p) => p.id === intendedProviderId);
  const disabled =
    busy ||
    locked ||
    !provider ||
    (paymentMode && (!intended || intendedProviderId === providerId));
  const rows = paymentMode
    ? receipts.filter(
        (r) =>
          (entryId && r.patient_financial_entry_id === entryId) ||
          uploadedIds.includes(r.id),
      )
    : receipts.filter(
        (r) =>
          r.provider_id === providerId ||
          r.destinations?.some((d) => d.provider_id === providerId),
      );
  const validRows = rows.filter(
    (r) =>
      r.provider_id === providerId &&
      r.intended_provider_id === intendedProviderId &&
      r.billing_period_id === periodId &&
      r.status !== "deleting" &&
      (!r.patient_financial_entry_id ||
        r.patient_financial_entry_id === entryId),
  );
  const selectionKey = paymentMode
    ? validRows
        .map((r) => r.id)
        .sort()
        .join(",")
    : "";
  useEffect(() => {
    onSelectionChange?.(selectionKey ? selectionKey.split(",") : []);
  }, [selectionKey, onSelectionChange]);
  const requiresReview =
    paymentMode &&
    rows.some(
      (r) =>
        r.destinations?.some(
          (d) => !!d.xero_invoice_id || d.status === "attaching",
        ) &&
        (r.provider_id !== providerId ||
          r.intended_provider_id !== intendedProviderId ||
          r.billing_period_id !== periodId),
    );
  const totalFiles =
    rows
      .map((r) => receiptForProvider(r, providerId))
      .filter((r) => r && r.status !== "deleting").length +
    queue.length +
    2;
  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (selected.some((file) => !file.size || file.size > MAX_RECEIPT_BYTES)) {
      setMessage(
        "Choose files no larger than 3 MB each. Retake or resize oversized photos before uploading.",
      );
      return;
    }
    setQueue((current) => [
      ...current,
      ...selected.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    setMessage("");
  }
  async function upload() {
    if (disabled || activeRequest.current || !queue.length) return;
    activeRequest.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setMessage("");
    let uploaded = 0;
    try {
      for (const item of queue) {
        const body = new FormData();
        body.set("provider_id", providerId);
        body.set("billing_period_id", periodId);
        body.set("file", item.file);
        if (paymentMode && intendedProviderId)
          body.set("intended_provider_id", intendedProviderId);
        const response = await fetch("/api/incorrect-payment-receipts", {
          method: "POST",
          body,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            `${uploaded} uploaded. ${item.file.name}: ${data.error || "Upload failed."} Remaining files are ready to retry.`,
          );
        uploaded++;
        if (paymentMode && data.receiptId) {
          setUploadedIds((ids) => [...ids, data.receiptId]);
          onDraftCreated?.(data.receiptId);
        }
        setQueue((current) => current.filter((entry) => entry.id !== item.id));
      }
      setMessage(
        `${uploaded} receipt(s) uploaded. They will attach through the existing billing action.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      activeRequest.current = false;
      setBusy(false);
      onBusyChange?.(false);
      setRefresh((value) => value + 1);
    }
  }
  async function remove(receipt: Receipt) {
    if (busy || !window.confirm(`Delete ${receipt.original_filename}?`)) return;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const response = await fetch(
        `/api/incorrect-payment-receipts/${receipt.id}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Delete failed.");
      setMessage("Receipt deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      setRefresh((value) => value + 1);
    }
  }
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">
        Upload Incorrect Payment Receipt
      </h2>
      {paymentMode && (
        <div className="my-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">
            {required
              ? "Receipt required before completing this payment"
              : "Historical entry — no retroactive receipt required"}
          </p>
          <p>
            Received in error by: {provider?.name || "Select provider above"}
          </p>
          <p>
            Payment owed to:{" "}
            {intended?.name || "Select provider actually owed above"}
          </p>
          <p role="status">
            Successfully stored receipts for this entry: {validRows.length}
          </p>
          <p>
            The same original receipt will be attached to both monthly invoices
            after the entry is saved.
          </p>
        </div>
      )}
      {requiresReview && (
        <p role="alert" className="text-red-700">
          Administrator review required: an attached receipt's provider or
          period cannot be changed.
        </p>
      )}
      <p className="mt-1 font-medium text-slate-700">
        Tyro or Stripe transaction record
      </p>
      <p className="mt-2 text-sm text-slate-600">
        {provider?.name || "Select a provider in the entry form above"} ·{" "}
        {period?.label || "Select a billing period above"}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        PNG, JPG, JPEG or PDF, up to 3 MB each.
      </p>
      {locked && (
        <p className="mt-2 text-amber-800">
          Choose an open billing period above to upload or delete receipts.
        </p>
      )}
      <div className="my-4 flex flex-wrap gap-3">
        <input
          ref={filesInput}
          type="file"
          accept=".png,.jpg,.jpeg,.pdf"
          multiple
          aria-label="Choose receipt files"
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            chooseFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Photograph receipt"
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            chooseFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => filesInput.current?.click()}
          disabled={disabled}
          className="rounded-xl border border-slate-300 px-4 py-2 font-medium disabled:opacity-50"
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={() => cameraInput.current?.click()}
          disabled={disabled}
          className="rounded-xl border border-slate-300 px-4 py-2 font-medium disabled:opacity-50"
        >
          Take photo
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Take photo uses your camera where supported, or opens the file picker.
        Review selected images before uploading.
      </p>
      {!paymentMode && totalFiles > 10 && (
        <p role="alert" className="mt-3 text-red-700">
          These receipts plus the statement and production report would require{" "}
          {totalFiles} attachments. Xero permits ten. Files can be stored here,
          but export will be blocked until the total fits.
        </p>
      )}
      {queue.length > 0 && (
        <ul className="my-3 divide-y">
          {queue.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <p className="break-words">{item.file.name}</p>
              <SelectedReceiptPreview file={item.file} />
              <button
                type="button"
                disabled={busy}
                className="mt-2 underline"
                onClick={() =>
                  setQueue((current) =>
                    current.filter((entry) => entry.id !== item.id),
                  )
                }
              >
                Remove selected file
                <span className="sr-only"> {item.file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={upload}
        disabled={disabled || !queue.length}
        className="my-3 rounded-xl bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload selected receipts"}
      </button>
      {message && (
        <p role="status" className="my-2 text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading receipts…</p>
      ) : (
        <ul className="divide-y">
          {rows.map((receipt) => (
            <li key={receipt.id} className="py-3 text-sm">
              <p className="break-words font-medium">
                {receipt.original_filename}
              </p>
              <ReceiptStatuses receipt={receipt} />
              {receipt.last_error && (
                <p className="text-red-700">{receipt.last_error}</p>
              )}
              <div className="mt-2 flex gap-4">
                {receipt.status !== "deleting" && (
                  <>
                    <a
                      className="underline"
                      href={`/api/incorrect-payment-receipts/${receipt.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview
                      <span className="sr-only">
                        {" "}
                        {receipt.original_filename}
                      </span>
                    </a>
                    <a
                      className="underline"
                      href={`/api/incorrect-payment-receipts/${receipt.id}?download=1`}
                    >
                      Download
                      <span className="sr-only">
                        {" "}
                        {receipt.original_filename}
                      </span>
                    </a>
                  </>
                )}
                {!locked &&
                  receipt.can_delete !== false &&
                  !receipt.xero_invoice_id &&
                  receipt.status !== "attached" &&
                  receipt.status !== "attaching" && (
                    <button
                      type="button"
                      disabled={busy}
                      className="text-red-700 underline disabled:opacity-50"
                      onClick={() => remove(receipt)}
                    >
                      Delete
                      <span className="sr-only">
                        {" "}
                        {receipt.original_filename}
                      </span>
                    </button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && !rows.length && (
        <p className="text-sm text-slate-500">
          No receipts for the selected provider and billing period.
        </p>
      )}
    </section>
  );
}
