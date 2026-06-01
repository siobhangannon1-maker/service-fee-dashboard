"use client";

import { useEffect, useMemo, useState } from "react";
import PraktikaSessionPanel from "@/components/PraktikaSessionPanel";
import PraktikaSyncPanel from "@/components/reception/PraktikaSyncPanel";
import { displayPhone } from "@/lib/reception/phone";

type Conversation = {
  id: string;
  status: "open" | "closed";
  praktika_patient_id: string | null;
  praktika_appointment_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_mobile: string;
  assigned_display_name: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  twilio_status: string | null;
  staff_initials: string | null;
  staff_display_name: string | null;
  created_at: string;
};

type Audit = {
  id: string;
  action: string;
  actor_display_name: string | null;
  created_at: string;
};

type PatientSearchResult = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  mobile: string | null;
  patientNumber: number | null;
  dob: string | null;
};

function initialsFromName(name: string | null | undefined) {
  if (!name) return "?";

  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function StaffBadge({
  initials,
  name,
}: {
  initials: string | null;
  name: string | null;
}) {
  return (
    <div className="group relative inline-flex">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
        {initials || initialsFromName(name)}
      </div>

      <div className="pointer-events-none absolute right-0 top-10 z-20 hidden whitespace-nowrap rounded-xl bg-slate-900 px-3 py-2 text-xs text-white shadow-lg group-hover:block">
        {name || "Unknown staff member"}
      </div>
    </div>
  );
}

export default function ReceptionMessagesPage() {
  const [status, setStatus] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [patient, setPatient] = useState<any>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [consent, setConsent] = useState<any>(null);

  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);

  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>(
    []
  );
  const [creating, setCreating] = useState(false);

  async function loadConversations() {
    const response = await fetch(
      `/api/reception/conversations?status=${status}&search=${encodeURIComponent(
        search
      )}`
    );

    const data = await response.json();
    setConversations(data.conversations || []);
  }

  async function loadConversation(id: string) {
    const response = await fetch(`/api/reception/conversations/${id}`);
    const data = await response.json();

    setConversation(data.conversation || null);
    setMessages(data.messages || []);
    setAudits(data.audits || []);
    setPatient(data.patient || null);
    setAppointments(data.appointments || []);
    setConsent(data.consent || null);
  }

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadConversations();
    }, 300);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (selectedId) {
      loadConversation(selectedId);
    }
  }, [selectedId]);

  async function searchPatients(value: string) {
    setPatientSearch(value);

    if (value.trim().length < 2) {
      setPatientResults([]);
      return;
    }

    const response = await fetch(
      `/api/praktika/patient-search?q=${encodeURIComponent(value)}`
    );

    const data = await response.json();
    setPatientResults(data.patients || []);
  }

  async function createConversation(patientId: number) {
    setCreating(true);

    const response = await fetch("/api/reception/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        praktikaPatientId: String(patientId),
      }),
    });

    const data = await response.json();

    setCreating(false);

    if (!response.ok) {
      alert(data.error || "Could not create conversation.");
      return;
    }

    setPatientSearch("");
    setPatientResults([]);
    await loadConversations();
    setSelectedId(data.conversation.id);
  }

  async function sendMessage() {
    if (!selectedId || !composer.trim()) return;

    setSending(true);

    const response = await fetch("/api/reception/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: selectedId,
        body: composer,
      }),
    });

    const data = await response.json();
    setSending(false);

    if (!response.ok) {
      alert(data.error || "Could not send message.");
      return;
    }

    setComposer("");
    await loadConversation(selectedId);
    await loadConversations();
  }

  async function updateConversation(nextStatus: "open" | "closed") {
    if (!selectedId) return;

    const response = await fetch(`/api/reception/conversations/${selectedId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: nextStatus,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not update conversation.");
      return;
    }

    setStatus(nextStatus);
    await loadConversations();
    await loadConversation(selectedId);
  }

  async function toggleConsent(nextStatus: "subscribed" | "unsubscribed") {
    if (!conversation) return;

    const response = await fetch("/api/reception/consent", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phoneNumber: conversation.patient_mobile,
        praktikaPatientId: conversation.praktika_patient_id,
        status: nextStatus,
        reason: "Changed manually from reception inbox",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not update SMS consent.");
      return;
    }

    setConsent(data.consent);
  }

  const selectedName = useMemo(() => {
    if (!conversation) return "";

    return [conversation.patient_first_name, conversation.patient_last_name]
      .filter(Boolean)
      .join(" ");
  }, [conversation]);

  return (
    <main className="h-screen bg-slate-100">
      <div className="grid h-full grid-cols-[380px_1fr_360px]">
        <aside className="min-h-0 overflow-y-auto border-r border-slate-200 bg-white">
          <div className="sticky top-0 z-10 border-b bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold text-slate-900">
                  Messages
                </h1>
                <p className="text-xs text-slate-500">
                  Reception SMS inbox
                </p>
              </div>

              <div className="rounded-xl bg-slate-100 p-1 text-sm">
                <button
                  onClick={() => setStatus("open")}
                  className={`rounded-lg px-3 py-1 ${
                    status === "open" ? "bg-slate-950 text-white" : ""
                  }`}
                >
                  Open
                </button>
                <button
                  onClick={() => setStatus("closed")}
                  className={`rounded-lg px-3 py-1 ${
                    status === "closed" ? "bg-slate-950 text-white" : ""
                  }`}
                >
                  Closed
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 border-b p-3">
            <PraktikaSessionPanel scope="user" title="Praktika" />

            <PraktikaSyncPanel />

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Start new chat
              </label>

              <input
                value={patientSearch}
                onChange={(e) => searchPatients(e.target.value)}
                placeholder="Search patient name..."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />

              {patientResults.length > 0 && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border bg-white shadow-sm">
                  {patientResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => createConversation(p.id)}
                      disabled={creating}
                      className="block w-full border-b px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                    >
                      <div className="font-medium text-slate-900">
                        {p.preferredName || p.firstName} {p.lastName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {p.mobile || "No mobile"} · #{p.patientNumber || "—"} ·{" "}
                        DOB {p.dob || "—"}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Search conversations
              </label>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Patient name or mobile..."
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div>
            {conversations.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-500">
                No {status} conversations found.
              </div>
            )}

            {conversations.map((item) => {
              const name = [item.patient_first_name, item.patient_last_name]
                .filter(Boolean)
                .join(" ");

              const initials = initialsFromName(
                name || displayPhone(item.patient_mobile)
              );

              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`flex w-full gap-3 border-b p-4 text-left hover:bg-slate-50 ${
                    selectedId === item.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white">
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">
                      {name || displayPhone(item.patient_mobile)}
                    </div>

                    <div className="text-sm font-medium text-slate-700">
                      {displayPhone(item.patient_mobile)}
                    </div>

                    <div className="mt-1 truncate text-xs text-slate-500">
                      {item.last_message_preview || "No messages yet"}
                    </div>

                    {item.assigned_display_name && (
                      <div className="mt-1 text-xs text-slate-400">
                        Assigned to {item.assigned_display_name}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col bg-white">
          {conversation ? (
            <>
              <div className="flex items-center justify-between border-b px-5 py-3">
                <div>
                  <div className="text-lg font-semibold text-slate-900">
                    {selectedName || displayPhone(conversation.patient_mobile)}
                  </div>

                  <div className="text-sm text-slate-500">
                    {displayPhone(conversation.patient_mobile)}
                  </div>
                </div>

                <div className="flex gap-2">
                  {conversation.status === "open" ? (
                    <button
                      onClick={() => updateConversation("closed")}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                    >
                      Close
                    </button>
                  ) : (
                    <button
                      onClick={() => updateConversation("open")}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-5">
                {messages.length === 0 && (
                  <div className="py-12 text-center text-sm text-slate-500">
                    No messages yet.
                  </div>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.direction === "outbound"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div className="max-w-[75%]">
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                          message.direction === "outbound"
                            ? "bg-blue-100 text-slate-900"
                            : "bg-white text-slate-900"
                        }`}
                      >
                        {message.body}
                      </div>

                      <div
                        className={`mt-1 flex items-center gap-2 text-xs text-slate-500 ${
                          message.direction === "outbound"
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        {message.direction === "outbound" && (
                          <StaffBadge
                            initials={message.staff_initials}
                            name={message.staff_display_name}
                          />
                        )}

                        <span>
                          {new Date(message.created_at).toLocaleString("en-AU")}
                          {message.twilio_status
                            ? ` · ${message.twilio_status}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {audits.map((audit) => (
                  <div
                    key={audit.id}
                    className="text-center text-xs text-slate-500"
                  >
                    {audit.action.replaceAll("_", " ")}
                    {audit.actor_display_name
                      ? ` by ${audit.actor_display_name}`
                      : ""}{" "}
                    · {new Date(audit.created_at).toLocaleString("en-AU")}
                  </div>
                ))}
              </div>

              <div className="border-t bg-white p-4">
                {consent?.status === "unsubscribed" && (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    This patient has unsubscribed from SMS. Outbound messages are
                    blocked.
                  </div>
                )}

                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  placeholder={`Message ${
                    selectedName || displayPhone(conversation.patient_mobile)
                  }...`}
                  className="h-28 w-full resize-none rounded-2xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    {composer.length} / 1600 characters
                  </div>

                  <button
                    onClick={sendMessage}
                    disabled={
                      sending ||
                      !composer.trim() ||
                      consent?.status === "unsubscribed"
                    }
                    className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-slate-500">
              Select or create a conversation.
            </div>
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-slate-200 bg-white">
          {conversation ? (
            <div>
              <div className="border-b p-5">
                <div className="text-xl font-bold text-indigo-600">
                  {selectedName || "Unknown patient"}
                </div>

                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {displayPhone(conversation.patient_mobile)}
                </div>

                <div className="mt-3">
                  {consent?.status === "unsubscribed" ? (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                      Unsubscribed
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Subscribed
                    </span>
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  {consent?.status === "unsubscribed" ? (
                    <button
                      onClick={() => toggleConsent("subscribed")}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium"
                    >
                      Mark subscribed
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleConsent("unsubscribed")}
                      className="rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600"
                    >
                      Block / unsubscribe
                    </button>
                  )}
                </div>
              </div>

              <div className="border-b p-5">
                <h3 className="font-semibold text-slate-900">
                  Praktika patient
                </h3>

                {patient ? (
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    <div>Patient ID: {patient.praktika_patient_id}</div>
                    <div>Patient #: {patient.praktika_patient_number || "—"}</div>
                    <div>DOB: {patient.dob || "—"}</div>
                    <div>Mobile: {displayPhone(patient.mobile)}</div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-slate-500">
                    No Praktika patient linked.
                  </div>
                )}
              </div>

              <div className="border-b p-5">
                <h3 className="font-semibold text-slate-900">
                  Upcoming appointments
                </h3>

                <div className="mt-3 space-y-2">
                  {appointments.map((appointment) => (
                    <div
                      key={appointment.id}
                      className={`rounded-xl border p-3 text-sm ${
                        appointment.praktika_appointment_id ===
                        conversation.praktika_appointment_id
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200"
                      }`}
                    >
                      <div className="font-medium text-slate-900">
                        {appointment.appointment_day}{" "}
                        {appointment.appointment_date} ·{" "}
                        {appointment.appointment_time}
                      </div>

                      <div className="text-slate-500">
                        {appointment.tx_type || appointment.tx_label || "—"}
                      </div>

                      <div className="text-slate-500">
                        {appointment.mapped_location || "—"}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        Response ID: {appointment.patient_response_id || "—"}
                      </div>
                    </div>
                  ))}

                  {appointments.length === 0 && (
                    <div className="text-sm text-slate-500">
                      No synced appointments found.
                    </div>
                  )}
                </div>
              </div>

              <div className="p-5">
                <h3 className="font-semibold text-slate-900">Audit trail</h3>

                <div className="mt-3 space-y-2 text-sm">
                  {audits.length === 0 && (
                    <div className="text-sm text-slate-500">
                      No audit events yet.
                    </div>
                  )}

                  {audits.map((audit) => (
                    <div key={audit.id} className="rounded-xl bg-slate-50 p-3">
                      <div className="font-medium text-slate-900">
                        {audit.action.replaceAll("_", " ")}
                      </div>

                      <div className="text-xs text-slate-500">
                        {audit.actor_display_name || "System"} ·{" "}
                        {new Date(audit.created_at).toLocaleString("en-AU")}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 text-sm text-slate-500">
              Patient details will appear here.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}