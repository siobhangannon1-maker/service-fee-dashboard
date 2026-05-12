"use client";

import { useState } from "react";

export default function FileInboxItemToPraktikaButton({
  inboxItemId,
  praktikaPatientId,
  filingStatus,
}: {
  inboxItemId: string;
  praktikaPatientId?: string | null;
  filingStatus?: string | null;
}) {
  const [status, setStatus] = useState(filingStatus || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const alreadyFiled = status === "completed";

  async function fileToPraktika(force = false) {
    setBusy(true);
    setMessage(force ? "Re-filing to Praktika..." : "Filing to Praktika...");

    try {
      const res = await fetch("/api/praktika/patient-filing/inbox-item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
          force,
        }),
      });

      const json = await res.json();

      if (!json.ok) {
        setStatus("failed");
        setMessage(json.error || "Failed to file to Praktika.");
        return;
      }

      if (json.skipped) {
        setStatus("completed");
        setMessage(json.reason || "Already filed to Praktika.");
        return;
      }

      setStatus("completed");
      setMessage("Filed to Praktika successfully.");
    } catch (error: any) {
      setStatus("failed");
      setMessage(error?.message || "Failed to file to Praktika.");
    } finally {
      setBusy(false);
    }
  }

  if (!praktikaPatientId) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Confirm a Praktika patient match before filing attachments.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-slate-950">
        File to Praktika
      </div>

      <p className="mt-1 text-sm text-slate-600">
        Upload PDFs to Communications, images to Images, and add an AI action
        note to Clinical Notes.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || alreadyFiled}
          onClick={() => fileToPraktika(false)}
          className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Filing..." : alreadyFiled ? "Already filed" : "File to Praktika"}
        </button>

        {alreadyFiled ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => fileToPraktika(true)}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Re-file anyway
          </button>
        ) : null}
      </div>

      {message ? (
        <p
          className={`mt-3 text-sm ${
            status === "failed" ? "text-red-700" : "text-emerald-700"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}