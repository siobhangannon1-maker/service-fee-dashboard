"use client";

import { useState } from "react";

export default function PraktikaInboxMatchTestPage() {
  const [inboxItemId, setInboxItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<any>(null);

  async function runMatch() {
    try {
      setBusy(true);
      setMessage("");
      setResult(null);

      const response = await fetch("/api/ai/brain/praktika/match-patient", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          inboxItemId,
        }),
      });

      const text = await response.text();

      let parsed: any = null;

      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          `API did not return JSON. Status ${response.status}. Response starts with: ${text.slice(
            0,
            200,
          )}`,
        );
      }

      if (!response.ok) {
        throw new Error(parsed.error || "Patient match failed.");
      }

      setResult(parsed.result);
      setMessage("Patient match completed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Patient match failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold">Praktika Inbox Patient Match Test</h1>

        <p className="mt-2 text-sm text-slate-500">
          Paste an AI inbox item ID. This will extract patient details, search
          Praktika, score matches, and save the result to the inbox item.
        </p>

        <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block">
            <span className="text-sm font-medium">Inbox item ID</span>
            <input
              value={inboxItemId}
              onChange={(event) => setInboxItemId(event.target.value)}
              placeholder="Paste ai_inbox_items.id here"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={runMatch}
            disabled={busy || !inboxItemId.trim()}
            className="mt-5 rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Matching..." : "Run patient match"}
          </button>
        </section>

        {message ? (
          <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            {message}
          </div>
        ) : null}

        {result ? (
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Result</h2>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs uppercase text-slate-400">Status</div>
                <div className="mt-1 font-bold">{result.status}</div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs uppercase text-slate-400">
                  Confidence
                </div>
                <div className="mt-1 font-bold">
                  {Math.round((result.confidence || 0) * 100)}%
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs uppercase text-slate-400">
                  Best Praktika ID
                </div>
                <div className="mt-1 font-bold">
                  {result.bestMatch?.id || "None"}
                </div>
              </div>
            </div>

            <h3 className="mt-6 font-semibold">Raw result</h3>
            <pre className="mt-3 max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-white">
              {JSON.stringify(result, null, 2)}
            </pre>
          </section>
        ) : null}
      </div>
    </main>
  );
}