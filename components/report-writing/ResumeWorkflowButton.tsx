"use client";

import { useEffect, useRef, useState } from "react";

export function ResumeWorkflowButton({
  draftId,
  onQueued,
  revision,
}: {
  draftId: string;
  onQueued: () => void;
  revision?: string;
}) {
  const [eligible, setEligible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setEligible(false);
    setLoaded(false);
    setConfirming(false);
    setMessage("");

    void (async () => {
      try {
        const response = await fetch(
          `/api/report-writing/resume-workflow?draftId=${encodeURIComponent(draftId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = await response.json().catch(() => ({}));
        if (!controller.signal.aborted) setEligible(response.ok && result.eligible === true);
      } catch {
        if (!controller.signal.aborted) setEligible(false);
      } finally {
        if (!controller.signal.aborted) setLoaded(true);
      }
    })();

    return () => controller.abort();
  }, [draftId, revision]);

  async function resume() {
    if (!eligible || !confirming || busy || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/report-writing/resume-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || result.success !== true) {
        setConfirming(false);
        setEligible(false);
        onQueued();
        setMessage(result.error || "Workflow could not be resumed. Refresh before trying again.");
        return;
      }

      setConfirming(false);
      setEligible(false);
      onQueued();
    } catch {
      setConfirming(false);
      setEligible(false);
      onQueued();
      setMessage("Workflow resume acknowledgement is unavailable. Refresh before trying again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  // Fail closed. The server must explicitly prove an exhausted, replay-safe read.
  if (!loaded || !eligible) {
    return message ? <p className="mt-2 text-xs" role="status">{message}</p> : null;
  }

  return (
    <div className="mt-2 text-xs" aria-label="Workflow recovery">
      {!confirming ? (
        <button
          type="button"
          disabled={busy}
          className="rounded border px-3 py-2"
          onClick={() => {
            setMessage("");
            setConfirming(true);
          }}
        >
          Resume Workflow
        </button>
      ) : (
        <div role="alertdialog" aria-label="Resume Workflow" className="space-y-2 rounded border p-2">
          <p>
            Automatic periodontal-chart retries have stopped. Resume the safe read
            and continue this existing workflow?
          </p>
          <p>
            This does not re-upload the letter to Praktika, repeat the Praktika icon
            update, or create a duplicate MediRef send.
          </p>
          <button
            type="button"
            disabled={busy}
            className="mr-2 rounded border px-2 py-1"
            onClick={() => {
              setConfirming(false);
              setMessage("");
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded border px-2 py-1"
            onClick={resume}
          >
            {busy ? "Resuming…" : "Yes — resume workflow"}
          </button>
        </div>
      )}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
