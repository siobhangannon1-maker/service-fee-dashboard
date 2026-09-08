"use client";

import { useEffect, useRef, useState } from "react";

export function RetryMedirefButton({ draftId, onQueued }: { draftId: string; onQueued: () => void }) {
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/report-writing/retry-mediref?draftId=${encodeURIComponent(draftId)}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((result) => { if (result.eligible && typeof result.warning === "string") setWarning(result.warning); })
      .catch(() => {});
    return () => controller.abort();
  }, [draftId]);
  async function retry() {
    if (submitting.current || !warning || !window.confirm(warning)) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/report-writing/retry-mediref", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setMessage(result.error || "Unable to retry MediRef.");
        if (response.status === 409 || response.status >= 500) setWarning(null);
        return;
      }
      setMessage("MediRef retry queued.");
      setWarning(null);
      onQueued();
    } catch {
      setWarning(null);
      setMessage("Unable to confirm the retry. Check the queue before trying again.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  return <div>
    {warning && <button type="button" disabled={busy} onClick={retry}
      className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      {busy ? "Queuing…" : "Retry MediRef"}
    </button>}
    {message && <p role="status" className="mt-1 max-w-xs text-xs text-slate-700">{message}</p>}
  </div>;
}
