"use client";

import { useMemo, useState } from "react";

import ConfirmPatientMatchButton from "@/components/ai/ConfirmPatientMatchButton";
import DraftGuidancePanel from "@/components/ai/DraftGuidancePanel";
import RunPatientMatchButton from "@/components/ai/RunPatientMatchButton";

type DraftGuidance = {
  category?: string;
  used_learning_rules?: string[];
  used_examples?: string[];
  safety_notes?: string[];
  learning_rules_count?: number;
  approved_examples_count?: number;
  learning_rule_ids?: string[];
  approved_example_ids?: string[];
};

type InboxItem = {
  id: string;
  created_at: string;
  file_name: string | null;
  file_path: string | null;
  status: string | null;
  category: string | null;
  patient_name: string | null;
  patient_dob: string | null;
  summary: string | null;
  suggested_action: string | null;
  match_status: string | null;
  reception_notes: string | null;
  final_decision: string | null;
  draft_reply_subject: string | null;
  draft_reply_body: string | null;
  draft_status: string | null;
  email_status: string | null;
  sender_email: string | null;
  sender_name: string | null;
  sent_at: string | null;
  guidance?: DraftGuidance | null;

  ai_cases?: {
    id: string;
    category: string | null;
    confidence: number | null;
    risk_level: string | null;
    recommended_next_step: string | null;
    ai_decisions?: {
      explanation: string | null;
      risks: string[] | null;
      created_at?: string | null;
    }[];
  }[];

  ai_patient_match_candidates?: {
    id: string;
    confidence: number | null;
    match_reason: string | null;
    matched_fields: string[] | null;
    status: string | null;
    patients?: {
      id: string;
      full_name: string | null;
      date_of_birth: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  }[];
};

type QueueFilter =
  | "all"
  | "needs_review"
  | "ready_to_send"
  | "sent_manually"
  | "no_reply_needed";

const categoryOptions = [
  "new_referral",
  "existing_patient_correspondence",
  "patient_request",
  "reschedule_request",
  "billing_question",
  "unknown",
];

const decisionOptions = [
  "create_new_patient",
  "attach_to_existing_patient",
  "reply_to_patient",
  "book_or_reschedule_appointment",
  "billing_follow_up",
  "needs_clinical_review",
  "no_action_required",
];

const emailStatusOptions = [
  "drafted",
  "ready_to_send",
  "sent_manually",
  "no_reply_needed",
];

const filterOptions: Array<{ value: QueueFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs_review", label: "Needs review" },
  { value: "ready_to_send", label: "Ready to send" },
  { value: "sent_manually", label: "Sent manually" },
  { value: "no_reply_needed", label: "No reply needed" },
];

export default function ApprovalQueueClient({
  initialItems,
}: {
  initialItems: InboxItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;

    if (activeFilter === "needs_review") {
      return items.filter(
        (item) =>
          !item.email_status ||
          item.email_status === "drafted" ||
          item.status === "classified" ||
          item.status === "processing"
      );
    }

    return items.filter((item) => item.email_status === activeFilter);
  }, [items, activeFilter]);

  const counts = useMemo(() => {
    return {
      all: items.length,
      needs_review: items.filter(
        (item) =>
          !item.email_status ||
          item.email_status === "drafted" ||
          item.status === "classified" ||
          item.status === "processing"
      ).length,
      ready_to_send: items.filter(
        (item) => item.email_status === "ready_to_send"
      ).length,
      sent_manually: items.filter(
        (item) => item.email_status === "sent_manually"
      ).length,
      no_reply_needed: items.filter(
        (item) => item.email_status === "no_reply_needed"
      ).length,
    };
  }, [items]);

  function updateItem(id: string, field: keyof InboxItem, value: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  }

  async function getFileUrl(filePath: string) {
    const res = await fetch("/api/ai-reception/get-file-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Could not open document.");
    }

    return data.url;
  }

  async function openDocument(item: InboxItem) {
    if (!item.file_path) {
      setMessage("No file path found for this document.");
      return;
    }

    try {
      setOpeningFileId(item.id);
      setMessage("");
      const url = await getFileUrl(item.file_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not open file.");
    } finally {
      setOpeningFileId(null);
    }
  }

  async function generateDraft(item: InboxItem) {
    setSavingId(item.id);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/generate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboxItemId: item.id }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to generate draft.");
        return;
      }

      const draftSubject =
        result?.draft?.subject ||
        result?.draft_reply_subject ||
        result?.subject ||
        "";

      const draftBody =
        result?.draft?.body || result?.draft_reply_body || result?.body || "";

      const guidance = result?.guidance || result?.draft?.guidance || null;

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                draft_reply_subject: draftSubject,
                draft_reply_body: draftBody,
                draft_status: "drafted",
                email_status: "drafted",
                guidance,
              }
            : entry
        )
      );

      setMessage(
        draftBody
          ? "Draft reply generated."
          : "Draft route ran, but no draft body was returned."
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Failed to generate draft."
      );
    } finally {
      setSavingId(null);
    }
  }

  async function saveDraftEdits(item: InboxItem) {
    if (!item.draft_reply_subject && !item.draft_reply_body) {
      setMessage("There is no draft to save yet.");
      return false;
    }

    setSavingId(item.id);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inboxItemId: item.id,
          subject: item.draft_reply_subject || "",
          body: item.draft_reply_body || "",
          status: "edited",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to save draft edits.");
        return false;
      }

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                draft_reply_subject:
                  result.draft?.subject || item.draft_reply_subject,
                draft_reply_body: result.draft?.body || item.draft_reply_body,
                draft_status: result.draft?.status || "edited",
                guidance: result.draft?.guidance || item.guidance || null,
              }
            : entry
        )
      );

      setMessage("Draft edits saved.");
      return true;
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Failed to save draft edits."
      );
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function copyDraft(item: InboxItem) {
    const subject = item.draft_reply_subject || "";
    const body = item.draft_reply_body || "";

    if (!subject && !body) {
      setMessage("There is no draft to copy yet.");
      return;
    }

    const textToCopy = `Subject: ${subject}\n\n${body}`;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(item.id);
      setMessage("Draft copied to clipboard.");
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setMessage("Could not copy draft. Please select and copy it manually.");
    }
  }

  async function sendEmail(item: InboxItem) {
    if (!item.sender_email) {
      setMessage("No recipient email found for this item.");
      return;
    }

    if (!item.draft_reply_body) {
      setMessage("No draft body found. Generate or write a draft first.");
      return;
    }

    const saved = await saveDraftEdits(item);

    if (!saved) return;

    const confirmed = window.confirm(
      `Send this edited email to ${item.sender_email} from ai-receptionist@focusdentalspecialists.com.au?`
    );

    if (!confirmed) return;

    setSavingId(item.id);
    setMessage("");

    try {
      const response = await fetch("/api/ai-reception/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          draft_reply_subject: item.draft_reply_subject,
          draft_reply_body: item.draft_reply_body,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to send email.");
        return;
      }

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                draft_status: "sent",
                email_status: "sent_manually",
                sent_at: new Date().toISOString(),
              }
            : entry
        )
      );

      setMessage(`Email sent to ${item.sender_email}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to send email.");
    } finally {
      setSavingId(null);
    }
  }

 async function approveItem(item: InboxItem) {
  try {
    setSavingId(item.id);
    setMessage("Processing item...");

    const response = await fetch("/api/ai-reception/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to approve item.");
      return;
    }

    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setMessage("Item processed successfully.");
  } catch (err) {
    setMessage(err instanceof Error ? err.message : "Failed to process item.");
  } finally {
    setSavingId(null);
  }
}

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Approval Queue
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Review AI-classified referrals, letters, x-rays and patient
          correspondence before actioning them.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {filterOptions.map((option) => {
          const active = activeFilter === option.value;
          const count = counts[option.value];

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setActiveFilter(option.value)}
              className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {option.label}
              <span
                className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                  active
                    ? "bg-white/20 text-white"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {message ? (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      ) : null}

      {filteredItems.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          No items match this filter.
        </div>
      ) : (
        <div className="grid gap-5">
          {filteredItems.map((item) => {
            const aiCase = item.ai_cases?.[0];
            const latestDecision = aiCase?.ai_decisions?.[0];

            const confirmedMatch =
              item.ai_patient_match_candidates?.find(
                (match) => match.status === "confirmed"
              ) || null;

            return (
              <section
                key={item.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-slate-900">
                      {item.file_name || "Untitled item"}
                    </h2>

                    <button
                      type="button"
                      onClick={() => openDocument(item)}
                      disabled={openingFileId === item.id || !item.file_path}
                      className="mt-2 text-sm font-medium text-blue-700 underline disabled:cursor-not-allowed disabled:text-slate-400"
                    >
                      {openingFileId === item.id
                        ? "Opening document..."
                        : "View document"}
                    </button>

                    <div className="mt-2 text-sm text-slate-500">
                      Status: {item.status || "unknown"} · Match:{" "}
                      {item.match_status ||
                        confirmedMatch?.status ||
                        "not checked"}{" "}
                      · Draft: {item.draft_status || "not_started"} · Email:{" "}
                      {item.email_status || "drafted"}
                    </div>

                    {item.sender_email ? (
                      <div className="mt-1 text-sm text-slate-500">
                        Reply to: {item.sender_email}
                      </div>
                    ) : null}
                  </div>

                  <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                    Awaiting review
                  </span>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Patient name
                    </span>
                    <input
                      value={item.patient_name || ""}
                      onChange={(e) =>
                        updateItem(item.id, "patient_name", e.target.value)
                      }
                      className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Date of birth
                    </span>
                    <input
                      value={item.patient_dob || ""}
                      onChange={(e) =>
                        updateItem(item.id, "patient_dob", e.target.value)
                      }
                      className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                      placeholder="DD/MM/YYYY"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Category
                    </span>
                    <select
                      value={item.category || "unknown"}
                      onChange={(e) =>
                        updateItem(item.id, "category", e.target.value)
                      }
                      className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                    >
                      {categoryOptions.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Final decision
                    </span>
                    <select
                      value={item.final_decision || ""}
                      onChange={(e) =>
                        updateItem(item.id, "final_decision", e.target.value)
                      }
                      className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                    >
                      <option value="">Choose decision</option>
                      {decisionOptions.map((decision) => (
                        <option key={decision} value={decision}>
                          {decision}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Email status
                    </span>
                    <select
                      value={item.email_status || "drafted"}
                      onChange={(e) =>
                        updateItem(item.id, "email_status", e.target.value)
                      }
                      className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                    >
                      {emailStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="mt-4 block">
                  <span className="text-sm font-medium text-slate-700">
                    Summary
                  </span>
                  <textarea
                    value={item.summary || ""}
                    onChange={(e) =>
                      updateItem(item.id, "summary", e.target.value)
                    }
                    className="mt-1 min-h-24 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                  />
                </label>

                <label className="mt-4 block">
                  <span className="text-sm font-medium text-slate-700">
                    Suggested action
                  </span>
                  <textarea
                    value={item.suggested_action || ""}
                    onChange={(e) =>
                      updateItem(item.id, "suggested_action", e.target.value)
                    }
                    className="mt-1 min-h-20 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                  />
                </label>

                {aiCase ? (
                  <div className="mt-5 rounded-3xl border border-indigo-100 bg-indigo-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          AI Brain Analysis
                        </h3>
                        <p className="text-xs text-slate-600">
                          AI reasoning, risk detection and workflow
                          recommendation.
                        </p>
                      </div>

                      <div className="rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-700">
                        Risk: {aiCase.risk_level || "unknown"}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 text-sm text-slate-700">
                      <div>
                        <span className="font-medium">Brain category:</span>{" "}
                        {aiCase.category || "unknown"}
                      </div>

                      <div>
                        <span className="font-medium">Confidence:</span>{" "}
                        {aiCase.confidence ?? "—"}
                      </div>

                      <div>
                        <span className="font-medium">
                          Recommended next step:
                        </span>{" "}
                        {aiCase.recommended_next_step || "No recommendation"}
                      </div>
                    </div>

                    {latestDecision?.explanation ? (
                      <div className="mt-4 rounded-2xl bg-white/80 p-4">
                        <p className="text-sm font-medium text-slate-900">
                          Why the AI thinks this
                        </p>

                        <p className="mt-2 text-sm text-slate-700">
                          {latestDecision.explanation}
                        </p>
                      </div>
                    ) : null}

                    {latestDecision?.risks?.length ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-medium text-amber-800">
                          Risks detected
                        </p>

                        <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
                          {latestDecision.risks.map((risk, index) => (
                            <li key={index}>{risk}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    No AI Brain analysis found for this item yet. Run AI Brain
                    from the AI Inbox first.
                  </div>
                )}

                <div className="mt-5 rounded-3xl border border-purple-100 bg-purple-50 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Patient Match
                      </h3>
                      <p className="text-xs text-purple-700">
                        Confirm whether this correspondence belongs to an
                        existing patient.
                      </p>
                    </div>

                    <RunPatientMatchButton inboxItemId={item.id} />
                  </div>

                  {confirmedMatch ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold">
                            Confirmed patient match
                          </p>
                          <p className="mt-1">
                            {confirmedMatch.patients?.full_name ||
                              "Unknown patient"}
                          </p>
                          <p>
                            DOB:{" "}
                            {confirmedMatch.patients?.date_of_birth ||
                              "Unknown"}
                          </p>
                        </div>

                        <div className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700">
                          {Math.round((confirmedMatch.confidence || 0) * 100)}%
                          confidence
                        </div>
                      </div>

                      <p className="mt-3">
                        {confirmedMatch.match_reason || "Confirmed by user."}
                      </p>
                    </div>
                  ) : null}

                  {item.ai_patient_match_candidates?.length ? (
                    <div className="mt-4 space-y-3">
                      {item.ai_patient_match_candidates.map((match) => {
                        const isConfirmed = match.status === "confirmed";
                        const isRejected = match.status === "rejected";

                        return (
                          <div
                            key={match.id}
                            className={`rounded-2xl border p-4 text-sm ${
                              isConfirmed
                                ? "border-emerald-200 bg-emerald-50"
                                : isRejected
                                ? "border-slate-200 bg-slate-50 opacity-70"
                                : "border-purple-100 bg-white"
                            }`}
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-medium text-slate-900">
                                  {match.patients?.full_name ||
                                    "Unknown patient"}
                                </p>
                                <p className="mt-1 text-slate-600">
                                  DOB:{" "}
                                  {match.patients?.date_of_birth || "Unknown"}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  Status: {match.status || "suggested"}
                                </p>
                              </div>

                              <div className="flex flex-col items-start gap-2 sm:items-end">
                                <div className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700">
                                  {Math.round((match.confidence || 0) * 100)}%
                                  confidence
                                </div>

                                {!isConfirmed && !isRejected ? (
                                  <ConfirmPatientMatchButton
                                    inboxItemId={item.id}
                                    matchCandidateId={match.id}
                                  />
                                ) : null}
                              </div>
                            </div>

                            <p className="mt-3 text-slate-700">
                              {match.match_reason || "No reasoning saved."}
                            </p>

                            {match.matched_fields?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {match.matched_fields.map((field, index) => (
                                  <span
                                    key={index}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                                  >
                                    {field}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-purple-700">
                      No patient matches found yet.
                    </p>
                  )}
                </div>

                <div className="mt-5 rounded-3xl border border-blue-100 bg-blue-50 p-4">
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Email draft
                      </h3>
                      <p className="text-xs text-slate-600">
                        Generate, edit, save, copy or send a suggested reply.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => generateDraft(item)}
                        disabled={savingId === item.id}
                        className="rounded-2xl bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingId === item.id
                          ? "Generating..."
                          : "Generate draft"}
                      </button>

                      <button
                        type="button"
                        onClick={() => copyDraft(item)}
                        disabled={
                          !item.draft_reply_subject && !item.draft_reply_body
                        }
                        className="rounded-2xl border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {copiedId === item.id ? "Copied" : "Copy draft"}
                      </button>

                      <button
                        type="button"
                        onClick={() => saveDraftEdits(item)}
                        disabled={
                          savingId === item.id ||
                          (!item.draft_reply_subject && !item.draft_reply_body)
                        }
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingId === item.id ? "Saving..." : "Save edits"}
                      </button>

                      <button
                        type="button"
                        onClick={() => sendEmail(item)}
                        disabled={
                          savingId === item.id ||
                          !item.sender_email ||
                          !item.draft_reply_body ||
                          item.email_status === "sent_manually"
                        }
                        className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {savingId === item.id
                          ? "Sending..."
                          : item.email_status === "sent_manually"
                          ? "Sent"
                          : "Send test email"}
                      </button>
                    </div>
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">
                      Draft subject
                    </span>
                    <input
                      value={item.draft_reply_subject || ""}
                      onChange={(e) =>
                        updateItem(
                          item.id,
                          "draft_reply_subject",
                          e.target.value
                        )
                      }
                      className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                    />
                  </label>

                  <label className="mt-4 block">
                    <span className="text-sm font-medium text-slate-700">
                      Draft body
                    </span>
                    <textarea
                      value={item.draft_reply_body || ""}
                      onChange={(e) =>
                        updateItem(item.id, "draft_reply_body", e.target.value)
                      }
                      className="mt-1 min-h-48 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                    />
                  </label>

                  <DraftGuidancePanel guidance={item.guidance} />
                </div>

                <label className="mt-4 block">
                  <span className="text-sm font-medium text-slate-700">
                    Reception notes
                  </span>
                  <textarea
                    value={item.reception_notes || ""}
                    onChange={(e) =>
                      updateItem(item.id, "reception_notes", e.target.value)
                    }
                    className="mt-1 min-h-20 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                    placeholder="Add any human review notes here..."
                  />
                </label>

                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => approveItem(item)}
                    disabled={savingId === item.id}
                    className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingId === item.id
                      ? "Processing..."
                      : "Mark as processed"}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}