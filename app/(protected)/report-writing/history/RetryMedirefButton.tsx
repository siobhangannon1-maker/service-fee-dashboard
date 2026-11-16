"use client";

import { useEffect, useRef, useState } from "react";

// The eligibility check runs only when staff click. History renders this for every
// failed-MediRef row, so checking on mount sent one heavy server request per row.
export function RetryMedirefButton({ draftId, onQueued }: { draftId: string; onQueued: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<"" | "checking" | "queuing">("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const check = useRef<AbortController | null>(null);
  useEffect(() => () => check.current?.abort(), []);
  async function retry() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy("checking");
    setMessage("");
    try {
      check.current = new AbortController();
      let warning: string | null = null;
      try {
        const response = await fetch(`/api/report-writing/retry-mediref?draftId=${encodeURIComponent(draftId)}`,
          { signal: check.current.signal, cache: "no-store" });
        const result = await response.json();
        if (result.eligible && typeof result.warning === "string") warning = result.warning;
        else setMessage(typeof result.error === "string" ? result.error : "MediRef retry is not available for this report.");
      } catch {
        if (!check.current.signal.aborted) setMessage("Unable to check MediRef retry. Try again shortly.");
        return;
      }
      if (!warning || !window.confirm(warning)) return;
      setBusy("queuing");
      try {
        const response = await fetch("/api/report-writing/retry-mediref", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          setMessage(result.error || "Unable to retry MediRef.");
          if (response.status === 409 || response.status >= 500) setHidden(true);
          return;
        }
        setMessage("MediRef retry queued.");
        setHidden(true);
        onQueued();
      } catch {
        setHidden(true);
        setMessage("Unable to confirm the retry. Check the queue before trying again.");
      }
    } finally {
      setBusy("");
      submitting.current = false;
    }
  }
  return <div>
    {!hidden && <button type="button" disabled={busy !== ""} onClick={retry}
      className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
      {busy === "checking" ? "Checking…" : busy === "queuing" ? "Queuing…" : "Retry MediRef"}
    </button>}
    {message && <p role="status" className="mt-1 max-w-xs text-xs text-slate-700">{message}</p>}
  </div>;
}
