"use client";

import { useEffect, useMemo, useState } from "react";
import PraktikaSessionPanel from "@/components/PraktikaSessionPanel";
import PraktikaSyncPanel from "@/components/reception/PraktikaSyncPanel";
import { displayPhone } from "@/lib/reception/phone";
import { createClient } from "@/lib/supabase/client";
import ConversationNotesPanel from "@/components/reception/ConversationNotesPanel";
import ConversationWorkflowPanel from "@/components/reception/ConversationWorkflowPanel";

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
  unread_count: number;
  workflow_status: string | null;
  is_urgent: boolean | null;
  appointment_confirmation_status?: string | null;
  appointment_confirmed_at?: string | null;
};

type Attachment = {
  id?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  storage_path?: string;
  public_url?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  storagePath?: string;
  publicUrl?: string;
};

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  twilio_status: string | null;
  staff_initials: string | null;
  staff_display_name: string | null;
  created_at: string;
  attachments?: Attachment[];
};

type Audit = {
  id: string;
  action: string;
  actor_display_name: string | null;
  created_at: string;
  message_id?: string | null;
  details?: any;
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

type Template = {
  id: string;
  name: string;
  category: string | null;
  body: string;
};

function initialsFromName(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function stableHash(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function patientInitialCircleClass(value: string | null | undefined) {
  const colours = [
    "bg-emerald-500",
    "bg-blue-500",
    "bg-violet-500",
    "bg-fuchsia-500",
    "bg-rose-500",
    "bg-orange-500",
    "bg-cyan-500",
    "bg-teal-500",
    "bg-indigo-500",
    "bg-lime-600",
  ];

  const key = value || "unknown";
  return colours[stableHash(key) % colours.length];
}

function readableFileSize(size?: number) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getAttachmentUrl(attachment: Attachment) {
  return attachment.public_url || attachment.publicUrl || "";
}

function getAttachmentName(attachment: Attachment) {
  return attachment.file_name || attachment.fileName || "Attachment";
}

function getAttachmentType(attachment: Attachment) {
  return attachment.file_type || attachment.fileType || "";
}

function getAttachmentSize(attachment: Attachment) {
  return attachment.file_size || attachment.fileSize || 0;
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

function workflowStatusLabel(value: string | null | undefined) {
  if (value === "waiting_on_patient") return "Waiting on patient";
  if (value === "waiting_on_practice") return "Waiting on practice";
  if (value === "needs_follow_up") return "Needs follow-up";
  return "General";
}

function workflowStatusClass(value: string | null | undefined) {
  if (value === "waiting_on_patient") {
    return "bg-amber-100 text-amber-800";
  }

  if (value === "waiting_on_practice") {
    return "bg-purple-100 text-purple-800";
  }

  if (value === "needs_follow_up") {
    return "bg-blue-100 text-blue-800";
  }

  return "bg-slate-100 text-slate-600";
}

function formatDateDdMmYyyy(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function confirmationStatusLabel(value: string | null | undefined) {
  if (value === "confirmed") return "Confirmed";
  if (value === "confirmation_requested") return "Confirmation requested";
  if (value === "ambiguous" || value === "ambiguous_response") {
    return "Needs staff review";
  }
  return "Not sent";
}

function confirmationStatusClass(value: string | null | undefined) {
  if (value === "confirmed") return "bg-emerald-100 text-emerald-700";
  if (value === "confirmation_requested") return "bg-amber-100 text-amber-700";
  if (value === "ambiguous" || value === "ambiguous_response") {
    return "bg-red-100 text-red-700";
  }
  return "bg-slate-100 text-slate-600";
}

function conversationMarkerLabel(action: string) {
  if (action === "conversation_closed") return "Conversation closed";
  if (action === "conversation_opened") return "Conversation reopened";
  if (action === "appointment_confirmed") return "Appointment confirmed";
  if (action === "appointment_confirmation_reply_detected") {
    return "Appointment confirmation reply received";
  }
  if (action === "appointment_confirmation_manually_resolved") {
    return "Appointment confirmation manually resolved";
  }
  if (action === "patient_file_uploaded") return "Patient uploaded a file";
  return action.replaceAll("_", " ");
}

function isConversationMarkerAudit(audit: Audit) {
  return (
    audit.action === "conversation_closed" ||
    audit.action === "conversation_opened" ||
    audit.action === "appointment_confirmed" ||
    audit.action === "appointment_confirmation_reply_detected" ||
    audit.action === "appointment_confirmation_manually_resolved" ||
    audit.action === "patient_file_uploaded"
  );
}

function latestConfirmationAuditForAppointment(
  audits: Audit[],
  appointmentId: string,
) {
  return audits
    .filter((audit) =>
      [
        "appointment_confirmation_request_sent_from_queue",
        "appointment_confirmation_request_resent",
        "appointment_confirmation_request_sent",
        "appointment_confirmation_reply_detected",
        "appointment_confirmation_manually_resolved",
      ].includes(audit.action),
    )
    .filter(
      (audit) =>
        String(audit.details?.praktika_appointment_id || "") ===
        String(appointmentId),
    )
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
}

function getLatestAmbiguousAudit(audits: Audit[]) {
  return audits
    .filter((audit) => audit.action === "ambiguous_confirmation_reply_received")
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
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
  const [confirmationSendingId, setConfirmationSendingId] = useState<
    string | null
  >(null);
  const [creatingQuestionnaireLink, setCreatingQuestionnaireLink] =
    useState(false);
  const [manualResolvingId, setManualResolvingId] = useState<string | null>(
    null,
  );

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>(
    [],
  );
  const [creating, setCreating] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [showPraktikaTools, setShowPraktikaTools] = useState(false);

  async function loadConversations() {
    try {
      const response = await fetch(
        `/api/reception/conversations?status=${status}&search=${encodeURIComponent(
          search,
        )}`,
      );

      if (!response.ok) {
        console.error("Could not load conversations", response.status);
        return;
      }

      const text = await response.text();

      if (!text) {
        console.error("Conversation API returned empty response.");
        return;
      }

      const data = JSON.parse(text);

      setConversations(data.conversations || []);
    } catch (error) {
      console.error("Conversation list failed to load", error);
    }
  }

  async function loadConversation(id: string) {
    try {
      const response = await fetch(`/api/reception/conversations/${id}`);

      if (!response.ok) return;

      const data = await response.json();

      setConversation(data.conversation || null);
      setMessages(data.messages || []);
      setAudits(data.audits || []);
      setPatient(data.patient || null);
      setAppointments(data.appointments || []);
      setConsent(data.consent || null);
    } catch {
      // Ignore cancelled fetches during navigation or hot reload.
    }
  }

  async function loadTemplates() {
    const response = await fetch("/api/reception/templates");
    const data = await response.json();
    setTemplates(data.templates || []);
  }

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    loadTemplates();
  }, []);

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
      setAttachments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadConversations();
    }, 5000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search]);

  useEffect(() => {
    if (!selectedId) return;

    const timer = window.setInterval(() => {
      loadConversation(selectedId);
    }, 5000);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function searchPatients(value: string) {
    setPatientSearch(value);

    if (value.trim().length < 2) {
      setPatientResults([]);
      return;
    }

    const response = await fetch(
      `/api/praktika/patient-search?q=${encodeURIComponent(value)}`,
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

  async function uploadAttachment(file: File) {
    if (!selectedId) {
      alert("Please select a conversation first.");
      return;
    }

    const maxSize = 5 * 1024 * 1024;

    if (file.size > maxSize) {
      alert("Please choose a file smaller than 5MB.");
      return;
    }

    setUploading(true);

    try {
      const supabase = createClient();
      const fileExt = file.name.split(".").pop() || "file";
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const storagePath = `${selectedId}/${Date.now()}-${safeName}`;

      const { error } = await supabase.storage
        .from("reception-message-attachments")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        alert(error.message);
        setUploading(false);
        return;
      }

      const { data } = supabase.storage
        .from("reception-message-attachments")
        .getPublicUrl(storagePath);

      setAttachments((current) => [
        ...current,
        {
          fileName: file.name,
          fileType: file.type || `application/${fileExt}`,
          fileSize: file.size,
          storagePath,
          publicUrl: data.publicUrl,
        },
      ]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not upload file.");
    }

    setUploading(false);
  }

  async function sendMessage() {
    if (!selectedId || (!composer.trim() && attachments.length === 0)) return;

    setSending(true);

    const response = await fetch("/api/reception/messages/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: selectedId,
        body: composer,
        attachments,
      }),
    });

    const data = await response.json();
    setSending(false);

    if (!response.ok) {
      alert(data.error || "Could not send message.");
      return;
    }

    setComposer("");
    setAttachments([]);
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

  async function linkAppointment(appointmentId: string) {
    if (!conversation) return;

    const response = await fetch(`/api/reception/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        praktikaAppointmentId: appointmentId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || "Could not link appointment.");
      return;
    }

    await loadConversation(conversation.id);
    await loadConversations();
  }

  async function sendAppointmentConfirmation(
    appointmentId: string,
    forceResend = false,
  ) {
    if (!conversation) return;

    const promptText = forceResend
      ? "Resend appointment confirmation SMS for this appointment?"
      : "Send appointment confirmation SMS for this appointment?";

    if (!confirm(promptText)) return;

    setConfirmationSendingId(appointmentId);

    const response = await fetch("/api/reception/appointment-confirmation-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appointmentIds: [appointmentId],
        forceResend,
      }),
    });

    const data = await response.json();

    setConfirmationSendingId(null);

    if (!response.ok || data.failedCount > 0) {
      const error =
        data?.results?.[0]?.error ||
        data.error ||
        "Could not send confirmation.";
      alert(error);
      return;
    }

    await loadConversation(conversation.id);
    await loadConversations();
  }

  async function insertPostOpQuestionnaireLink() {
    if (!conversation) return;

    setCreatingQuestionnaireLink(true);

    const response = await fetch("/api/reception/questionnaire-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: conversation.id,
        praktikaAppointmentId: conversation.praktika_appointment_id,
      }),
    });

    const data = await response.json();

    setCreatingQuestionnaireLink(false);

    if (!response.ok) {
      alert(data.error || "Could not create questionnaire link.");
      return;
    }

    setComposer((current) =>
      current.trim()
        ? `${current.trim()}\n\n${data.smsBody}`
        : data.smsBody
    );
  }

  async function manuallyResolveConfirmation(appointmentId: string) {
    if (!conversation) return;

    if (!confirm("Mark this appointment as confirmed from the patient's YES reply?")) {
      return;
    }

    const ambiguousAudit = getLatestAmbiguousAudit(audits);

    setManualResolvingId(appointmentId);

    const response = await fetch(
      "/api/reception/appointment-confirmation-manual-confirm",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: conversation.id,
          praktikaAppointmentId: appointmentId,
          inboundMessageId: ambiguousAudit?.message_id || null,
        }),
      },
    );

    const data = await response.json();

    setManualResolvingId(null);

    if (!response.ok) {
      alert(data.error || "Could not confirm appointment.");
      return;
    }

    await loadConversation(conversation.id);
    await loadConversations();
  }

  function applyMacros(templateBody: string) {
    const nextAppointment = appointments?.[0];

    return templateBody
      .replaceAll(
        "{{first_name}}",
        patient?.first_name || conversation?.patient_first_name || "",
      )
      .replaceAll(
        "{{preferred_name}}",
        patient?.preferred_name ||
          patient?.first_name ||
          conversation?.patient_first_name ||
          "",
      )
      .replaceAll(
        "{{last_name}}",
        patient?.last_name || conversation?.patient_last_name || "",
      )
      .replaceAll("{{patient_number}}", patient?.praktika_patient_number || "")
      .replaceAll(
        "{{next_appointment_date}}",
        formatDateDdMmYyyy(nextAppointment?.appointment_date),
      )
      .replaceAll(
        "{{next_appointment_time}}",
        nextAppointment?.appointment_time || "",
      )
      .replaceAll(
        "{{next_appointment_day}}",
        nextAppointment?.appointment_day || "",
      )
      .replaceAll(
        "{{next_appointment_type}}",
        nextAppointment?.tx_type || nextAppointment?.tx_label || "",
      )
      .replaceAll(
        "{{location}}",
        nextAppointment?.mapped_location || nextAppointment?.location || "",
      );
  }

  function insertEmoji(emoji: string) {
    setComposer((current) => `${current}${emoji}`);
    setEmojiOpen(false);
  }

  const selectedName = useMemo(() => {
    if (!conversation) return "";

    return [conversation.patient_first_name, conversation.patient_last_name]
      .filter(Boolean)
      .join(" ");
  }, [conversation]);

  const timelineItems = useMemo(() => {
    const messageItems = messages.map((message) => ({
      type: "message" as const,
      id: `message-${message.id}`,
      created_at: message.created_at,
      message,
      audit: null,
    }));

    const markerItems = audits
      .filter(isConversationMarkerAudit)
      .map((audit) => ({
        type: "marker" as const,
        id: `audit-${audit.id}`,
        created_at: audit.created_at,
        message: null,
        audit,
      }));

    return [...messageItems, ...markerItems].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [messages, audits]);

  const ambiguousAudit = useMemo(() => getLatestAmbiguousAudit(audits), [audits]);
  const ambiguousRequests = ambiguousAudit?.details?.pending_requests || [];
  const isAmbiguousConfirmation =
    conversation?.appointment_confirmation_status === "ambiguous" ||
    conversation?.appointment_confirmation_status === "ambiguous_response";

  return (
    <main className="h-screen overflow-hidden bg-slate-100">
      <div className="grid h-full min-h-0 grid-cols-[380px_1fr_360px]">
        <aside className="min-h-0 overflow-y-auto border-r border-slate-200 bg-white">
          <div className="sticky top-0 z-10 border-b bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-slate-900">
                  Messages
                </h1>
                <p className="text-xs text-slate-500">Reception SMS inbox</p>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="/reception/appointment-confirmations"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Confirmations
                </a>
                <a
                  href="/reception/post-op-questionnaires"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Post-op
                </a>
                <a
                  href="/reception/questionnaire-templates"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Q forms
                </a>
                <a
                  href="/reception/templates"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Templates
                </a>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-100 p-1 text-sm">
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => setStatus("open")}
                  className={`rounded-xl px-3 py-2 font-semibold transition ${
                    status === "open"
                      ? "bg-slate-950 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  Open
                </button>
                <button
                  onClick={() => setStatus("closed")}
                  className={`rounded-xl px-3 py-2 font-semibold transition ${
                    status === "closed"
                      ? "bg-slate-950 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white"
                  }`}
                >
                  Closed
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3 border-b p-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-500">
                New conversation
              </label>

              <input
                value={patientSearch}
                onChange={(e) => searchPatients(e.target.value)}
                placeholder="Search patient name..."
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
                        {p.mobile || "No mobile"} · #{p.patientNumber || "—"} ·
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
                name || displayPhone(item.patient_mobile),
              );

              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`flex w-full gap-3 border-b p-4 text-left hover:bg-slate-50 ${
                    selectedId === item.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="relative shrink-0">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white ${patientInitialCircleClass(item.id || item.patient_mobile)}`}>
                      {initials}
                    </div>

                    {item.unread_count > 0 && (
                      <div className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-600" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate font-semibold text-slate-900">
                        {name || displayPhone(item.patient_mobile)}
                      </div>

                      {item.unread_count > 0 && (
                        <div className="flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">
                          {item.unread_count}
                        </div>
                      )}
                    </div>

                    <div className="text-sm font-medium text-slate-700">
                      {displayPhone(item.patient_mobile)}
                    </div>

                    <div
                      className={`mt-1 truncate text-xs ${
                        item.unread_count > 0
                          ? "font-semibold text-slate-800"
                          : "text-slate-500"
                      }`}
                    >
                      {item.last_message_preview || "No messages yet"}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.is_urgent && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                          Urgent
                        </span>
                      )}

                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${workflowStatusClass(
                          item.workflow_status,
                        )}`}
                      >
                        {workflowStatusLabel(item.workflow_status)}
                      </span>

                      {(item.appointment_confirmation_status === "ambiguous" ||
                        item.appointment_confirmation_status ===
                          "ambiguous_response") && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                          Review YES
                        </span>
                      )}
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

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
          {conversation ? (
            <>
              <div className="shrink-0 flex items-center justify-between border-b px-5 py-3">
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

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 p-5 pb-8">
                {timelineItems.length === 0 && (
                  <div className="py-12 text-center text-sm text-slate-500">
                    No messages yet.
                  </div>
                )}
                {timelineItems.map((item) => {
                  if (item.type === "marker" && item.audit) {
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-center py-2"
                      >
                        <div className="w-full max-w-md text-center">
                          <div className="mb-2 border-t border-slate-300" />
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {conversationMarkerLabel(item.audit.action)}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {item.audit.actor_display_name
                              ? `by ${item.audit.actor_display_name}`
                              : "by System"}{" "}
                            ·{" "}
                            {new Date(item.audit.created_at).toLocaleString(
                              "en-AU",
                            )}
                          </div>
                          <div className="mt-2 border-t border-slate-300" />
                        </div>
                      </div>
                    );
                  }

                  if (!item.message) return null;

                  const message = item.message;

                  return (
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

                          {message.attachments &&
                            message.attachments.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {message.attachments.map(
                                  (attachment, index) => {
                                    const url = getAttachmentUrl(attachment);
                                    const type = getAttachmentType(attachment);
                                    const name = getAttachmentName(attachment);
                                    const size = getAttachmentSize(attachment);
                                    const isImage = type.startsWith("image/");

                                    return (
                                      <a
                                        key={`${url}-${index}`}
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block rounded-xl border border-slate-200 bg-white/80 p-2 text-xs hover:bg-white"
                                      >
                                        {isImage && url ? (
                                          <img
                                            src={url}
                                            alt={name}
                                            className="mb-2 max-h-48 rounded-lg object-contain"
                                          />
                                        ) : (
                                          <div className="mb-2 flex h-16 items-center justify-center rounded-lg bg-slate-100 text-2xl">
                                            📎
                                          </div>
                                        )}

                                        <div className="font-semibold text-slate-800">
                                          {name}
                                        </div>
                                        <div className="text-slate-500">
                                          {readableFileSize(size)}
                                        </div>
                                      </a>
                                    );
                                  },
                                )}
                              </div>
                            )}
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
                            {new Date(message.created_at).toLocaleString(
                              "en-AU",
                            )}
                            {message.twilio_status
                              ? ` · ${message.twilio_status}`
                              : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}{" "}
              </div>

              <div className="shrink-0 border-t bg-white p-4 shadow-[0_-6px_20px_rgba(15,23,42,0.06)]">
                {consent?.status === "unsubscribed" && (
                  <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    This patient has unsubscribed from SMS. Outbound messages
                    are blocked.
                  </div>
                )}

                <div className="relative rounded-2xl border border-slate-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                  <button
                    type="button"
                    onClick={() => setTemplateModalOpen(true)}
                    className="absolute right-0 top-0 z-20 flex h-9 w-9 items-center justify-center rounded-bl-xl rounded-tr-2xl bg-emerald-600 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
                    title="Insert template"
                  >
                    T
                  </button>

                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    placeholder={`Message ${
                      selectedName || displayPhone(conversation.patient_mobile)
                    }...`}
                    className="h-28 w-full resize-none rounded-t-2xl border-0 p-3 pr-12 text-sm outline-none"
                  />

                  {attachments.length > 0 && (
                    <div className="border-t px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {attachments.map((attachment, index) => (
                          <div
                            key={`${getAttachmentName(attachment)}-${index}`}
                            className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700"
                          >
                            <span>📎</span>
                            <span>{getAttachmentName(attachment)}</span>
                            <span className="text-slate-400">
                              {readableFileSize(getAttachmentSize(attachment))}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setAttachments((current) =>
                                  current.filter(
                                    (_, itemIndex) => itemIndex !== index,
                                  ),
                                )
                              }
                              className="font-bold text-red-500"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t bg-slate-50 px-3 py-2">
                    <div className="relative flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEmojiOpen((current) => !current)}
                        className="rounded-lg px-2 py-1 text-lg hover:bg-white"
                        title="Emoji"
                      >
                        😊
                      </button>

                      {emojiOpen && (
                        <div className="absolute bottom-10 left-0 z-40 grid w-56 grid-cols-8 gap-1 rounded-2xl border bg-white p-3 shadow-xl">
                          {[
                            "😀",
                            "😊",
                            "😂",
                            "😍",
                            "👍",
                            "🙏",
                            "🎉",
                            "❤️",
                            "🦷",
                            "📅",
                            "⏰",
                            "✅",
                            "❌",
                            "📍",
                            "📞",
                            "💬",
                          ].map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => insertEmoji(emoji)}
                              className="rounded-lg p-1 text-lg hover:bg-slate-100"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      <label
                        className="cursor-pointer rounded-lg px-2 py-1 text-lg hover:bg-white"
                        title="Attach file"
                      >
                        📎
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,.pdf,.doc,.docx"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) uploadAttachment(file);
                            event.target.value = "";
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedId) return;

                          const response = await fetch(
                            "/api/reception/upload-links",
                            {
                              method: "POST",
                              headers: {
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                conversationId: selectedId,
                              }),
                            },
                          );

                          const data = await response.json();

                          if (!response.ok) {
                            alert(
                              data.error || "Could not create upload link.",
                            );
                            return;
                          }

                          setComposer((current) =>
                            current
                              ? `${current}\n\nPlease upload your photo or file here:\n${data.url}`
                              : `Please upload your photo or file here:\n${data.url}`,
                          );
                        }}
                        className="rounded-lg px-2 py-1 text-lg hover:bg-white"
                        title="Create patient upload link"
                      >
                        📝
                      </button>

                      <button
                        type="button"
                        onClick={insertPostOpQuestionnaireLink}
                        disabled={creatingQuestionnaireLink}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-white disabled:opacity-50"
                        title="Insert post-op questionnaire link"
                      >
                        {creatingQuestionnaireLink
                          ? "Creating..."
                          : "Post-op questionnaire"}
                      </button>

                      <a
                        href="/reception/templates"
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-white"
                      >
                        Templates
                      </a>

                      {uploading && (
                        <span className="text-xs text-slate-500">
                          Uploading...
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-xs text-slate-500">
                        {composer.length} / 1600
                      </div>

                      <button
                        onClick={sendMessage}
                        disabled={
                          sending ||
                          uploading ||
                          (!composer.trim() && attachments.length === 0) ||
                          consent?.status === "unsubscribed"
                        }
                        className="rounded-xl bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {sending ? "Sending..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>

                {templateModalOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
                      <div className="flex items-center justify-between border-b p-4">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900">
                            Message templates
                          </h2>
                          <p className="text-sm text-slate-500">
                            Select a template to insert into the message box.
                          </p>
                        </div>

                        <button
                          onClick={() => setTemplateModalOpen(false)}
                          className="rounded-xl px-3 py-2 text-sm hover:bg-slate-100"
                        >
                          Close
                        </button>
                      </div>

                      <div className="max-h-[55vh] overflow-y-auto p-4">
                        <div className="mb-4">
                          <a
                            href="/reception/templates"
                            className="text-sm font-semibold text-blue-600 hover:underline"
                          >
                            Manage templates →
                          </a>
                        </div>

                        <div className="space-y-3">
                          {templates.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => {
                                setComposer(applyMacros(template.body));
                                setTemplateModalOpen(false);
                              }}
                              className="block w-full rounded-xl border p-3 text-left hover:bg-slate-50"
                            >
                              <div className="font-semibold text-slate-900">
                                {template.name}
                              </div>

                              <div className="text-xs text-slate-500">
                                {template.category || "No category"}
                              </div>

                              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                                {template.body}
                              </div>
                            </button>
                          ))}

                          {templates.length === 0 && (
                            <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                              No templates yet. Use “Manage templates” to create
                              your first one.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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

                <div className="mt-3 flex flex-wrap gap-2">
                  {consent?.status === "unsubscribed" ? (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                      Unsubscribed
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Subscribed
                    </span>
                  )}

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${confirmationStatusClass(
                      conversation.appointment_confirmation_status,
                    )}`}
                  >
                    {confirmationStatusLabel(
                      conversation.appointment_confirmation_status,
                    )}
                  </span>
                </div>

                {conversation.appointment_confirmed_at && (
                  <div className="mt-2 text-xs text-slate-500">
                    Confirmed{" "}
                    {new Date(
                      conversation.appointment_confirmed_at,
                    ).toLocaleString("en-AU")}
                  </div>
                )}

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

              {isAmbiguousConfirmation && (
                <div className="border-b border-red-100 bg-red-50 p-5">
                  <h3 className="font-semibold text-red-800">
                    Shared mobile confirmation needs review
                  </h3>
                  <p className="mt-1 text-sm text-red-700">
                    The patient replied YES, but more than one pending
                    appointment confirmation exists for this phone number.
                    Choose the correct appointment below.
                  </p>

                  <div className="mt-3 space-y-2">
                    {ambiguousRequests.length === 0 && (
                      <div className="rounded-xl bg-white p-3 text-sm text-red-700">
                        No pending requests were found in the audit details.
                        You can still confirm using the appointment cards below.
                      </div>
                    )}

                    {ambiguousRequests.map((request: any) => (
                      <button
                        key={`${request.message_id}-${request.praktika_appointment_id}`}
                        type="button"
                        disabled={
                          manualResolvingId ===
                          String(request.praktika_appointment_id)
                        }
                        onClick={() =>
                          manuallyResolveConfirmation(
                            String(request.praktika_appointment_id),
                          )
                        }
                        className="block w-full rounded-xl border border-red-200 bg-white p-3 text-left text-sm hover:bg-red-50 disabled:opacity-50"
                      >
                        <div className="font-semibold text-slate-900">
                          Confirm{" "}
                          {request.confirmation_patient_name ||
                            "this patient"}
                        </div>
                        <div className="text-xs text-slate-500">
                          {request.confirmation_appointment_label ||
                            `Appointment ${request.praktika_appointment_id}`}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <ConversationWorkflowPanel
                conversationId={conversation.id}
                workflowStatus={conversation.workflow_status}
                isUrgent={conversation.is_urgent}
                onUpdated={() => {
                  loadConversation(conversation.id);
                  loadConversations();
                }}
              />

              <ConversationNotesPanel conversationId={conversation.id} />

              <div className="border-b p-5">
                <h3 className="font-semibold text-slate-900">
                  Praktika patient
                </h3>

                {patient ? (
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    <div>Patient ID: {patient.praktika_patient_id}</div>
                    <div>
                      Patient #: {patient.praktika_patient_number || "—"}
                    </div>
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
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">
                    Upcoming appointments
                  </h3>
                  <a
                    href="/reception/appointment-confirmations"
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Open queue
                  </a>
                </div>

                <div className="mt-3 space-y-2">
                  {appointments.map((appointment) => {
                    const appointmentId = String(
                      appointment.praktika_appointment_id,
                    );
                    const isLinked =
                      appointmentId ===
                      String(conversation.praktika_appointment_id || "");
                    const latestAudit = latestConfirmationAuditForAppointment(
                      audits,
                      appointmentId,
                    );
                    const wasSent = Boolean(latestAudit);
                    const isConfirmed =
                      isLinked &&
                      conversation.appointment_confirmation_status ===
                        "confirmed";

                    return (
                      <div
                        key={appointment.id}
                        className={`rounded-xl border p-3 text-sm ${
                          isLinked
                            ? "border-blue-300 bg-blue-50"
                            : "border-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900">
                              {appointment.appointment_day}{" "}
                              {formatDateDdMmYyyy(
                                appointment.appointment_date,
                              )}{" "}
                              · {appointment.appointment_time}
                            </div>

                            <div className="mt-1 text-slate-600">
                              {appointment.tx_label ||
                                appointment.tx_type ||
                                "—"}
                            </div>

                            <div className="text-slate-500">
                              {appointment.mapped_location || "—"}
                            </div>
                          </div>

                          {isLinked && (
                            <span
                              className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${confirmationStatusClass(
                                conversation.appointment_confirmation_status,
                              )}`}
                            >
                              {confirmationStatusLabel(
                                conversation.appointment_confirmation_status,
                              )}
                            </span>
                          )}
                        </div>

                        {latestAudit && (
                          <div className="mt-2 rounded-lg bg-white/70 p-2 text-xs text-slate-500">
                            Last confirmation event:{" "}
                            {latestAudit.action.replaceAll("_", " ")} ·{" "}
                            {new Date(latestAudit.created_at).toLocaleString(
                              "en-AU",
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {!isLinked && (
                            <button
                              type="button"
                              onClick={() => linkAppointment(appointmentId)}
                              className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Link this appointment
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={
                              confirmationSendingId === appointmentId ||
                              consent?.status === "unsubscribed"
                            }
                            onClick={() =>
                              sendAppointmentConfirmation(appointmentId, false)
                            }
                            className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            {confirmationSendingId === appointmentId
                              ? "Sending..."
                              : "Send confirmation"}
                          </button>

                          {wasSent && !isConfirmed && (
                            <button
                              type="button"
                              disabled={
                                confirmationSendingId === appointmentId ||
                                consent?.status === "unsubscribed"
                              }
                              onClick={() =>
                                sendAppointmentConfirmation(appointmentId, true)
                              }
                              className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            >
                              Resend
                            </button>
                          )}
{isAmbiguousConfirmation && (
                            <button
                              type="button"
                              disabled={manualResolvingId === appointmentId}
                              onClick={() =>
                                manuallyResolveConfirmation(appointmentId)
                              }
                              className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
                            >
                              {manualResolvingId === appointmentId
                                ? "Confirming..."
                                : "Confirm this one"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {appointments.length === 0 && (
                    <div className="text-sm text-slate-500">
                      No synced appointments found.
                    </div>
                  )}
                </div>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      Audit trail
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      System history for this conversation. Hidden by default to
                      keep the inbox clean.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAuditTrail((current) => !current)}
                    className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {showAuditTrail ? "Hide" : "Show"}
                  </button>
                </div>

                {showAuditTrail && (
                  <div className="mt-3 space-y-2 text-sm">
                    {audits.length === 0 && (
                      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
                        No audit events yet.
                      </div>
                    )}

                    {audits.map((audit) => (
                      <div
                        key={audit.id}
                        className="rounded-xl bg-slate-50 p-3"
                      >
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
                )}
              </div>
            </div>
          ) : (
            <div className="p-5 text-sm text-slate-500">
              Patient details will appear here.
            </div>
          )}
        </aside>
      </div>

      <div className="fixed bottom-5 right-5 z-50">
        {showPraktikaTools && (
          <div className="mb-3 w-[420px] max-w-[calc(100vw-2rem)] rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  Praktika tools
                </div>
                <div className="text-xs text-slate-500">
                  Session, patient sync and appointment sync.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPraktikaTools(false)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <PraktikaSessionPanel scope="user" title="Praktika" />
              <PraktikaSyncPanel />
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <a
                  href="/reception/location-rules"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-blue-600 hover:bg-slate-50"
                >
                  Location mapping
                </a>
                <a
                  href="/reception/appointment-confirmations"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-blue-600 hover:bg-slate-50"
                >
                  Confirmations
                </a>
                <a
                  href="/reception/post-op-questionnaires"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-blue-600 hover:bg-slate-50"
                >
                  Post-op questionnaires
                </a>
                <a
                  href="/reception/questionnaire-templates"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-blue-600 hover:bg-slate-50"
                >
                  Questionnaire templates
                </a>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowPraktikaTools((current) => !current)}
          className="rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-2xl hover:bg-slate-800"
        >
          Praktika tools
        </button>
      </div>
    </main>
  );
}
