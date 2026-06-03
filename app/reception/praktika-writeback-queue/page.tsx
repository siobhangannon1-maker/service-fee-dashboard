"use client";

import { useEffect, useState } from "react";

type QueueItem = {
  id: string;
  conversation_id: string | null;
  praktika_patient_id: string | null;
  praktika_appointment_id: string | null;
  writeback_type: string;
  payload: any;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

async function readJsonSafely(response: Response) {
  const text = await response.text();

  if (!text) {
    return {
      error: `Request failed with status ${response.status}. No response body.`,
    };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      error: `Request failed with status ${response.status}. Response was not JSON: ${text.slice(
        0,
        300
      )}`,
    };
  }
}

export default function PraktikaWritebackQueuePage() {
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | "all" | null>(null);
  const [message, setMessage] = useState("");
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  async function loadItems() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/reception/praktika-writeback-queue?status=${status}`,
        {
          cache: "no-store",
        }
      );

      const data = await readJsonSafely(response);

      if (!response.ok) {
        setItems([]);
        setMessage(data.error || `Could not load queue. Status ${response.status}`);
        return;
      }

      setItems(data.items || []);
    } catch (error) {
      setItems([]);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load write-back queue."
      );
    } finally {
      setLoading(false);
      setInitialLoadDone(true);
    }
  }

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function processItem(id?: string) {
    setProcessing(id || "all");
    setMessage("");

    try {
      const response = await fetch("/api/reception/praktika-writeback-queue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(id ? { id } : { processAll: true }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        setMessage(data.error || `Could not process queue. Status ${response.status}`);
        return;
      }

      setMessage(
        `Processed ${data.processedCount || 0}. Success ${
          data.successCount || 0
        }. Failed ${data.failedCount || 0}.`
      );

      await loadItems();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not process write-back queue."
      );
    } finally {
      setProcessing(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <a
              href="/reception/messages"
              className="text-sm font-semibold text-blue-600 hover:underline"
            >
              ← Back to messages
            </a>

            <h1 className="mt-3 text-2xl font-bold text-slate-900">
              Praktika write-back queue
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Process appointment confirmations into Praktika using your logged-in user session.
            </p>
          </div>
        </div>

        <section className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Status
              </span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
                <option value="completed">Completed</option>
                <option value="processing">Processing</option>
              </select>
            </label>

            <button
              type="button"
              onClick={loadItems}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button
              type="button"
              onClick={() => processItem()}
              disabled={processing !== null || loading || items.length === 0}
              className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {processing === "all" ? "Processing..." : "Process all"}
            </button>
          </div>

          {message && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              {message}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="grid grid-cols-[1fr_150px_150px_120px_120px] gap-3 border-b bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            <div>Write-back</div>
            <div>Appointment</div>
            <div>Status</div>
            <div>Attempts</div>
            <div>Action</div>
          </div>

          {loading && !initialLoadDone && (
            <div className="p-8 text-center text-sm text-slate-500">
              Loading queue...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No {status} write-back items.
            </div>
          )}

          <div className="divide-y">
            {items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_150px_150px_120px_120px] items-center gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-semibold text-slate-900">
                    {item.writeback_type.replaceAll("_", " ")}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(item.created_at).toLocaleString("en-AU")}
                  </div>
                  {item.last_error && (
                    <div className="mt-1 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                      {item.last_error}
                    </div>
                  )}
                </div>

                <div>{item.praktika_appointment_id || "—"}</div>

                <div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      item.status === "completed"
                        ? "bg-emerald-100 text-emerald-700"
                        : item.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {item.status}
                  </span>
                </div>

                <div>{item.attempts || 0}</div>

                <div>
                  {item.status !== "completed" && (
                    <button
                      type="button"
                      onClick={() => processItem(item.id)}
                      disabled={processing !== null || loading}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                      {processing === item.id ? "Processing..." : "Process"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
