"use client";

import { useState } from "react";

type ReminderResult = {
  providerId: string;
  providerName: string;
  count: number;
  sent: boolean;
  phone?: string | null;
  error?: string;
  twilioSid?: string;
  twilioStatus?: string;
};

export default function WeeklyReportWritingRemindersPage() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<ReminderResult[]>([]);

  async function sendNow() {
    const confirmed = window.confirm(
      "Send SMS reminders now to all providers with letters awaiting approval?"
    );

    if (!confirmed) return;

    setSending(true);
    setMessage("");
    setResults([]);

    try {
      const response = await fetch(
        "/api/report-writing/weekly-provider-approval-reminders/send-now",
        {
          method: "POST",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to send reminders.");
      }

      setResults(data.results || []);
      setMessage(`Sent ${data.sent || 0} reminder SMS message(s).`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to send reminders."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-950">
            Weekly Provider Approval Reminders
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            This sends the same SMS as the Friday 5 PM automatic reminder to
            providers who currently have letters awaiting approval.
          </p>

          <button
            type="button"
            onClick={sendNow}
            disabled={sending}
            className="mt-5 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {sending ? "Sending reminders..." : "Send weekly reminder now"}
          </button>

          {message ? (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              {message}
            </div>
          ) : null}
        </section>

        {results.length > 0 ? (
          <section className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Results</h2>

            <div className="mt-4 overflow-hidden rounded-2xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="p-3">Provider</th>
                    <th className="p-3">Letters</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>

                <tbody>
                  {results.map((result) => (
                    <tr key={result.providerId} className="border-t">
                      <td className="p-3 font-medium text-slate-900">
                        {result.providerName}
                      </td>
                      <td className="p-3">{result.count}</td>
                      <td className="p-3">{result.phone || "Missing"}</td>
                      <td className="p-3">
                        {result.sent ? (
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                            Sent
                          </span>
                        ) : (
                          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                            {result.error || "Failed"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}