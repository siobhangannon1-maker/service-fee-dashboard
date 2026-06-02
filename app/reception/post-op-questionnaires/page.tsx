"use client";

import { useEffect, useMemo, useState } from "react";
import { displayPhone } from "@/lib/reception/phone";

type Row = {
  appointment: any;
  template: any;
  queueItem: any | null;
  status: string;
  has_mobile: boolean;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateDdMmYyyy(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

export default function PostOpQuestionnaireQueuePage() {
  const [date, setDate] = useState(todayIsoDate());
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  async function loadQueue() {
    setLoading(true);
    setMessage("");

    const response = await fetch(
      `/api/reception/post-op-questionnaire-queue?date=${date}&status=${statusFilter}`
    );

    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(data.error || "Could not load queue.");
      return;
    }

    setRows(data.rows || []);
    setSelectedIds([]);
  }

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, statusFilter]);

  const selectableRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.has_mobile &&
          row.status !== "completed" &&
          row.status !== "sent"
      ),
    [rows]
  );

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function selectAll() {
    setSelectedIds(
      selectableRows.map((row) => String(row.appointment.praktika_appointment_id))
    );
  }

  async function createOrSend(mode: "create" | "send") {
    const appointmentIds = selectedIds;

    if (appointmentIds.length === 0) {
      alert("Please select at least one appointment.");
      return;
    }

    if (
      mode === "send" &&
      !confirm(`Send post-op questionnaire SMS to ${appointmentIds.length} patient(s)?`)
    ) {
      return;
    }

    setSending(true);
    setMessage("");

    const response = await fetch("/api/reception/post-op-questionnaire-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode,
        appointmentIds,
      }),
    });

    const data = await response.json();
    setSending(false);

    if (!response.ok) {
      setMessage(data.error || "Could not update queue.");
      return;
    }

    setMessage(
      mode === "send"
        ? `Sent ${data.sentCount || 0}. Failed ${data.failedCount || 0}.`
        : `Created ${data.createdCount || 0} queue items.`
    );

    await loadQueue();
  }

  const totals = {
    total: rows.length,
    notCreated: rows.filter((row) => row.status === "not_created").length,
    queued: rows.filter((row) => row.status === "queued").length,
    sent: rows.filter((row) => row.status === "sent").length,
    completed: rows.filter((row) => row.status === "completed").length,
    urgent: rows.filter((row) => row.queueItem?.is_urgent).length,
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <a
              href="/reception/messages"
              className="text-sm font-semibold text-blue-600 hover:underline"
            >
              ← Back to messages
            </a>

            <h1 className="mt-3 text-2xl font-bold text-slate-900">
              Post-op questionnaire queue
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Automatically finds surgery, implant, extraction, exo, IV and sedation appointment types.
            </p>
          </div>
        </div>

        <section className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Appointment date
              </span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Status
              </span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="not_created">Not created</option>
                <option value="queued">Queued</option>
                <option value="sent">Sent</option>
                <option value="completed">Completed</option>
              </select>
            </label>

            <button
              onClick={loadQueue}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button
              onClick={selectAll}
              disabled={selectableRows.length === 0}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Select all
            </button>

            <button
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Clear
            </button>

            <button
              onClick={() => createOrSend("create")}
              disabled={sending || selectedIds.length === 0}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Create queue items
            </button>

            <button
              onClick={() => createOrSend("send")}
              disabled={sending || selectedIds.length === 0}
              className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {sending ? "Sending..." : `Send selected (${selectedIds.length})`}
            </button>
          </div>

          {message && <div className="mt-3 text-sm text-slate-600">{message}</div>}

          <div className="mt-4 grid gap-3 text-sm md:grid-cols-6">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Matched</div>
              <div className="text-xl font-bold">{totals.total}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Not created</div>
              <div className="text-xl font-bold">{totals.notCreated}</div>
            </div>
            <div className="rounded-xl bg-blue-50 p-3">
              <div className="text-xs text-blue-700">Queued</div>
              <div className="text-xl font-bold text-blue-800">{totals.queued}</div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-xs text-amber-700">Sent</div>
              <div className="text-xl font-bold text-amber-800">{totals.sent}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-xs text-emerald-700">Completed</div>
              <div className="text-xl font-bold text-emerald-800">{totals.completed}</div>
            </div>
            <div className="rounded-xl bg-red-50 p-3">
              <div className="text-xs text-red-700">Urgent</div>
              <div className="text-xl font-bold text-red-800">{totals.urgent}</div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="grid grid-cols-[44px_90px_1.2fr_1fr_1fr_1fr] border-b bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            <div />
            <div>Time</div>
            <div>Patient</div>
            <div>Appointment</div>
            <div>Template</div>
            <div>Status</div>
          </div>

          {rows.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No matching post-op appointments found for {formatDateDdMmYyyy(date)}.
            </div>
          )}

          <div className="divide-y">
            {rows.map((row) => {
              const appointment = row.appointment;
              const id = String(appointment.praktika_appointment_id);
              const selectable =
                row.has_mobile &&
                row.status !== "completed" &&
                row.status !== "sent";

              return (
                <div
                  key={id}
                  className="grid grid-cols-[44px_90px_1.2fr_1fr_1fr_1fr] items-center gap-2 px-4 py-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(id)}
                    disabled={!selectable}
                    onChange={() => toggleSelected(id)}
                  />

                  <div className="font-semibold text-slate-900">
                    {appointment.appointment_time || "—"}
                  </div>

                  <div>
                    <div className="font-semibold text-slate-900">
                      {[appointment.patient_first_name, appointment.patient_last_name]
                        .filter(Boolean)
                        .join(" ") || "Unknown patient"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {appointment.patient_mobile
                        ? displayPhone(appointment.patient_mobile)
                        : "No mobile"}
                    </div>
                  </div>

                  <div>
                    <div className="font-medium text-slate-900">
                      {appointment.tx_label || appointment.tx_type || "—"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {appointment.provider_name || "—"}
                    </div>
                  </div>

                  <div className="text-slate-700">
                    {row.template?.name || "—"}
                  </div>

                  <div className="space-y-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.status === "completed"
                          ? "bg-emerald-100 text-emerald-700"
                          : row.status === "sent"
                          ? "bg-amber-100 text-amber-700"
                          : row.status === "queued"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {row.status.replaceAll("_", " ")}
                    </span>

                    {row.queueItem?.is_urgent && (
                      <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        urgent
                      </span>
                    )}

                    {row.queueItem?.response_summary && (
                      <details className="mt-2 text-xs text-slate-600">
                        <summary className="cursor-pointer font-semibold">
                          View response
                        </summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-sans">
                          {row.queueItem.response_summary}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
