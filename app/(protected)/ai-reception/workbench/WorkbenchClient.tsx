"use client";

import { useEffect, useMemo, useState } from "react";

import AuditTrailPanel from "@/components/ai/AuditTrailPanel";
import ConfirmPatientMatchButton from "@/components/ai/ConfirmPatientMatchButton";
import RunPatientMatchButton from "@/components/ai/RunPatientMatchButton";

type KnowledgeSource = {
  id?: string;
  document_id?: string;
  title?: string;
  heading?: string | null;
  similarity?: number | null;
};

type DraftGuidance = {
  category?: string;
  used_learning_rules?: string[];
  used_examples?: string[];
  used_knowledge?: string[];
  safety_notes?: string[];
  learning_rules_count?: number;
  approved_examples_count?: number;
  knowledge_chunks_count?: number;
  learning_rule_ids?: string[];
  approved_example_ids?: string[];
  knowledge_sources?: KnowledgeSource[];
};

type AIDecisionJson = {
  operational_intent?: string | null;
  missing_information?: string[] | null;
  requires_clinical_review?: boolean | null;
  safe_to_auto_draft?: boolean | null;
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

  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;

  outlook_draft_id: string | null;
  outlook_message_id: string | null;
  outlook_conversation_id: string | null;
  outlook_web_link: string | null;
  outlook_draft_created_at: string | null;

  sent_detected_at: string | null;
  sent_detection_method: string | null;
  outlook_sent_message_id: string | null;
  outlook_sent_web_link: string | null;

  attachment_extraction_status: string | null;
  attachment_needs_ocr: boolean | null;

  ai_cases?: {
    id: string;
    category: string | null;
    confidence: number | null;
    risk_level: string | null;
    recommended_next_step: string | null;
    ai_decisions?: {
      explanation: string | null;
      risks: string[] | null;
      decision?: AIDecisionJson | null;
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
  | "outlook_draft_created"
  | "sent_manually"
  | "no_reply_needed"
  | "archived";

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
  "outlook_draft_created",
  "sent_manually",
  "no_reply_needed",
  "archived",
];

const filterOptions: Array<{ value: QueueFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs_review", label: "Needs review" },
  { value: "ready_to_send", label: "Ready" },
  { value: "outlook_draft_created", label: "Outlook draft" },
  { value: "sent_manually", label: "Sent" },
  { value: "no_reply_needed", label: "No reply" },
  { value: "archived", label: "Archived" },
];

function formatDateTime(value: string | null, hasMounted: boolean) {
  if (!value) return null;
  if (!hasMounted) return value;
  return new Date(value).toLocaleString();
}

export default function WorkbenchClient({
  initialItems,
}: {
  initialItems: InboxItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialItems[0]?.id || null
  );
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const filteredItems = useMemo(() => {
    if (activeFilter === "all") return items;

    if (activeFilter === "needs_review") {
      return items.filter(
        (item) =>
          !item.email_status ||
          item.email_status === "drafted" ||
          item.status === "classified" ||
          item.status === "processing" ||
          item.status === "uploaded"
      );
    }

    return items.filter((item) => item.email_status === activeFilter);
  }, [items, activeFilter]);

  const selectedItem =
    filteredItems.find((item) => item.id === selectedItemId) ||
    filteredItems[0] ||
    null;

  const counts = useMemo(() => {
    return {
      all: items.length,
      needs_review: items.filter(
        (item) =>
          !item.email_status ||
          item.email_status === "drafted" ||
          item.status === "classified" ||
          item.status === "processing" ||
          item.status === "uploaded"
      ).length,
      ready_to_send: items.filter(
        (item) => item.email_status === "ready_to_send"
      ).length,
      outlook_draft_created: items.filter(
        (item) => item.email_status === "outlook_draft_created"
      ).length,
      sent_manually: items.filter(
        (item) => item.email_status === "sent_manually"
      ).length,
      no_reply_needed: items.filter(
        (item) => item.email_status === "no_reply_needed"
      ).length,
      archived: items.filter((item) => item.email_status === "archived").length,
    };
  }, [items]);

  function updateItem(id: string, field: keyof InboxItem, value: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  }

  function getItemTitle(item: InboxItem) {
    return (
      item.patient_name ||
      item.file_name ||
      item.sender_name ||
      item.sender_email ||
      "Untitled item"
    );
  }

  function getStatusLabel(item: InboxItem) {
    const itemAiCase = item.ai_cases?.[0] || null;
    const itemLatestDecision = itemAiCase?.ai_decisions?.[0] || null;
    const itemDecisionData = itemLatestDecision?.decision || {};

    if (item.attachment_needs_ocr) return "OCR";
    if (itemDecisionData.requires_clinical_review) return "Clinical";
    if (itemDecisionData.missing_information?.length) return "Missing info";
    if (item.email_status === "outlook_draft_created") return "Outlook";
    if (item.email_status === "archived") return "Archived";
    if (item.email_status === "sent_manually") return "Sent";
    if (item.email_status === "ready_to_send") return "Ready";
    if (item.email_status === "no_reply_needed") return "No reply";
    if (item.draft_reply_body) return "Drafted";
    return "Review";
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

  async function createOutlookDraft(item: InboxItem) {
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

    setSavingId(item.id);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/create-outlook-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboxItemId: item.id }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to create Outlook draft.");
        return;
      }

      const outlookDraft = result.outlookDraft;
      const now = new Date().toISOString();

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                draft_status: "outlook_draft_created",
                email_status: "outlook_draft_created",
                outlook_draft_id: outlookDraft?.id || null,
                outlook_message_id: outlookDraft?.id || null,
                outlook_conversation_id: outlookDraft?.conversationId || null,
                outlook_web_link: outlookDraft?.webLink || null,
                outlook_draft_created_at: now,
              }
            : entry
        )
      );

      setMessage("Outlook draft created in the shared reception mailbox.");

      if (outlookDraft?.webLink) {
        window.open(outlookDraft.webLink, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Failed to create Outlook draft."
      );
    } finally {
      setSavingId(null);
    }
  }

  async function checkOutlookSent(item: InboxItem) {
    if (!item.outlook_conversation_id) {
      setMessage(
        "No Outlook conversation ID found. Create an Outlook draft first."
      );
      return;
    }

    setSavingId(item.id);
    setMessage("Checking Outlook Sent Items...");

    try {
      const response = await fetch("/api/ai/brain/check-outlook-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboxItemId: item.id }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to check Outlook sent status.");
        return;
      }

      if (!result.sent) {
        setMessage(result.message || "No matching sent email found yet.");
        return;
      }

      const sentMessage = result.sentMessage;
      const now = new Date().toISOString();

      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                email_status: "sent_manually",
                draft_status: "sent",
                sent_at: sentMessage?.sentDateTime || now,
                sent_detected_at: now,
                sent_detection_method: "outlook_sent_items_conversation_id",
                outlook_sent_message_id: sentMessage?.id || null,
                outlook_sent_web_link: sentMessage?.webLink || null,
              }
            : entry
        )
      );

      setMessage("Sent email detected in Outlook and workbench status updated.");
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Failed to check Outlook sent status."
      );
    } finally {
      setSavingId(null);
    }
  }

  async function archiveItem(item: InboxItem) {
    const reason = window.prompt(
      "Archive reason:",
      item.email_status === "sent_manually"
        ? "Email sent and item completed"
        : item.email_status === "outlook_draft_created"
        ? "Outlook draft created and item completed"
        : "No further work required"
    );

    if (reason === null) return;

    setSavingId(item.id);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inboxItemId: item.id,
          reason,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to archive item.");
        return;
      }

      setItems((current) => current.filter((entry) => entry.id !== item.id));

      const remaining = filteredItems.filter((entry) => entry.id !== item.id);
      setSelectedItemId(remaining[0]?.id || null);

      setMessage("Item archived with audit trail.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to archive item.");
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

      const remaining = filteredItems.filter((entry) => entry.id !== item.id);
      setSelectedItemId(remaining[0]?.id || null);

      setMessage("Item processed successfully.");
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Failed to process item."
      );
    } finally {
      setSavingId(null);
    }
  }

  function markNoReplyNeeded(item: InboxItem) {
    updateItem(item.id, "email_status", "no_reply_needed");
    updateItem(item.id, "final_decision", "no_action_required");
    setMessage("Marked as no reply needed. Click Process to finish or Archive.");
  }

  function markNeedsClinicalReview(item: InboxItem) {
    updateItem(item.id, "final_decision", "needs_clinical_review");
    updateItem(item.id, "email_status", "no_reply_needed");
    setMessage(
      "Marked as needing clinical review. Add notes, then process or archive."
    );
  }

  const aiCase = selectedItem?.ai_cases?.[0] || null;
  const latestDecision = aiCase?.ai_decisions?.[0] || null;
  const latestDecisionData = latestDecision?.decision || {};
  const missingInformation = latestDecisionData.missing_information || [];

  const confirmedMatch =
    selectedItem?.ai_patient_match_candidates?.find(
      (match) => match.status === "confirmed"
    ) || null;

  return (
    <main className="min-h-screen bg-slate-50 p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            AI Reception Workbench
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Review, match, draft, create Outlook drafts, check sent status and
            archive correspondence from one screen.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href="/ai-reception/upload"
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Upload correspondence
          </a>

          <a
            href="/ai-reception/inbox"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Classic inbox
          </a>
        </div>
      </div>

      {message ? (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Queue</h2>
            <p className="text-xs text-slate-500">
              {filteredItems.length} active item
              {filteredItems.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {filterOptions.map((option) => {
              const active = activeFilter === option.value;
              const count = counts[option.value];

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setActiveFilter(option.value);
                    setSelectedItemId(null);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {option.label} {count}
                </button>
              );
            })}
          </div>

          <div className="max-h-[calc(100vh-220px)] space-y-2 overflow-y-auto pr-1">
            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                No active queue items.
              </div>
            ) : (
              filteredItems.map((item) => {
                const active = selectedItem?.id === item.id;
                const itemAiCase = item.ai_cases?.[0];
                const itemConfirmedMatch =
                  item.ai_patient_match_candidates?.find(
                    (match) => match.status === "confirmed"
                  ) || null;
                const itemLatestDecision =
                  itemAiCase?.ai_decisions?.[0] || null;
                const itemDecisionData = itemLatestDecision?.decision || {};

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItemId(item.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : itemDecisionData.requires_clinical_review
                        ? "border-red-200 bg-red-50 text-slate-700 hover:bg-red-100"
                        : item.attachment_needs_ocr
                        ? "border-amber-200 bg-amber-50 text-slate-700 hover:bg-amber-100"
                        : itemDecisionData.missing_information?.length
                        ? "border-rose-200 bg-rose-50 text-slate-700 hover:bg-rose-100"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {getItemTitle(item)}
                        </p>
                        <p
                          className={`mt-1 truncate text-xs ${
                            active ? "text-slate-200" : "text-slate-500"
                          }`}
                        >
                          {itemDecisionData.operational_intent ||
                            item.category ||
                            "Uncategorised"}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          active
                            ? "bg-white/15 text-white"
                            : item.email_status === "sent_manually"
                            ? "bg-emerald-100 text-emerald-800"
                            : item.email_status === "outlook_draft_created"
                            ? "bg-blue-100 text-blue-800"
                            : itemDecisionData.requires_clinical_review
                            ? "bg-red-100 text-red-800"
                            : item.attachment_needs_ocr
                            ? "bg-amber-100 text-amber-800"
                            : itemDecisionData.missing_information?.length
                            ? "bg-rose-100 text-rose-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {getStatusLabel(item)}
                      </span>
                    </div>

                    <div
                      className={`mt-2 grid gap-1 text-xs ${
                        active ? "text-slate-200" : "text-slate-500"
                      }`}
                    >
                      <div>
                        Match:{" "}
                        {item.match_status ||
                          itemConfirmedMatch?.status ||
                          "not checked"}
                      </div>
                      <div>Risk: {itemAiCase?.risk_level || "unknown"}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {!selectedItem ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-sm text-slate-600">
              Select an item from the queue.
            </div>
          ) : (
            <>
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {getItemTitle(selectedItem)}
                  </h2>

                  <div className="mt-2 grid gap-1 text-sm text-slate-600">
                    <div>Status: {selectedItem.status || "unknown"}</div>
                    <div>
                      Email status: {selectedItem.email_status || "unknown"}
                    </div>
                    <div>
                      Category: {selectedItem.category || "Not classified yet"}
                    </div>
                    <div>
                      Patient: {selectedItem.patient_name || "Not detected yet"}
                    </div>
                    <div>
                      DOB: {selectedItem.patient_dob || "Not detected yet"}
                    </div>
                    {selectedItem.sender_email ? (
                      <div>Reply to: {selectedItem.sender_email}</div>
                    ) : null}
                    {selectedItem.attachment_extraction_status ? (
                      <div>
                        Attachment extraction:{" "}
                        {selectedItem.attachment_extraction_status}
                      </div>
                    ) : null}
                    {selectedItem.outlook_draft_created_at ? (
                      <div suppressHydrationWarning>
                        Outlook draft:{" "}
                        {formatDateTime(
                          selectedItem.outlook_draft_created_at,
                          hasMounted
                        )}
                      </div>
                    ) : null}
                    {selectedItem.sent_detected_at ? (
                      <div suppressHydrationWarning>
                        Sent detected:{" "}
                        {formatDateTime(
                          selectedItem.sent_detected_at,
                          hasMounted
                        )}
                      </div>
                    ) : null}
                    {selectedItem.sent_at ? (
                      <div suppressHydrationWarning>
                        Sent at:{" "}
                        {formatDateTime(selectedItem.sent_at, hasMounted)}
                      </div>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openDocument(selectedItem)}
                  disabled={
                    openingFileId === selectedItem.id || !selectedItem.file_path
                  }
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {openingFileId === selectedItem.id
                    ? "Opening..."
                    : "View document"}
                </button>
              </div>

              {selectedItem.attachment_needs_ocr ? (
                <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <p className="font-semibold">
                    PDF text may not have been extracted
                  </p>
                  <p className="mt-1">
                    This email has a PDF attachment, but very little text was
                    extracted. The AI may only be analysing the email body. OCR
                    may be needed for this item.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Patient name
                  </span>
                  <input
                    value={selectedItem.patient_name || ""}
                    onChange={(e) =>
                      updateItem(
                        selectedItem.id,
                        "patient_name",
                        e.target.value
                      )
                    }
                    className="mt-1 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-700">
                    Date of birth
                  </span>
                  <input
                    value={selectedItem.patient_dob || ""}
                    onChange={(e) =>
                      updateItem(
                        selectedItem.id,
                        "patient_dob",
                        e.target.value
                      )
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
                    value={selectedItem.category || "unknown"}
                    onChange={(e) =>
                      updateItem(selectedItem.id, "category", e.target.value)
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
                    value={selectedItem.final_decision || ""}
                    onChange={(e) =>
                      updateItem(
                        selectedItem.id,
                        "final_decision",
                        e.target.value
                      )
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
              </div>

              <label className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">
                  Summary
                </span>
                <textarea
                  value={selectedItem.summary || ""}
                  onChange={(e) =>
                    updateItem(selectedItem.id, "summary", e.target.value)
                  }
                  className="mt-1 min-h-24 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                />
              </label>

              <label className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">
                  Suggested action
                </span>
                <textarea
                  value={selectedItem.suggested_action || ""}
                  onChange={(e) =>
                    updateItem(
                      selectedItem.id,
                      "suggested_action",
                      e.target.value
                    )
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
                      <span className="font-medium">Operational intent:</span>{" "}
                      {latestDecisionData.operational_intent || "unknown"}
                    </div>

                    <div>
                      <span className="font-medium">Confidence:</span>{" "}
                      {aiCase.confidence ?? "—"}
                    </div>

                    <div>
                      <span className="font-medium">Safe to auto-draft:</span>{" "}
                      {latestDecisionData.safe_to_auto_draft ? "Yes" : "No"}
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

                  {missingInformation.length ? (
                    <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                      <p className="text-sm font-medium text-rose-800">
                        Missing information
                      </p>

                      <ul className="mt-2 list-disc pl-5 text-sm text-rose-700">
                        {missingInformation.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {latestDecisionData.requires_clinical_review ? (
                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-semibold text-red-800">
                        Clinical review required
                      </p>

                      <p className="mt-2 text-sm text-red-700">
                        The AI detected clinical risk or clinical
                        decision-making that should be reviewed by a clinician
                        before communication is sent.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No AI Brain analysis found for this item yet.
                </div>
              )}

              <div className="mt-5 rounded-3xl border border-purple-100 bg-purple-50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Patient Match
                    </h3>
                    <p className="text-xs text-purple-700">
                      Confirm whether this correspondence belongs to an existing
                      patient.
                    </p>
                  </div>

                  <RunPatientMatchButton inboxItemId={selectedItem.id} />
                </div>

                {confirmedMatch ? (
                  <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                    <p className="font-semibold">Confirmed patient match</p>
                    <p className="mt-1">
                      {confirmedMatch.patients?.full_name || "Unknown patient"}
                    </p>
                    <p>
                      DOB:{" "}
                      {confirmedMatch.patients?.date_of_birth || "Unknown"}
                    </p>
                    <p className="mt-3">
                      {confirmedMatch.match_reason || "Confirmed by user."}
                    </p>
                  </div>
                ) : null}

                {selectedItem.ai_patient_match_candidates?.length ? (
                  <div className="mt-4 space-y-3">
                    {selectedItem.ai_patient_match_candidates.map((match) => {
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
                                {match.patients?.full_name || "Unknown patient"}
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
                                  inboxItemId={selectedItem.id}
                                  matchCandidateId={match.id}
                                />
                              ) : null}
                            </div>
                          </div>

                          <p className="mt-3 text-slate-700">
                            {match.match_reason || "No reasoning saved."}
                          </p>
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

              <AuditTrailPanel inboxItemId={selectedItem.id} />
            </>
          )}
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {!selectedItem ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-sm text-slate-600">
              Select an item to edit the draft.
            </div>
          ) : (
            <>
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-slate-900">
                  Draft & Actions
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Generate, edit, create an Outlook draft, check sent status,
                  archive or process.
                </p>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => generateDraft(selectedItem)}
                  disabled={savingId === selectedItem.id}
                  className="rounded-2xl bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingId === selectedItem.id ? "Working..." : "Generate"}
                </button>

                <button
                  type="button"
                  onClick={() => saveDraftEdits(selectedItem)}
                  disabled={
                    savingId === selectedItem.id ||
                    (!selectedItem.draft_reply_subject &&
                      !selectedItem.draft_reply_body)
                  }
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>

                <button
                  type="button"
                  onClick={() => copyDraft(selectedItem)}
                  disabled={
                    !selectedItem.draft_reply_subject &&
                    !selectedItem.draft_reply_body
                  }
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copiedId === selectedItem.id ? "Copied" : "Copy"}
                </button>

                <button
                  type="button"
                  onClick={() => createOutlookDraft(selectedItem)}
                  disabled={
                    savingId === selectedItem.id ||
                    !selectedItem.sender_email ||
                    !selectedItem.draft_reply_body
                  }
                  className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedItem.email_status === "outlook_draft_created"
                    ? "Create again"
                    : "Outlook draft"}
                </button>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => checkOutlookSent(selectedItem)}
                  disabled={
                    savingId === selectedItem.id ||
                    !selectedItem.outlook_conversation_id ||
                    selectedItem.email_status === "sent_manually"
                  }
                  className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedItem.email_status === "sent_manually"
                    ? "Sent found"
                    : "Check sent"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const link =
                      selectedItem.outlook_sent_web_link ||
                      selectedItem.outlook_web_link;

                    if (link) {
                      window.open(link, "_blank", "noopener,noreferrer");
                    } else {
                      setMessage("No Outlook link found yet.");
                    }
                  }}
                  disabled={
                    !selectedItem.outlook_web_link &&
                    !selectedItem.outlook_sent_web_link
                  }
                  className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Open Outlook
                </button>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => archiveItem(selectedItem)}
                  disabled={savingId === selectedItem.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Archive
                </button>

                <button
                  type="button"
                  onClick={() => markNoReplyNeeded(selectedItem)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  No reply
                </button>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => markNeedsClinicalReview(selectedItem)}
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                >
                  Clinical review
                </button>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">
                  Email status
                </span>
                <select
                  value={selectedItem.email_status || "drafted"}
                  onChange={(e) =>
                    updateItem(selectedItem.id, "email_status", e.target.value)
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

              <label className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">
                  Draft subject
                </span>
                <input
                  value={selectedItem.draft_reply_subject || ""}
                  onChange={(e) =>
                    updateItem(
                      selectedItem.id,
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
                  value={selectedItem.draft_reply_body || ""}
                  onChange={(e) =>
                    updateItem(
                      selectedItem.id,
                      "draft_reply_body",
                      e.target.value
                    )
                  }
                  className="mt-1 min-h-72 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                />
              </label>

              <label className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">
                  Reception notes
                </span>
                <textarea
                  value={selectedItem.reception_notes || ""}
                  onChange={(e) =>
                    updateItem(
                      selectedItem.id,
                      "reception_notes",
                      e.target.value
                    )
                  }
                  className="mt-1 min-h-24 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-900"
                  placeholder="Add human review notes..."
                />
              </label>

              <button
                type="button"
                onClick={() => approveItem(selectedItem)}
                disabled={savingId === selectedItem.id}
                className="mt-5 w-full rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingId === selectedItem.id
                  ? "Processing..."
                  : "Mark as processed"}
              </button>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}