"use client";

import { useState } from "react";

type BulkAutomationResult = {
  ok?: boolean;
  mode?: "preview" | "execute";
  scanned?: number;
  eligible?: number;
  executed?: number;
  skipped?: number;
  failed?: number;
  message?: string;
  results?: Array<{
    inboxItemId: string;
    status: "eligible" | "executed" | "skipped" | "failed";
    patientName?: string | null;
    subject?: string | null;
    allowedActions?: string[];
    reason?: string;
    error?: string;
  }>;
  error?: string;
};

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export default function BulkSafeAutomationButton({
  onComplete,
}: {
  onComplete?: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<"preview" | "execute" | null>(null);
  const [result, setResult] = useState<BulkAutomationResult | null>(null);
  const [message, setMessage] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  async function runBulkAutomation(mode: "preview" | "execute") {
    if (busy) return;

    if (mode === "execute") {
      const confirmed = window.confirm(
        "Run safe automation for all eligible inbox items? This can file attachments to Praktika and may auto-archive items when all completion gates are met.",
      );

      if (!confirmed) return;
    }

    setBusy(mode);
    setMessage(mode === "preview" ? "Checking safe automations..." : "Running safe automations...");
    setResult(null);
    setShowDetails(false);

    try {
      const response = await fetch("/api/ai/automation-execute-bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dryRun: mode === "preview",
          limit: 25,
        }),
      });

      const json: BulkAutomationResult | null = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Bulk safe automation failed.");
      }

      setResult(json);
      setMessage(json.message || "Bulk safe automation completed.");

      if (mode === "execute") {
        await onComplete?.();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Bulk safe automation failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  const eligible = result?.eligible || 0;
  const executed = result?.executed || 0;
  const failed = result?.failed || 0;
  const skipped = result?.skipped || 0;

  return (
    <section className="rounded-2xl border border-purple-200 bg-purple-50 p-4 text-purple-950 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-bold">Bulk safe automation</div>
          <p className="mt-1 max-w-2xl text-sm text-purple-800">
            Finds active inbox items that are safe under your learning-rule automation gates. This only executes safe Praktika filing workflows; it does not send emails, send SMS, or create new patients.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runBulkAutomation("preview")}
            disabled={Boolean(busy)}
            className="rounded-xl border border-purple-300 bg-white px-3 py-2 text-xs font-semibold text-purple-800 hover:bg-purple-100 disabled:opacity-50"
          >
            {busy === "preview" ? "Checking..." : "Preview safe automations"}
          </button>

          <button
            type="button"
            onClick={() => runBulkAutomation("execute")}
            disabled={Boolean(busy)}
            className="rounded-xl bg-purple-700 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-800 disabled:opacity-50"
          >
            {busy === "execute" ? "Running..." : "Run safe automations"}
          </button>
        </div>
      </div>

      {message ? (
        <p className="mt-3 text-sm font-medium text-purple-900">{message}</p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl border border-purple-200 bg-white/75 p-3">
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <div>
              <div className="font-semibold text-purple-700">Eligible</div>
              <div className="mt-1 text-base font-bold">{eligible}</div>
            </div>
            <div>
              <div className="font-semibold text-purple-700">Executed</div>
              <div className="mt-1 text-base font-bold">{executed}</div>
            </div>
            <div>
              <div className="font-semibold text-purple-700">Skipped</div>
              <div className="mt-1 text-base font-bold">{skipped}</div>
            </div>
            <div>
              <div className="font-semibold text-purple-700">Failed</div>
              <div className="mt-1 text-base font-bold">{failed}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowDetails((current) => !current)}
            className="mt-3 text-xs font-semibold text-purple-800 underline"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>

          {showDetails ? (
            <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-purple-100 bg-white p-3 text-xs text-slate-700">
              {result.results && result.results.length > 0 ? (
                <div className="space-y-2">
                  {result.results.map((row) => (
                    <div key={row.inboxItemId} className="border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
                      <div className="font-semibold text-slate-900">
                        {row.patientName || row.subject || row.inboxItemId}
                      </div>
                      <div>Status: {row.status}</div>
                      {row.allowedActions?.length ? (
                        <div>Actions: {row.allowedActions.join(", ")}</div>
                      ) : null}
                      {row.reason ? <div>Reason: {row.reason}</div> : null}
                      {row.error ? <div className="text-red-700">Error: {row.error}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p>No item details returned.</p>
              )}
            </div>
          ) : null}

          <p className="mt-3 text-xs text-purple-800">
            Scanned {plural(result.scanned || 0, "item")}. This runner only processes items where the preview allows <strong>File to Praktika</strong>.
          </p>
        </div>
      ) : null}
    </section>
  );
}
