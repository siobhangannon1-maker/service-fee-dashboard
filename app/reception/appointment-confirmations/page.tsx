"use client";

import { useEffect, useMemo, useState } from "react";
import { displayPhone } from "@/lib/reception/phone";

type AppointmentRow = {
  id: string;
  praktika_appointment_id: string;
  praktika_patient_id: string;
  appointment_date: string | null;
  appointment_day: string | null;
  appointment_time: string | null;
  tx_type: string | null;
  tx_label: string | null;
  provider_name: string | null;
  mapped_location: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_mobile: string | null;
  confirmation_already_sent: boolean;
  confirmation_sent_at: string | null;
  confirmation_already_confirmed: boolean;
  confirmation_confirmed_at: string | null;
  has_mobile: boolean;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateDdMmYyyy(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-AU");
}

export default function AppointmentConfirmationsPage() {
  const [date, setDate] = useState(todayIsoDate());
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadAppointments() {
    setLoading(true);
    setMessage("");

    const response = await fetch(
      `/api/reception/appointment-confirmation-queue?date=${date}`
    );

    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(data.error || "Could not load appointments.");
      return;
    }

    setAppointments(data.appointments || []);
    setSelectedIds([]);
  }

  useEffect(() => {
    loadAppointments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const providers = useMemo(
    () =>
      Array.from(
        new Set(
          appointments
            .map((item) => item.provider_name)
            .filter(Boolean) as string[]
        )
      ).sort(),
    [appointments]
  );

  const locations = useMemo(
    () =>
      Array.from(
        new Set(
          appointments
            .map((item) => item.mapped_location)
            .filter(Boolean) as string[]
        )
      ).sort(),
    [appointments]
  );

  function statusFor(item: AppointmentRow) {
    if (!item.has_mobile) return "no_mobile";
    if (item.confirmation_already_confirmed) return "confirmed";
    if (item.confirmation_already_sent) return "sent";
    return "eligible";
  }

  const filteredAppointments = useMemo(() => {
    return appointments.filter((item) => {
      if (providerFilter !== "all" && item.provider_name !== providerFilter) {
        return false;
      }

      if (locationFilter !== "all" && item.mapped_location !== locationFilter) {
        return false;
      }

      if (statusFilter !== "all" && statusFor(item) !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [appointments, providerFilter, locationFilter, statusFilter]);

  const eligibleAppointments = useMemo(
    () =>
      filteredAppointments.filter(
        (item) =>
          item.has_mobile &&
          !item.confirmation_already_sent &&
          !item.confirmation_already_confirmed
      ),
    [filteredAppointments]
  );

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function selectAllEligible() {
    setSelectedIds(
      eligibleAppointments.map((item) => String(item.praktika_appointment_id))
    );
  }

  function clearSelected() {
    setSelectedIds([]);
  }

  async function sendAppointmentIds(appointmentIds: string[], forceResend = false) {
    if (appointmentIds.length === 0) return;

    const messageText = forceResend
      ? `Resend appointment confirmation SMS to ${appointmentIds.length} selected patient(s)?`
      : `Send appointment confirmation SMS to ${appointmentIds.length} selected patient(s)?`;

    if (!confirm(messageText)) return;

    setSending(true);
    setMessage("");

    const response = await fetch("/api/reception/appointment-confirmation-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appointmentIds,
        forceResend,
      }),
    });

    const data = await response.json();
    setSending(false);

    if (!response.ok) {
      setMessage(data.error || "Could not send confirmations.");
      return;
    }

    setMessage(`Sent ${data.sentCount || 0}. Failed ${data.failedCount || 0}.`);
    await loadAppointments();
  }

  const totals = {
    total: appointments.length,
    eligible: appointments.filter((item) => statusFor(item) === "eligible").length,
    sent: appointments.filter((item) => statusFor(item) === "sent").length,
    confirmed: appointments.filter((item) => statusFor(item) === "confirmed").length,
    noMobile: appointments.filter((item) => statusFor(item) === "no_mobile").length,
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
              Appointment confirmations
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Review appointments for a day, send selected confirmations, and
              manually resend when needed.
            </p>
          </div>

          <a
            href="/reception/location-rules"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Location rules
          </a>
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
                Provider
              </span>
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All providers</option>
                {providers.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Location
              </span>
              <select
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="all">All locations</option>
                {locations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
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
                <option value="all">All statuses</option>
                <option value="eligible">Eligible</option>
                <option value="sent">Sent</option>
                <option value="confirmed">Confirmed</option>
                <option value="no_mobile">No mobile</option>
              </select>
            </label>

            <button
              onClick={loadAppointments}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button
              onClick={selectAllEligible}
              disabled={eligibleAppointments.length === 0}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Select all eligible
            </button>

            <button
              onClick={clearSelected}
              disabled={selectedIds.length === 0}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
            >
              Clear
            </button>

            <button
              onClick={() => sendAppointmentIds(selectedIds, false)}
              disabled={sending || selectedIds.length === 0}
              className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {sending ? "Sending..." : `Send selected (${selectedIds.length})`}
            </button>
          </div>

          {message && <div className="mt-3 text-sm text-slate-600">{message}</div>}

          <div className="mt-4 grid gap-3 text-sm md:grid-cols-5">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Total</div>
              <div className="text-xl font-bold text-slate-900">
                {totals.total}
              </div>
            </div>

            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-xs text-emerald-700">Eligible</div>
              <div className="text-xl font-bold text-emerald-800">
                {totals.eligible}
              </div>
            </div>

            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-xs text-amber-700">Sent</div>
              <div className="text-xl font-bold text-amber-800">
                {totals.sent}
              </div>
            </div>

            <div className="rounded-xl bg-blue-50 p-3">
              <div className="text-xs text-blue-700">Confirmed</div>
              <div className="text-xl font-bold text-blue-800">
                {totals.confirmed}
              </div>
            </div>

            <div className="rounded-xl bg-red-50 p-3">
              <div className="text-xs text-red-700">No mobile</div>
              <div className="text-xl font-bold text-red-800">
                {totals.noMobile}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="grid grid-cols-[44px_90px_1.2fr_1fr_1fr_1fr_1.2fr] border-b bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            <div />
            <div>Time</div>
            <div>Patient</div>
            <div>Appointment</div>
            <div>Provider</div>
            <div>Location</div>
            <div>Status / Actions</div>
          </div>

          {filteredAppointments.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No appointments found for {formatDateDdMmYyyy(date)}.
            </div>
          )}

          <div className="divide-y">
            {filteredAppointments.map((appointment) => {
              const appointmentId = String(appointment.praktika_appointment_id);
              const status = statusFor(appointment);
              const eligible = status === "eligible";
              const canResend = status === "sent";

              return (
                <div
                  key={appointment.id}
                  className={`grid grid-cols-[44px_90px_1.2fr_1fr_1fr_1fr_1.2fr] items-center gap-2 px-4 py-3 text-sm ${
                    !eligible ? "bg-slate-50/60" : ""
                  }`}
                >
                  <div>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(appointmentId)}
                      disabled={!eligible}
                      onChange={() => toggleSelected(appointmentId)}
                    />
                  </div>

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
                      {appointment.tx_type || "—"}
                    </div>
                  </div>

                  <div className="text-slate-700">
                    {appointment.provider_name || "—"}
                  </div>

                  <div className="text-slate-700">
                    {appointment.mapped_location || "—"}
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {status === "no_mobile" && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          No mobile
                        </span>
                      )}

                      {status === "confirmed" && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          Confirmed
                        </span>
                      )}

                      {status === "sent" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Sent
                        </span>
                      )}

                      {status === "eligible" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          Eligible
                        </span>
                      )}
                    </div>

                    {appointment.confirmation_sent_at && (
                      <div className="text-xs text-slate-500">
                        Sent {formatDateTime(appointment.confirmation_sent_at)}
                      </div>
                    )}

                    {appointment.confirmation_confirmed_at && (
                      <div className="text-xs text-emerald-700">
                        Confirmed{" "}
                        {formatDateTime(appointment.confirmation_confirmed_at)}
                      </div>
                    )}

                    {canResend && (
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => sendAppointmentIds([appointmentId], true)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Resend
                      </button>
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
