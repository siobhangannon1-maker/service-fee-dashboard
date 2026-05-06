"use client";

import { useState } from "react";

type SyncResult = {
  messageId: string;
  subject: string;
  status: "created" | "skipped" | "failed";
  error?: string;
};

type SyncResponse = {
  success: boolean;
  mailbox: string;
  imported: number;
  skipped: number;
  failed: number;
  results: SyncResult[];
};

export default function OutlookSyncClient() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [syncResponse, setSyncResponse] = useState<SyncResponse | null>(null);

  async function syncOutlook() {
    setLoading(true);
    setMessage("");
    setSyncResponse(null);

    try {
      const response = await fetch("/api/outlook/sync", {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Outlook sync failed.");
        return;
      }

      setSyncResponse(result);
      setMessage(
        `Sync complete. Imported ${result.imported}, skipped ${result.skipped}, failed ${result.failed}.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Outlook sync failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Outlook Email Sync
        </h1>

        <p className="mt-1 text-sm text-slate-600">
          Import recent emails and PDF attachments from the test Outlook inbox
          into the AI Reception workflow.
        </p>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">
              Manual test sync
            </h2>

            <p className="mt-1 text-sm text-slate-600">
              This imports the latest 10 messages, skips duplicates, extracts
              PDF text where possible, and sends them to the Workbench queue.
            </p>
          </div>

          <button
            type="button"
            onClick={syncOutlook}
            disabled={loading}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Syncing..." : "Sync Outlook emails"}
          </button>
        </div>

        {message ? (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {message}
          </div>
        ) : null}

        {syncResponse ? (
          <div className="mt-5">
            <div className="mb-3 grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">Mailbox</p>
                <p className="mt-1 truncate text-sm font-medium text-slate-900">
                  {syncResponse.mailbox}
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs text-emerald-700">Imported</p>
                <p className="mt-1 text-xl font-semibold text-emerald-800">
                  {syncResponse.imported}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs text-slate-500">Skipped</p>
                <p className="mt-1 text-xl font-semibold text-slate-800">
                  {syncResponse.skipped}
                </p>
              </div>

              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="text-xs text-red-700">Failed</p>
                <p className="mt-1 text-xl font-semibold text-red-800">
                  {syncResponse.failed}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Error</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {syncResponse.results.map((result) => (
                    <tr key={result.messageId}>
                      <td className="px-4 py-3 text-slate-800">
                        {result.subject}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                            result.status === "created"
                              ? "bg-emerald-50 text-emerald-700"
                              : result.status === "skipped"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {result.status}
                        </span>
                      </td>
                     <td className="px-4 py-3 text-xs text-red-700">
  {result.error ? (
    <pre className="whitespace-pre-wrap">
      {JSON.stringify(result.error, null, 2)}
    </pre>
  ) : result.pipeline ? (
    <pre className="whitespace-pre-wrap text-slate-600">
      {JSON.stringify(result.pipeline, null, 2)}
    </pre>
  ) : (
    "—"
  )}
</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href="/ai-reception/workbench"
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Open Workbench
              </a>

              <a
                href="/ai-reception/inbox"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open Classic Inbox
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}