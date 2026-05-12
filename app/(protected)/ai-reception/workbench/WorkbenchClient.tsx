"use client";

import PraktikaReferrerMatchPanel from "@/components/ai/PraktikaReferrerMatchPanel";
import ArchiveCompletedReferralButton from "@/components/ai/ArchiveCompletedReferralButton";
import PraktikaReferralWorkflowSection from "@/components/ai/PraktikaReferralWorkflowSection";
import BulkArchiveInboxItemsButton from "@/components/ai/BulkArchiveInboxItemsButton";
import InboxItemAuditTrail from "@/components/ai/InboxItemAuditTrail";
import ClassificationV2Button from "@/components/ai/ClassificationV2Button";
import FileInboxItemToPraktikaButton from "@/components/ai/FileInboxItemToPraktikaButton";
import AutomationPreviewCard from "@/components/ai/AutomationPreviewCard";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import BulkSafeAutomationButton from "@/components/ai/BulkSafeAutomationButton";
import CreateNewPraktikaPatientFromInboxButton from "@/components/ai/CreateNewPraktikaPatientFromInboxButton";

type Attachment = {
  name?: string | null;
  size?: number | null;
  bucket?: string | null;
  imported?: boolean | null;
  content_type?: string | null;
  storage_path?: string | null;
  outlook_attachment_id?: string | null;
  text_extracted?: boolean | null;
  extracted_character_count?: number | null;
  extracted_text?: string | null;
  needs_ocr?: boolean | null;
  ocr_status?: string | null;
  ocr_text?: string | null;
  ocr_text_length?: number | null;
  ocr_error?: string | null;
  ocr_completed_at?: string | null;
  ocr_method?: string | null;
};

type InboxItem = {
  id: string;
  created_at?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  status?: string | null;
  category?: string | null;
  confidence?: number | null;
  extracted_text?: string | null;
  summary?: string | null;
  patient_name?: string | null;
  patient_dob?: string | null;
  suggested_action?: string | null;
  matched_patient_id?: string | null;
  match_status?: string | null;
  match_confidence?: number | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reception_notes?: string | null;
  final_decision?: string | null;
  source?: string | null;
  sender_email?: string | null;
  sender_name?: string | null;
  email_subject?: string | null;
  email_body?: string | null;
  draft_reply_subject?: string | null;
  draft_reply_body?: string | null;
  draft_status?: string | null;
  email_status?: string | null;
  sent_at?: string | null;
  patient_match_confidence?: number | null;
  patient_match_confirmed_at?: string | null;
  source_type?: string | null;
  source_email_provider?: string | null;
  source_email_message_id?: string | null;
  source_email_thread_id?: string | null;
  source_email_url?: string | null;
  subject?: string | null;
  body?: string | null;
  received_at?: string | null;
  raw_text?: string | null;
  attachment_debug?: any;
  attachment_extraction_status?: string | null;
  attachment_needs_ocr?: boolean | null;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
  outlook_draft_id?: string | null;
  outlook_message_id?: string | null;
  outlook_conversation_id?: string | null;
  outlook_web_link?: string | null;
  outlook_draft_created_at?: string | null;
  sent_detected_at?: string | null;
  sent_detection_method?: string | null;
  outlook_sent_message_id?: string | null;
  outlook_sent_web_link?: string | null;
  workbench_attachments?: Attachment[];
  ai_cases?: any[];
  latest_ai_case?: any;
  latest_ai_decision?: any;
  latest_decision?: any;
  ai_patient_match_candidates?: any[];
  ai_email_drafts?: any[];
  event_chain_status?: string | null;
  automation_pipeline_status?: string | null;

  // Provider / Trello routing fields
  assigned_clinician_key?: string | null;
  assigned_clinician_name?: string | null;
  clinician_routing_reason?: string | null;
  clinician_routing_confidence?: number | null;
  trello_board_id?: string | null;
  trello_list_id?: string | null;
  trello_card_id?: string | null;
  trello_card_url?: string | null;
  trello_auto_task_status?: string | null;
  trello_auto_task_reason?: string | null;
  trello_auto_task_error?: string | null;

  // Praktika patient matching fields
  extracted_patient_first_name?: string | null;
  extracted_patient_last_name?: string | null;
  extracted_patient_dob?: string | null;
  extracted_patient_mobile?: string | null;
  extracted_patient_email?: string | null;
  praktika_patient_id?: string | null;
  praktika_patient_number?: string | null;
  praktika_match_status?: string | null;
  praktika_match_confidence?: number | null;
  praktika_match_reason?: string | null;
  praktika_match_candidates?: any[] | null;
  praktika_match_confirmed_at?: string | null;
  praktika_matched_at?: string | null;

  // Praktika assisted filing fields
  praktika_filing_status?: string | null;
  praktika_filed_at?: string | null;
  praktika_filing_error?: string | null;
  praktika_filing_result?: any;
};

type Props = {
  initialItems: InboxItem[];
};

type QueueFilter =
  | "all"
  | "ready"
  | "needs_review"
  | "processing"
  | "missing_info"
  | "patient_match"
  | "clinical"
  | "archived";

type QueueSortMode = "urgency" | "newest";

type WorkflowReason = {
  key: string;
  label: string;
  description: string;
  tone: "green" | "amber" | "rose" | "red" | "blue" | "purple" | "slate";
  action: string;
};

type PraktikaSessionState = {
  status: "idle" | "running" | "mfa_required" | "success" | "error";
  message: string;
  currentUrl?: string;
  updatedAt?: string;
};

function praktikaSessionStatusLabel(status: PraktikaSessionState["status"]) {
  switch (status) {
    case "success":
      return "Connected";
    case "mfa_required":
      return "MFA required";
    case "running":
      return "Refreshing session";
    case "error":
      return "Connection failed";
    case "idle":
    default:
      return "Checking";
  }
}

type PraktikaMatchCandidate = {
  id?: string | number | null;
  patientNumber?: string | number | null;
  firstName?: string | null;
  lastName?: string | null;
  dob?: string | null;
  mobile?: string | null;
  email?: string | null;
  matchScore?: number | null;
  matchReason?: string | null;
};

function getPraktikaCandidateName(candidate: PraktikaMatchCandidate) {
  return (
    [candidate.firstName, candidate.lastName]
      .filter(Boolean)
      .join(" ")
      .trim() || "Unnamed patient"
  );
}

function getPraktikaCandidateId(candidate: PraktikaMatchCandidate) {
  return candidate.id === null || candidate.id === undefined
    ? ""
    : String(candidate.id);
}

function getPraktikaCandidateScore(candidate: PraktikaMatchCandidate) {
  return typeof candidate.matchScore === "number"
    ? `${Math.round(candidate.matchScore * 100)}%`
    : "Not scored";
}

function PraktikaMatchCandidatesPanel({
  inboxItemId,
  candidates,
  selectedPatientId,
  onConfirmed,
}: {
  inboxItemId: string;
  candidates?: PraktikaMatchCandidate[] | null;
  selectedPatientId?: string | null;
  onConfirmed: (item: InboxItem) => void;
}) {
  const [busyPatientId, setBusyPatientId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  if (safeCandidates.length === 0) {
    return null;
  }

  async function confirmCandidate(candidate: PraktikaMatchCandidate) {
    const patientId = getPraktikaCandidateId(candidate);

    if (!patientId) return;

    setBusyPatientId(patientId);
    setMessage("");

    try {
      const response = await fetch("/api/ai/brain/praktika/confirm-match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId,
          patientId,
          patientNumber: candidate.patientNumber || null,
          candidate,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.error || "Could not confirm Praktika patient match.",
        );
      }

      if (result?.item) {
        onConfirmed(result.item);
      }

      setMessage("Praktika patient match confirmed.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not confirm Praktika patient match.",
      );
    } finally {
      setBusyPatientId(null);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-4 text-purple-950">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-bold">Possible Praktika matches</p>
          <p className="mt-1 text-xs text-purple-800">
            If more than one patient could be correct, confirm the right one
            before filing attachments.
          </p>
        </div>

        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-purple-700">
          {safeCandidates.length} option{safeCandidates.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {safeCandidates.slice(0, 6).map((candidate, index) => {
          const patientId = getPraktikaCandidateId(candidate);
          const isSelected = Boolean(
            patientId &&
            selectedPatientId &&
            patientId === String(selectedPatientId),
          );

          return (
            <div
              key={`${patientId || "candidate"}-${index}`}
              className={`rounded-2xl border p-3 ${
                isSelected
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-purple-100 bg-white"
              }`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-950">
                    {getPraktikaCandidateName(candidate)}
                  </p>

                  <div className="mt-1 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                    <span>Patient ID: {patientId || "-"}</span>
                    <span>Patient #: {candidate.patientNumber || "-"}</span>
                    <span>DOB: {candidate.dob || "-"}</span>
                    <span>Mobile: {candidate.mobile || "-"}</span>
                    <span>Score: {getPraktikaCandidateScore(candidate)}</span>
                  </div>

                  {candidate.matchReason ? (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {candidate.matchReason}
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => confirmCandidate(candidate)}
                  disabled={
                    !patientId || busyPatientId === patientId || isSelected
                  }
                  className={`rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                    isSelected
                      ? "bg-emerald-600 text-white"
                      : "bg-purple-700 text-white hover:bg-purple-800"
                  }`}
                >
                  {isSelected
                    ? "Selected"
                    : busyPatientId === patientId
                      ? "Confirming..."
                      : "Use this patient"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {message ? (
        <p className="mt-3 text-xs font-medium text-purple-900">{message}</p>
      ) : null}
    </div>
  );
}

function PraktikaWorkbenchPanel({
  selectedItem,
  selectedAttachmentsCount,
  busy,
  onMatchPraktikaPatient,
  onRefreshWorkbenchItems,
}: {
  selectedItem: InboxItem | null;
  selectedAttachmentsCount: number;
  busy: string | null;
  onMatchPraktikaPatient: () => Promise<void>;
  onRefreshWorkbenchItems: () => Promise<void>;
}) {
  const [state, setState] = useState<PraktikaSessionState>({
    status: "idle",
    message: "Checking Praktika session...",
  });
  const [code, setCode] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);

  async function loadStatus() {
    try {
      const response = await fetch("/api/praktika/session/status", {
        cache: "no-store",
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error || "Could not check Praktika session.");
      }

      setState({
        status: result?.status || "idle",
        message: result?.message || "Praktika session status checked.",
        currentUrl: result?.currentUrl || undefined,
        updatedAt: result?.updatedAt || new Date().toISOString(),
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not check Praktika session.",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  useEffect(() => {
    loadStatus();

    const timer = window.setInterval(() => {
      loadStatus();
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  async function refreshSession() {
    setSessionBusy(true);

    try {
      setState((current) => ({
        ...current,
        status: "running",
        message: "Refreshing Praktika session...",
        updatedAt: new Date().toISOString(),
      }));

      await fetch("/api/praktika/session/refresh", {
        method: "POST",
      });

      await loadStatus();
    } finally {
      setSessionBusy(false);
    }
  }

  async function submitCode() {
    if (!code.trim()) return;

    setSessionBusy(true);

    try {
      await fetch("/api/praktika/session/mfa-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code: code.trim() }),
      });

      setCode("");
      await loadStatus();
    } finally {
      setSessionBusy(false);
    }
  }

  const tone =
    state.status === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state.status === "mfa_required"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : state.status === "error"
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-slate-200 bg-white text-slate-900";

  return (
    <section className={`mx-5 mt-4 rounded-3xl border p-4 shadow-sm ${tone}`}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">
            Praktika sync panel
          </div>

          <h2 className="mt-1 text-base font-bold">
            Session status: {praktikaSessionStatusLabel(state.status)}
          </h2>

          <p className="mt-1 max-w-3xl text-sm opacity-85">{state.message}</p>

          {state.updatedAt ? (
            <p className="mt-1 text-xs opacity-70">
              Last checked: {formatDate(state.updatedAt)}
            </p>
          ) : null}

          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-2xl border border-current/10 bg-white/50 p-3">
              <div className="font-semibold">Selected patient</div>
              <div className="mt-1 opacity-80">
                {selectedItem?.praktika_patient_id
                  ? `Praktika ID ${selectedItem.praktika_patient_id}`
                  : "No Praktika patient selected"}
              </div>
            </div>

            <div className="rounded-2xl border border-current/10 bg-white/50 p-3">
              <div className="font-semibold">Attachments</div>
              <div className="mt-1 opacity-80">
                {selectedAttachmentsCount} attachment
                {selectedAttachmentsCount === 1 ? "" : "s"} detected
              </div>
            </div>

            <div className="rounded-2xl border border-current/10 bg-white/50 p-3">
              <div className="font-semibold">Filing status</div>
              <div className="mt-1 opacity-80">
                {selectedItem?.praktika_filing_status || "Not filed yet"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <button
            type="button"
            onClick={refreshSession}
            disabled={sessionBusy || state.status === "running"}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {state.status === "running" || sessionBusy
              ? "Refreshing..."
              : "Refresh Praktika session"}
          </button>

          <button
            type="button"
            onClick={onMatchPraktikaPatient}
            disabled={!selectedItem || busy === "match-praktika-patient"}
            className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-800 hover:bg-purple-100 disabled:opacity-50"
          >
            {busy === "match-praktika-patient"
              ? "Matching..."
              : "Match selected patient"}
          </button>

          <button
            type="button"
            onClick={onRefreshWorkbenchItems}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh Workbench
          </button>
        </div>
      </div>

      {state.status === "mfa_required" ? (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-white/80 p-3">
          <label className="block">
            <div className="mb-1 text-xs font-semibold text-amber-900">
              Email MFA code
            </div>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Enter code from email"
              className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <button
            type="button"
            onClick={submitCode}
            disabled={sessionBusy || !code.trim()}
            className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Use this code
          </button>
        </div>
      ) : null}
    </section>
  );
}

function parseJsonMaybe(value: any) {
  if (!value) return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function normalise(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttachments(item: InboxItem): Attachment[] {
  if (Array.isArray(item.workbench_attachments)) {
    return item.workbench_attachments;
  }

  const parsed = parseJsonMaybe(item.attachment_debug);
  const imported = parsed?.imported_attachments;

  if (Array.isArray(imported)) {
    return imported;
  }

  if (item.file_path) {
    return [
      {
        name: item.file_name || "Document",
        size: null,
        bucket: "ai-reception",
        imported: true,
        content_type: "application/pdf",
        storage_path: item.file_path,
      },
    ];
  }

  return [];
}

function getLatestDecision(item: InboxItem) {
  if (item.latest_decision) return item.latest_decision;

  const latestFromCase = item.latest_ai_case?.latest_decision;
  if (latestFromCase) return latestFromCase;

  const cases = Array.isArray(item.ai_cases) ? item.ai_cases : [];
  const decisions = cases.flatMap((aiCase: any) =>
    Array.isArray(aiCase?.ai_decisions) ? aiCase.ai_decisions : [],
  );

  const latestDecisionRow =
    decisions
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime(),
      )[0] || null;

  return latestDecisionRow?.decision || null;
}

function getRisk(item: InboxItem) {
  const decision = getLatestDecision(item);
  return decision?.risk_level || item.latest_ai_case?.risk_level || "unknown";
}

function getMissingInfo(item: InboxItem): string[] {
  const decision = getLatestDecision(item);
  const missing = decision?.missing_information;

  return Array.isArray(missing) ? missing.filter(Boolean) : [];
}

function requiresClinicalReview(item: InboxItem) {
  const decision = getLatestDecision(item);
  return Boolean(decision?.requires_clinical_review);
}

function isSafeToDraft(item: InboxItem) {
  const decision = getLatestDecision(item);
  if (!decision) return true;
  return decision.safe_to_auto_draft !== false;
}

function hasDraft(item: InboxItem) {
  return Boolean(item.draft_reply_subject || item.draft_reply_body);
}

function isReady(item: InboxItem) {
  return (
    !item.archived_at &&
    item.attachment_needs_ocr !== true &&
    item.attachment_extraction_status !== "ocr_needed" &&
    item.email_status === "ready_to_send" &&
    hasDraft(item) &&
    getMissingInfo(item).length === 0 &&
    !requiresClinicalReview(item)
  );
}

function isProcessing(item: InboxItem) {
  return (
    item.status === "uploaded" ||
    item.status === "processing" ||
    item.attachment_needs_ocr === true ||
    item.attachment_extraction_status === "ocr_needed" ||
    item.attachment_extraction_status === "ocr_partially_completed"
  );
}

function missingInfoReasons(item: InboxItem): WorkflowReason[] {
  const missing = getMissingInfo(item);
  const reasons: WorkflowReason[] = [];

  for (const raw of missing) {
    const value = normalise(raw);

    if (
      value.includes("dob") ||
      value.includes("date of birth") ||
      value.includes("birth date")
    ) {
      reasons.push({
        key: "missing_dob",
        label: "Missing DOB",
        description:
          "Patient date of birth is needed before the file can be matched safely.",
        tone: "rose",
        action: "Ask the sender to confirm the patient's DOB.",
      });
      continue;
    }

    if (
      value.includes("referral reason") ||
      value.includes("reason for referral") ||
      value.includes("treatment reason") ||
      value.includes("clinical reason")
    ) {
      reasons.push({
        key: "missing_referral_reason",
        label: "Missing referral reason",
        description:
          "The correspondence does not clearly state what the patient is being referred for.",
        tone: "rose",
        action: "Ask the sender to confirm the reason for referral.",
      });
      continue;
    }

    if (
      value.includes("radiograph") ||
      value.includes("xray") ||
      value.includes("x ray") ||
      value.includes("opg") ||
      value.includes("pa")
    ) {
      reasons.push({
        key: "missing_radiograph",
        label: "Radiograph missing",
        description:
          "The referral appears to need an image or radiograph that was not available.",
        tone: "amber",
        action: "Ask the sender to provide the missing radiograph/image.",
      });
      continue;
    }

    if (
      value.includes("phone") ||
      value.includes("mobile") ||
      value.includes("contact")
    ) {
      reasons.push({
        key: "missing_contact",
        label: "Missing contact details",
        description: "Patient contact details are incomplete.",
        tone: "rose",
        action: "Ask the sender to confirm the patient's phone/email details.",
      });
      continue;
    }

    if (value.includes("patient name") || value.includes("name")) {
      reasons.push({
        key: "missing_patient_name",
        label: "Missing patient name",
        description: "Patient name was not confidently detected.",
        tone: "rose",
        action: "Ask the sender to confirm the patient name.",
      });
      continue;
    }

    if (
      value.includes("referrer") ||
      value.includes("provider") ||
      value.includes("dentist") ||
      value.includes("practitioner")
    ) {
      reasons.push({
        key: "missing_referrer",
        label: "Missing referrer details",
        description:
          "Referring practitioner or practice details are incomplete.",
        tone: "amber",
        action: "Confirm the referring provider details.",
      });
      continue;
    }

    reasons.push({
      key: `missing_${value.replace(/\s+/g, "_") || "info"}`,
      label: `Missing ${raw}`,
      description: raw,
      tone: "rose",
      action: "Review the correspondence and request the missing information.",
    });
  }

  return reasons;
}

function patientMatchReason(item: InboxItem): WorkflowReason | null {
  const status = item.match_status || "";

  if (
    status === "suggested" ||
    status === "multiple_matches" ||
    status === "possible_match"
  ) {
    return {
      key: "patient_match_suggested",
      label: "Confirm patient match",
      description:
        "AI found a possible patient match that needs staff confirmation.",
      tone: "purple",
      action: "Review the suggested patient match before proceeding.",
    };
  }

  if (!status || status === "not_checked" || status === "pending") {
    return {
      key: "patient_match_pending",
      label: "Patient match pending",
      description: "Patient matching has not completed yet.",
      tone: "amber",
      action: "Wait for matching or review manually.",
    };
  }

  return null;
}

function clinicalReason(item: InboxItem): WorkflowReason | null {
  if (!requiresClinicalReview(item)) return null;

  const decision = getLatestDecision(item);
  const risks = Array.isArray(decision?.risks) ? decision.risks : [];

  return {
    key: "clinical_review",
    label: "Clinical review required",
    description:
      risks.length > 0
        ? risks.join(", ")
        : "This item may involve clinical decision-making or a safety concern.",
    tone: "red",
    action: "Send to a clinician before replying.",
  };
}

function processingReason(item: InboxItem): WorkflowReason | null {
  if (!isProcessing(item)) return null;

  if (
    item.attachment_needs_ocr ||
    item.attachment_extraction_status === "ocr_needed"
  ) {
    return {
      key: "processing_ocr",
      label: "OCR processing",
      description: "One or more attachments still need OCR.",
      tone: "amber",
      action: "Wait for the OCR worker to finish.",
    };
  }

  if (item.attachment_extraction_status === "ocr_partially_completed") {
    return {
      key: "processing_ocr_partial",
      label: "OCR partially complete",
      description: "Some attachments are processed; others still need OCR.",
      tone: "amber",
      action: "Wait for the OCR worker to finish.",
    };
  }

  return {
    key: "processing",
    label: "Analysing referral",
    description: "The system is still processing this item.",
    tone: "amber",
    action: "Wait for processing to finish.",
  };
}

function readyReason(item: InboxItem): WorkflowReason | null {
  if (!isReady(item)) return null;

  return {
    key: "ready_to_send",
    label: "Ready to send",
    description: "Draft is ready for staff review and Outlook creation.",
    tone: "green",
    action: "Review the draft and create the Outlook draft.",
  };
}

function draftReason(item: InboxItem): WorkflowReason | null {
  if (!hasDraft(item)) return null;

  return {
    key: "draft_ready",
    label: "Draft ready",
    description: "A draft exists but the item still needs staff review.",
    tone: "blue",
    action: "Review the draft before sending.",
  };
}

function notSafeReason(item: InboxItem): WorkflowReason | null {
  if (isSafeToDraft(item)) return null;

  const decision = getLatestDecision(item);

  return {
    key: "not_safe_to_draft",
    label: "Not safe to auto-draft",
    description:
      decision?.explanation ||
      "AI Brain decided this item should not be auto-drafted yet.",
    tone: "red",
    action: "Review manually or send for clinical/admin review.",
  };
}

function getWorkflowReasons(item: InboxItem): WorkflowReason[] {
  const reasons: WorkflowReason[] = [];

  const processing = processingReason(item);
  if (processing) return [processing];

  const clinical = clinicalReason(item);
  if (clinical) reasons.push(clinical);

  reasons.push(...missingInfoReasons(item));

  const notSafe = notSafeReason(item);
  if (notSafe) reasons.push(notSafe);

  const match = patientMatchReason(item);
  if (
    match &&
    !["auto_confirmed", "confirmed"].includes(item.match_status || "")
  ) {
    reasons.push(match);
  }

  if (reasons.length > 0) return reasons;

  const ready = readyReason(item);
  if (ready) return [ready];

  const draft = draftReason(item);
  if (draft) return [draft];

  if (item.sent_at || item.email_status === "sent" || item.sent_detected_at) {
    return [
      {
        key: "sent",
        label: "Sent",
        description: "Reply has been sent.",
        tone: "green",
        action: "No action required.",
      },
    ];
  }

  return [
    {
      key: "review",
      label: "Needs review",
      description: "This item needs staff review.",
      tone: "slate",
      action: "Review the summary, attachments and draft.",
    },
  ];
}

function getPrimaryReason(item: InboxItem) {
  return getWorkflowReasons(item)[0];
}

function getWorkflowState(item: InboxItem) {
  const primary = getPrimaryReason(item);

  let priority = 6;
  if (primary.key.startsWith("processing")) priority = 1;
  else if (
    primary.key === "clinical_review" ||
    primary.key === "not_safe_to_draft"
  )
    priority = 2;
  else if (primary.key.startsWith("missing")) priority = 3;
  else if (
    primary.key.includes("patient_match") ||
    primary.key === "new_patient_file_needed"
  )
    priority = 4;
  else if (primary.key === "ready_to_send") priority = 5;
  else if (primary.key === "draft_ready") priority = 6;
  else if (primary.key === "sent") priority = 8;

  if (item.archived_at) {
    return {
      key: "archived",
      label: "Archived",
      badge: "Archived",
      description: "This item has been archived.",
      tone: "slate" as const,
      priority: 9,
      reasons: getWorkflowReasons(item),
    };
  }

  return {
    key: primary.key,
    label: primary.label,
    badge: primary.label,
    description: primary.description,
    tone: primary.tone,
    priority,
    reasons: getWorkflowReasons(item),
  };
}

function sortItems(items: InboxItem[], mode: QueueSortMode = "urgency") {
  return items.slice().sort((a, b) => {
    if (mode === "newest") {
      return (
        new Date(b.created_at || b.received_at || 0).getTime() -
        new Date(a.created_at || a.received_at || 0).getTime()
      );
    }

    const stateA = getWorkflowState(a);
    const stateB = getWorkflowState(b);

    if (stateA.priority !== stateB.priority) {
      return stateA.priority - stateB.priority;
    }

    return (
      new Date(b.created_at || b.received_at || 0).getTime() -
      new Date(a.created_at || a.received_at || 0).getTime()
    );
  });
}

function formatFileSize(size?: number | null) {
  if (!size) return "Size unknown";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown";

  try {
    return new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function toneClasses(tone: string, selected = false) {
  if (selected) return "border-slate-900 bg-slate-950 text-white";

  switch (tone) {
    case "green":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "amber":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "rose":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "red":
      return "border-red-200 bg-red-50 text-red-900";
    case "blue":
      return "border-blue-200 bg-blue-50 text-blue-900";
    case "purple":
      return "border-purple-200 bg-purple-50 text-purple-900";
    default:
      return "border-slate-200 bg-white text-slate-900";
  }
}

function badgeClasses(tone: string, selected = false) {
  if (selected) return "bg-white/15 text-white";

  switch (tone) {
    case "green":
      return "bg-emerald-100 text-emerald-700";
    case "amber":
      return "bg-amber-100 text-amber-700";
    case "rose":
      return "bg-rose-100 text-rose-700";
    case "red":
      return "bg-red-100 text-red-700";
    case "blue":
      return "bg-blue-100 text-blue-700";
    case "purple":
      return "bg-purple-100 text-purple-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function attachmentKind(attachment: Attachment) {
  const type = attachment.content_type?.toLowerCase() || "";
  const name = attachment.name?.toLowerCase() || "";

  if (type.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name))
    return "Image";

  return "File";
}

function attachmentStatusLabel(attachment: Attachment) {
  if (attachment.ocr_status === "completed") return "Text extracted";
  if (attachment.ocr_status === "completed_no_readable_text")
    return "No readable text";
  if (attachment.needs_ocr || attachment.ocr_status === "needed")
    return "Processing";
  if (attachment.text_extracted) return "Text extracted";
  if (
    attachment.ocr_status === "failed" ||
    attachment.ocr_status === "failed_unreadable"
  )
    return "Needs review";

  return "";
}

function primaryDisplayName(item: InboxItem) {
  return (
    item.patient_name ||
    item.file_name ||
    item.email_subject ||
    item.subject ||
    "Unknown correspondence"
  );
}

function praktikaMatchStatusLabel(status?: string | null) {
  switch (status) {
    case "matched_existing":
      return "Matched existing patient";
    case "confirmed_manual":
      return "Confirmed by staff";
    case "possible_match":
      return "Possible patient match";
    case "no_match":
      return "No match found";
    case "insufficient_information":
      return "Insufficient information";
    default:
      return "Not checked yet";
  }
}

function praktikaMatchTone(status?: string | null) {
  switch (status) {
    case "matched_existing":
    case "confirmed_manual":
      return "green";
    case "possible_match":
      return "amber";
    case "no_match":
      return "purple";
    case "insufficient_information":
      return "rose";
    default:
      return "slate";
  }
}

function getInboxItemSearchText(item: InboxItem) {
  return [
    item.patient_name,
    item.extracted_patient_first_name,
    item.extracted_patient_last_name,
    item.extracted_patient_dob,
    item.praktika_patient_id,
    item.praktika_patient_number,
    item.file_name,
    item.email_subject,
    item.subject,
    item.sender_name,
    item.sender_email,
    item.summary,
    item.suggested_action,
    item.archive_reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterItems(
  items: InboxItem[],
  filter: QueueFilter,
  archivedSearch = "",
) {
  const search = archivedSearch.trim().toLowerCase();

  if (filter === "archived") {
    const archivedItems = items.filter((item) => Boolean(item.archived_at));

    if (!search) return archivedItems;

    return archivedItems.filter((item) =>
      getInboxItemSearchText(item).includes(search),
    );
  }

  const activeItems = items.filter((item) => !item.archived_at);

  if (filter === "all") return activeItems;

  return activeItems.filter((item) => {
    const state = getWorkflowState(item);

    if (filter === "ready")
      return state.key === "ready_to_send" || state.key === "draft_ready";

    if (filter === "needs_review")
      return !["ready_to_send", "draft_ready", "sent", "archived"].includes(
        state.key,
      );

    if (filter === "processing") return state.key.startsWith("processing");

    if (filter === "missing_info")
      return (
        state.key.startsWith("missing") || state.key === "not_safe_to_draft"
      );

    if (filter === "patient_match")
      return (
        state.key.includes("patient_match") ||
        state.key === "new_patient_file_needed"
      );

    if (filter === "clinical") return state.key === "clinical_review";

    return true;
  });
}
export default function WorkbenchClient({ initialItems }: Props) {
  const [items, setItems] = useState<InboxItem[]>(initialItems || []);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems?.[0]?.id || null,
  );
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [sortMode, setSortMode] = useState<QueueSortMode>("urgency");
  const [archivedSearch, setArchivedSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [showExtractedText, setShowExtractedText] = useState(false);
  const [localDraftSubject, setLocalDraftSubject] = useState("");
  const [localDraftBody, setLocalDraftBody] = useState("");
  const [selectedInboxItemIds, setSelectedInboxItemIds] = useState<string[]>(
    [],
  );

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("ai-inbox-items-workbench")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ai_inbox_items",
        },
        (payload) => {
          const newRow = payload.new as InboxItem | null;
          const oldRow = payload.old as InboxItem | null;

          setItems((current) => {
            if (payload.eventType === "DELETE" && oldRow?.id) {
              return current.filter((item) => item.id !== oldRow.id);
            }

            if (!newRow?.id) return current;

            const exists = current.some((item) => item.id === newRow.id);

            if (exists) {
              return current.map((item) =>
                item.id === newRow.id ? { ...item, ...newRow } : item,
              );
            }

            return [newRow, ...current];
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const sortedItems = useMemo(
    () => sortItems(items, sortMode),
    [items, sortMode],
  );

  const selectedItem =
    sortedItems.find((item) => item.id === selectedId) ||
    sortedItems[0] ||
    null;

  const selectedDecision = selectedItem
    ? getLatestDecision(selectedItem)
    : null;
  const selectedAttachments = selectedItem ? getAttachments(selectedItem) : [];

  const selectedState = selectedItem
    ? getWorkflowState(selectedItem)
    : {
        key: "none",
        label: "No item selected",
        badge: "None",
        description: "",
        tone: "slate" as const,
        priority: 99,
        reasons: [],
      };

  const draftSubject =
    localDraftSubject ||
    selectedItem?.draft_reply_subject ||
    selectedItem?.ai_email_drafts?.[0]?.subject ||
    "";

  const draftBody =
    localDraftBody ||
    selectedItem?.draft_reply_body ||
    selectedItem?.ai_email_drafts?.[0]?.body ||
    "";

  const visibleItems = useMemo(
    () => filterItems(sortedItems, filter, archivedSearch),
    [sortedItems, filter, archivedSearch],
  );

  const counts = useMemo(() => {
    const active = items.filter((item) => !item.archived_at);

    return {
      all: active.length,
      needsReview: active.filter(
        (item) =>
          !["ready_to_send", "draft_ready", "sent", "archived"].includes(
            getWorkflowState(item).key,
          ),
      ).length,
      ready: active.filter((item) =>
        ["ready_to_send", "draft_ready"].includes(getWorkflowState(item).key),
      ).length,
      processing: active.filter((item) =>
        getWorkflowState(item).key.startsWith("processing"),
      ).length,
      missing: active.filter(
        (item) =>
          getWorkflowState(item).key.startsWith("missing") ||
          getWorkflowState(item).key === "not_safe_to_draft",
      ).length,
      patientMatch: active.filter(
        (item) =>
          getWorkflowState(item).key.includes("patient_match") ||
          getWorkflowState(item).key === "new_patient_file_needed",
      ).length,
      clinical: active.filter(
        (item) => getWorkflowState(item).key === "clinical_review",
      ).length,
      archived: items.filter((item) => item.archived_at).length,
    };
  }, [items]);

  function updateSelectedItem(updated: Partial<InboxItem>) {
    if (!selectedItem) return;

    setItems((current) =>
      current.map((item) =>
        item.id === selectedItem.id ? { ...item, ...updated } : item,
      ),
    );
  }

  function isInboxItemSelected(id: string) {
    return selectedInboxItemIds.includes(id);
  }

  function toggleInboxItemSelected(id: string) {
    setSelectedInboxItemIds((current) =>
      current.includes(id)
        ? current.filter((itemId) => itemId !== id)
        : [...current, id],
    );
  }

  function clearSelectedInboxItems() {
    setSelectedInboxItemIds([]);
  }

  // WorkbenchClient.tsx patch
  // This fixes new imported rows not appearing until manual refresh.
  // Add these helpers INSIDE WorkbenchClient, near replaceItem/updateSelectedItem.

  function mergeItemsById(nextItems: InboxItem[]) {
    setItems((current) => {
      const byId = new Map<string, InboxItem>();

      for (const item of current) {
        byId.set(item.id, item);
      }

      for (const item of nextItems) {
        const existing = byId.get(item.id);
        byId.set(item.id, existing ? { ...existing, ...item } : item);
      }

      return Array.from(byId.values()).sort(
        (a, b) =>
          new Date(b.created_at || b.received_at || 0).getTime() -
          new Date(a.created_at || a.received_at || 0).getTime(),
      );
    });
  }

  async function refreshWorkbenchItems({ silent = true } = {}) {
    try {
      const response = await fetch(
        "/api/ai/brain/workbench-items?limit=75&includeArchived=true",
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not refresh Workbench items.");
      }

      if (Array.isArray(result.items)) {
        mergeItemsById(result.items);
      }
    } catch (error) {
      if (!silent) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not refresh Workbench items.",
        );
      }
    }
  }

  // Optional polling only while processing items exist.
  // Add this useEffect after your realtime useEffect.

  useEffect(() => {
    const hasProcessingItems = items.some(
      (item) =>
        item.event_chain_status === "queued" ||
        item.event_chain_status === "running" ||
        item.automation_pipeline_status === "queued" ||
        item.automation_pipeline_status === "running" ||
        item.automation_pipeline_status === "ocr_in_progress" ||
        item.attachment_extraction_status === "processing_attachments" ||
        item.attachment_extraction_status === "ocr_needed" ||
        item.attachment_extraction_status === "ocr_partially_completed",
    );

    if (!hasProcessingItems) return;

    const interval = window.setInterval(() => {
      refreshWorkbenchItems({ silent: true });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [items]);

  function replaceItem(updatedItem: InboxItem) {
    setItems((current) =>
      current.map((item) =>
        item.id === updatedItem.id ? { ...item, ...updatedItem } : item,
      ),
    );
  }

  async function openAttachment(attachment: Attachment) {
    if (!attachment.storage_path) {
      setMessage("Attachment storage path is missing.");
      return;
    }

    try {
      setMessage("");
      setBusy(`open-${attachment.storage_path}`);

      const response = await fetch("/api/ai-reception/get-file-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filePath: attachment.storage_path,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not open attachment.");
        return;
      }

      if (!result.url) {
        setMessage("No file URL returned.");
        return;
      }

      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not open attachment.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function createOutlookDraft() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("create-outlook-draft");

      const response = await fetch("/api/ai/brain/create-outlook-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not create Outlook draft.");
        return;
      }

      if (result.item) {
        replaceItem(result.item);
      } else {
        updateSelectedItem({
          email_status: "outlook_draft_created",
          outlook_draft_id: result.outlook_draft_id || result.draft?.id || null,
          outlook_web_link: result.outlook_web_link || result.webLink || null,
        });
      }

      setMessage("Outlook draft created.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create Outlook draft.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendOutlookDraft() {
    if (!selectedItem) return;

    const confirmed = window.confirm(
      "Send this Outlook draft now? This will send the email from the shared mailbox.",
    );

    if (!confirmed) return;

    try {
      setMessage("");
      setBusy("send-outlook-draft");

      const response = await fetch("/api/ai/brain/send-outlook-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error || "Could not send Outlook draft.");
      }

      if (result?.item) {
        replaceItem(result.item);
      } else {
        updateSelectedItem({
          email_status: "sent",
          sent_at: new Date().toISOString(),
          sent_detected_at: new Date().toISOString(),
          sent_detection_method: "manual_send_button",
        });
      }

      setMessage("Outlook draft sent.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not send Outlook draft.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function generateDraft() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("generate-draft");

      const response = await fetch("/api/ai/brain/reanalyse-item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
          regenerateDraft: true,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not generate draft.");
        return;
      }

      if (result.item) {
        replaceItem(result.item);
      }

      setLocalDraftSubject("");
      setLocalDraftBody("");
      setMessage("AI Brain re-analysed this item.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not generate draft.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("save-draft");

      const response = await fetch("/api/ai/brain/save-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
          subject: draftSubject,
          body: draftBody,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not save draft.");
        return;
      }

      if (result.item) {
        replaceItem(result.item);
      } else {
        updateSelectedItem({
          draft_reply_subject: draftSubject,
          draft_reply_body: draftBody,
          draft_status: "drafted",
        });
      }

      setMessage("Draft saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save draft.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveReview() {
  if (!selectedItem) return;

  try {
    setMessage("");
    setBusy("save-review");

    const response = await fetch("/api/ai/brain/save-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        inboxItemId: selectedItem.id,

        patient_name: selectedItem.patient_name || null,
        patient_dob: selectedItem.patient_dob || null,
        category: selectedItem.category || null,
        summary: selectedItem.summary || null,
        suggested_action: selectedItem.suggested_action || null,
        reception_notes: selectedItem.reception_notes || null,

        final_decision: "reviewed_and_approved",
        email_status: "reviewed",

        final_subject: draftSubject,
        final_body: draftBody,
        draft_reply_subject: draftSubject,
        draft_reply_body: draftBody,
        subject: draftSubject,
        body: draftBody,
      }),
    });

    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.success) {
      setMessage(result?.error || "Could not save review.");
      return;
    }

    if (result.item) {
      replaceItem(result.item);
    } else {
      updateSelectedItem({
        draft_reply_subject: draftSubject,
        draft_reply_body: draftBody,
        draft_status: "drafted",
        email_status: "reviewed",
        reviewed_at: new Date().toISOString(),
      });
    }

    const learning = result.learning;
    const learningParts: string[] = [];

    if (learning?.feedback_saved) learningParts.push("feedback saved");
    if (learning?.approved_example_created) {
      learningParts.push("approved example created");
    }
    if (learning?.template_created) learningParts.push("template created");
    if (learning?.learning_rule_created) learningParts.push("rule created");
    if (learning?.training_queue_created) {
      learningParts.push("training queue updated");
    }

    setLocalDraftSubject("");
    setLocalDraftBody("");

    setMessage(
      learningParts.length
        ? `Review saved and AI learning updated: ${learningParts.join(", ")}.`
        : "Review saved.",
    );
  } catch (error) {
    setMessage(
      error instanceof Error ? error.message : "Could not save review.",
    );
  } finally {
    setBusy(null);
  }
}

  async function markNoReply() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("no-reply");

      const response = await fetch("/api/ai/brain/mark-no-reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not mark no reply.");
        return;
      }

      if (result.item) {
        replaceItem(result.item);
      } else {
        updateSelectedItem({
          email_status: "no_reply_needed",
        });
      }

      setMessage("Marked as no reply needed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not mark no reply.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function archiveItem() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("archive");

      const response = await fetch("/api/ai/workbench/archive-bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemIds: [selectedItem.id],
          reason: "Archived from staff Workbench",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not archive item.");
        return;
      }

      if (Array.isArray(result.items) && result.items.length > 0) {
        replaceItem(result.items[0]);
      } else {
        updateSelectedItem({
          archived_at: new Date().toISOString(),
          status: "archived",
        });
      }

      await refreshWorkbenchItems({ silent: true });
      setMessage(result.message || "Item archived in Workbench and Outlook.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not archive item.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function sendClinicalReview() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("clinical-review");

      const response = await fetch("/api/ai/brain/mark-clinical-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
          reason: "Marked for clinical review from the AI Reception Workbench.",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not mark for clinical review.");
        return;
      }

      if (result.item) {
        replaceItem(result.item);
      }

      setMessage("Marked for clinical review.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not mark for clinical review.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function runManualOcr(attachment: Attachment) {
    if (!selectedItem || !attachment.storage_path) return;

    try {
      setMessage("");
      setBusy(`ocr-${attachment.storage_path}`);

      const response = await fetch("/api/ai/brain/run-attachment-ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
          storagePath: attachment.storage_path,
          reanalyseAfterOcr: true,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not run OCR.");
        return;
      }

      if (result.item) {
        replaceItem(result.item);
      }

      setMessage(result.message || "OCR completed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not run OCR.");
    } finally {
      setBusy(null);
    }
  }

  async function runPendingOcrWorker() {
    try {
      setMessage("");
      setBusy("pending-ocr");

      const response = await fetch("/api/ai/brain/auto-run-pending-ocr", {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Pending OCR worker failed.");
        return;
      }

      setMessage(
        result.processed
          ? `Processed OCR for ${result.attachment_name || "one attachment"}.`
          : result.message || "No pending OCR attachments found.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Pending OCR worker failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function checkSent() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("check-sent");

      const response = await fetch("/api/ai/brain/check-outlook-sent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Could not check sent status.");
        return;
      }

      if (result.item) {
        replaceItem(result.item);
      }

      setMessage(result.message || "Sent status checked.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not check sent status.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function createManualTrelloTask() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("create-trello-task");

      const response = await fetch("/api/ai/brain/create-trello-task", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
          force: true,
          reason: "Created manually from AI Reception Workbench.",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not create Trello task.");
      }

      if (result.item) {
        replaceItem(result.item);
      } else {
        updateSelectedItem({
          trello_card_id: result.trello_card_id || null,
          trello_card_url: result.trello_card_url || null,
          trello_auto_task_status: result.skipped ? "skipped" : "created",
          trello_auto_task_reason:
            result.reason ||
            result.message ||
            "Manual Trello task action completed.",
          trello_auto_task_error: null,
        });
      }

      setMessage(
        result.skipped
          ? result.reason || "Trello task was skipped."
          : "Trello task created.",
      );

      await refreshWorkbenchItems({ silent: true });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create Trello task.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function matchPraktikaPatient() {
    if (!selectedItem) return;

    try {
      setMessage("");
      setBusy("match-praktika-patient");

      const response = await fetch("/api/ai/brain/praktika/match-patient", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inboxItemId: selectedItem.id,
        }),
      });

      const text = await response.text();

      let parsed: any = null;

      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          `Praktika patient match did not return JSON. Status ${response.status}. Response starts with: ${text.slice(
            0,
            200,
          )}`,
        );
      }

      if (!response.ok) {
        throw new Error(parsed.error || "Could not match Praktika patient.");
      }

      const result = parsed.result || {};
      const extracted = result.extracted || {};
      const bestMatch = result.bestMatch || null;
      const candidates = Array.isArray(result.matches) ? result.matches : [];

      updateSelectedItem({
        extracted_patient_first_name: extracted.firstName || null,
        extracted_patient_last_name: extracted.lastName || null,
        extracted_patient_dob: extracted.dob || null,
        extracted_patient_mobile: extracted.mobile || null,
        extracted_patient_email: extracted.email || null,
        praktika_patient_id: bestMatch?.id ? String(bestMatch.id) : null,
        praktika_patient_number: bestMatch?.patientNumber
          ? String(bestMatch.patientNumber)
          : null,
        praktika_match_status: result.status || null,
        praktika_match_confidence:
          typeof result.confidence === "number" ? result.confidence : null,
        praktika_match_reason: result.reason || null,
        praktika_match_candidates: candidates,
        praktika_matched_at: new Date().toISOString(),
      });

      setMessage(
        result.status === "matched_existing"
          ? `Matched Praktika patient ${bestMatch?.id || ""}.`
          : result.reason || "Praktika patient match completed.",
      );

      await refreshWorkbenchItems({ silent: true });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not match Praktika patient.",
      );
    } finally {
      setBusy(null);
    }
  }

  // WorkbenchClient.tsx patch
  //
  // Find your existing import Outlook handler. It may be called something like:
  // - importOutlookInbox
  // - handleImportOutlookInbox
  // - handleImportEmails
  //
  // Replace the fetch body with this pattern:

  // Replace your handleImportOutlookInbox function with this version.

  async function handleImportOutlookInbox() {
    setBusy("import-outlook");
    setMessage("Importing Outlook emails…");

    try {
      const response = await fetch("/api/ai/brain/import-outlook-inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          limit: 10,
          runEventChainInline: false,
          kickBackground: true,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Import failed.");
      }

      if (result.imported_count > 0) {
        setMessage(
          `Imported ${result.imported_count} email(s). Processing is starting in the background…`,
        );

        const kickResponse = await fetch(
          "/api/ai/brain/kick-background-processing",
          {
            method: "POST",
          },
        );

        const kickResult = await kickResponse.json().catch(() => ({}));

        if (!kickResponse.ok) {
          setMessage(
            `Imported ${result.imported_count} email(s), but background processing did not start: ${
              kickResult.error || "Unknown error"
            }`,
          );
          return;
        }

        setMessage(
          `Imported ${result.imported_count} email(s). Background OCR/AI/Trello processing is running.`,
        );
        await refreshWorkbenchItems({ silent: true });

        window.setTimeout(() => {
          refreshWorkbenchItems({ silent: true });
        }, 2000);
      } else {
        setMessage("No new Outlook emails found.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  async function searchArchivedItems() {
    try {
      setMessage("");
      setBusy("search-archived");

      const params = new URLSearchParams({
        limit: "100",
        includeArchived: "true",
        status: "archived",
      });

      if (archivedSearch.trim()) {
        params.set("q", archivedSearch.trim());
      }

      const response = await fetch(
        `/api/ai/brain/workbench-items?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.error || "Could not search archived items.");
      }

      if (Array.isArray(result?.items)) {
        mergeItemsById(result.items);
      }

      setFilter("archived");
      setMessage(
        `Archived search loaded ${Array.isArray(result?.items) ? result.items.length : 0} item(s).`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not search archived items.",
      );
    } finally {
      setBusy(null);
    }
  }

  function selectItem(item: InboxItem) {
    setSelectedId(item.id);
    setLocalDraftSubject("");
    setLocalDraftBody("");
    setShowExtractedText(false);
    setShowAudit(false);
    setShowAuditTrail(false);
  }

  if (!selectedItem) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
        <h1 className="text-2xl font-bold">AI Reception Workbench</h1>
        <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6">
          No inbox items found.
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            AI Reception Workbench
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Staff queue for referral review, draft approval and correspondence
            completion.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((current) => !current)}
          className="rounded-full border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {showAdvanced ? "Hide advanced" : "Advanced"}
        </button>
      </div>

      {message ? (
        <div className="mx-5 mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {message}
        </div>
      ) : null}

      <PraktikaWorkbenchPanel
        selectedItem={selectedItem}
        selectedAttachmentsCount={selectedAttachments.length}
        busy={busy}
        onMatchPraktikaPatient={matchPraktikaPatient}
        onRefreshWorkbenchItems={async () => {
          await refreshWorkbenchItems({ silent: false });
          setMessage("Workbench refreshed.");
        }}
      />

      {showAdvanced ? (
        <section className="mx-5 mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Advanced tools
              </h2>
              <p className="text-xs text-slate-500">
                Admin/debug actions hidden from the normal staff workflow.
              </p>
            </div>

            <button
              type="button"
              onClick={handleImportOutlookInbox}
              disabled={busy === "import-outlook"}
              className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Import Outlook inbox
            </button>

            <button
              type="button"
              onClick={runPendingOcrWorker}
              disabled={busy === "pending-ocr"}
              className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              Run pending OCR worker
            </button>

            <button
              type="button"
              onClick={generateDraft}
              disabled={busy === "generate-draft"}
              className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              Re-analyse item
            </button>

            <ClassificationV2Button
              inboxItemId={selectedItem.id}
              onComplete={async () => {
                await refreshWorkbenchItems({ silent: true });
                setMessage("Classification V2 completed.");
              }}
            />

            <button
              type="button"
              onClick={checkSent}
              disabled={busy === "check-sent"}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              Check sent
            </button>

            <a
              href="/ai-reception/provider-trello-settings"
              className="rounded-full border border-purple-200 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100"
            >
              Provider Trello settings
            </a>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)_460px]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-base font-bold text-slate-900">Queue</h2>
            <p className="text-sm text-slate-500">
              {filter === "archived"
                ? `${counts.archived} archived item${counts.archived === 1 ? "" : "s"}`
                : `${counts.all} active item${counts.all === 1 ? "" : "s"}`}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "all"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              All {counts.all}
            </button>

            <button
              type="button"
              onClick={() => setFilter("needs_review")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "needs_review"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Needs review {counts.needsReview}
            </button>

            <button
              type="button"
              onClick={() => setFilter("ready")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "ready"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Ready {counts.ready}
            </button>

            <button
              type="button"
              onClick={() => setFilter("processing")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "processing"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Processing {counts.processing}
            </button>

            <button
              type="button"
              onClick={() => setFilter("missing_info")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "missing_info"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Missing info {counts.missing}
            </button>

            <button
              type="button"
              onClick={() => setFilter("patient_match")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "patient_match"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Patient match {counts.patientMatch}
            </button>

            <button
              type="button"
              onClick={() => setFilter("clinical")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "clinical"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Clinical {counts.clinical}
            </button>

            <button
              type="button"
              onClick={() => setFilter("archived")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === "archived"
                  ? "bg-slate-950 text-white"
                  : "border border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              Archived {counts.archived}
            </button>
          </div>

          {filter === "archived" ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
              <label className="text-xs font-semibold text-amber-900">
                Search archived items
              </label>

              <div className="mt-2 flex gap-2">
                <input
                  value={archivedSearch}
                  onChange={(event) => setArchivedSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      searchArchivedItems();
                    }
                  }}
                  placeholder="Search patient, sender, subject, patient number..."
                  className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-4 focus:ring-amber-100"
                />

                <button
                  type="button"
                  onClick={searchArchivedItems}
                  disabled={busy === "search-archived"}
                  className="rounded-xl bg-amber-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {busy === "search-archived" ? "Searching..." : "Search"}
                </button>
              </div>

              {archivedSearch ? (
                <button
                  type="button"
                  onClick={() => setArchivedSearch("")}
                  className="mt-2 text-xs font-medium text-amber-800 hover:text-amber-950"
                >
                  Clear archived search
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <span className="px-1 py-1.5 text-xs font-medium text-slate-500">
              Sort:
            </span>

            <button
              type="button"
              onClick={() => setSortMode("urgency")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                sortMode === "urgency"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Urgency order
            </button>

            <button
              type="button"
              onClick={() => setSortMode("newest")}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                sortMode === "newest"
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              Newest first
            </button>
          </div>

<div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="text-xs text-slate-600">
      {selectedInboxItemIds.length > 0
        ? `${selectedInboxItemIds.length} selected`
        : "Select multiple items to archive them in Workbench and Outlook."}
    </div>

    <div className="flex flex-wrap gap-2">
      {selectedInboxItemIds.length > 0 ? (
        <button
          type="button"
          onClick={clearSelectedInboxItems}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Clear
        </button>
      ) : null}

      <BulkArchiveInboxItemsButton
        selectedIds={selectedInboxItemIds}
        onArchived={async () => {
          clearSelectedInboxItems();
          await refreshWorkbenchItems({ silent: false });
          setMessage("Selected items archived in Workbench and Outlook.");
        }}
      />
    </div>
  </div>
</div>

<div className="mt-3">
  <BulkSafeAutomationButton
    onComplete={async () => {
      await refreshWorkbenchItems({ silent: true });
      setMessage("Bulk safe automation completed.");
    }}
  />
</div>
          <div className="mt-4 max-h-[calc(100vh-250px)] space-y-3 overflow-y-auto pr-1">
            {visibleItems.map((item) => {
              const state = getWorkflowState(item);
              const selected = item.id === selectedItem.id;
              const risk = getRisk(item);

              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 transition hover:shadow-sm ${toneClasses(
                    state.tone,
                    selected,
                  )}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isInboxItemSelected(item.id)}
                      onChange={() => toggleInboxItemSelected(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                      aria-label={`Select ${primaryDisplayName(item)}`}
                    />

                    <button
                      type="button"
                      onClick={() => selectItem(item)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">
                            {primaryDisplayName(item)}
                          </p>
                          <p
                            className={`mt-1 text-xs ${
                              selected ? "text-white/70" : "text-slate-500"
                            }`}
                          >
                            {item.category || "uncategorised"}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badgeClasses(
                            state.tone,
                            selected,
                          )}`}
                        >
                          {state.badge}
                        </span>
                      </div>

                      <div
                        className={`mt-3 space-y-1 text-xs ${
                          selected ? "text-white/75" : "text-slate-500"
                        }`}
                      >
                        <p>Action: {state.reasons[0]?.action || "Review"}</p>
                        <p>Risk: {risk}</p>
                        <p>{formatDate(item.received_at || item.created_at)}</p>
                      </div>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-950">
                  {primaryDisplayName(selectedItem)}
                </h2>

                <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                  <p>
                    <span className="font-medium text-slate-800">
                      Workflow:
                    </span>{" "}
                    {selectedState.label}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">
                      Category:
                    </span>{" "}
                    {selectedItem.category || "Unknown"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">Patient:</span>{" "}
                    {selectedItem.patient_name || "Not detected yet"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">DOB:</span>{" "}
                    {selectedItem.patient_dob || "Not detected yet"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">
                      Reply to:
                    </span>{" "}
                    {selectedItem.sender_email || "Unknown"}
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">
                      Attachments:
                    </span>{" "}
                    {selectedItem.attachment_extraction_status || "not_checked"}
                  </p>
                </div>
              </div>

              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${toneClasses(
                  selectedState.tone,
                )}`}
              >
                <p className="font-semibold">{selectedState.label}</p>
                <p className="mt-1 max-w-sm text-xs opacity-80">
                  {selectedState.description}
                </p>
              </div>
            </div>

            {selectedState.reasons.length > 0 ? (
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {selectedState.reasons.map((reason) => (
                  <div
                    key={reason.key}
                    className={`rounded-2xl border p-4 text-sm ${toneClasses(
                      reason.tone,
                    )}`}
                  >
                    <p className="font-semibold">{reason.label}</p>
                    <p className="mt-1 text-xs opacity-80">
                      {reason.description}
                    </p>
                    <p className="mt-3 text-xs font-medium">
                      Staff action: {reason.action}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-purple-200 bg-purple-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-purple-950">
                    Provider / Trello routing
                  </p>
                  <p className="mt-1 text-xs text-purple-800">
                    This is set by your clinician routing brain after workflow
                    classification.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedItem.trello_card_url ? (
                    <a
                      href={selectedItem.trello_card_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-purple-300 bg-white px-4 py-2 text-xs font-medium text-purple-800 hover:bg-purple-100"
                    >
                      Open Trello card
                    </a>
                  ) : null}

                  <button
                    type="button"
                    onClick={createManualTrelloTask}
                    disabled={
                      busy === "create-trello-task" ||
                      Boolean(selectedItem.trello_card_id)
                    }
                    className="rounded-full border border-purple-300 bg-purple-700 px-4 py-2 text-xs font-medium text-white hover:bg-purple-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === "create-trello-task"
                      ? "Creating..."
                      : selectedItem.trello_card_id
                        ? "Trello created"
                        : "Create Trello task"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm text-purple-900 sm:grid-cols-2">
                <p>
                  <span className="font-medium">Provider:</span>{" "}
                  {selectedItem.assigned_clinician_name || "Not routed yet"}
                </p>

                <p>
                  <span className="font-medium">Confidence:</span>{" "}
                  {typeof selectedItem.clinician_routing_confidence === "number"
                    ? `${Math.round(
                        selectedItem.clinician_routing_confidence * 100,
                      )}%`
                    : "Unknown"}
                </p>

                <p>
                  <span className="font-medium">Trello board:</span>{" "}
                  {selectedItem.trello_board_id || "Not set"}
                </p>

                <p>
                  <span className="font-medium">Trello list:</span>{" "}
                  {selectedItem.trello_list_id || "Not set"}
                </p>

                <p>
                  <span className="font-medium">Trello task:</span>{" "}
                  {selectedItem.trello_auto_task_status ||
                    (selectedItem.trello_card_id
                      ? "Created"
                      : "Not created yet")}
                </p>
              </div>

              {selectedItem.clinician_routing_reason ? (
                <p className="mt-3 text-xs leading-5 text-purple-800">
                  {selectedItem.clinician_routing_reason}
                </p>
              ) : (
                <p className="mt-3 text-xs leading-5 text-purple-800">
                  No routing result yet. Re-analyse or wait for background
                  processing to finish.
                </p>
              )}

              {selectedItem.trello_auto_task_reason ? (
                <p className="mt-2 text-xs leading-5 text-purple-800">
                  Trello note: {selectedItem.trello_auto_task_reason}
                </p>
              ) : null}

              {selectedItem.trello_auto_task_error ? (
                <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                  Trello error: {selectedItem.trello_auto_task_error}
                </p>
              ) : null}
            </div>

            <div
              className={`mt-5 rounded-2xl border p-4 ${toneClasses(
                praktikaMatchTone(selectedItem.praktika_match_status),
              )}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-bold">Praktika patient match</p>
                  <p className="mt-1 text-xs opacity-80">
                    Uses AI-extracted patient details and your read-only
                    Praktika patient search.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={matchPraktikaPatient}
                  disabled={busy === "match-praktika-patient"}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "match-praktika-patient"
                    ? "Matching..."
                    : "Match Praktika patient"}
                </button>
              </div>

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <p>
                  <span className="font-medium">Status:</span>{" "}
                  {praktikaMatchStatusLabel(selectedItem.praktika_match_status)}
                </p>

                <p>
                  <span className="font-medium">Confidence:</span>{" "}
                  {typeof selectedItem.praktika_match_confidence === "number"
                    ? `${Math.round(selectedItem.praktika_match_confidence * 100)}%`
                    : "Not checked"}
                </p>

                <p>
                  <span className="font-medium">Praktika patient ID:</span>{" "}
                  {selectedItem.praktika_patient_id || "Not matched"}
                </p>

                <p>
                  <span className="font-medium">Patient number:</span>{" "}
                  {selectedItem.praktika_patient_number || "Not matched"}
                </p>

                <p>
                  <span className="font-medium">Extracted patient:</span>{" "}
                  {[
                    selectedItem.extracted_patient_first_name,
                    selectedItem.extracted_patient_last_name,
                  ]
                    .filter(Boolean)
                    .join(" ") || "Not extracted yet"}
                </p>

                <p>
                  <span className="font-medium">Extracted DOB:</span>{" "}
                  {selectedItem.extracted_patient_dob || "Not extracted yet"}
                </p>
              </div>

              {selectedItem.praktika_match_reason ? (
                <p className="mt-3 text-xs leading-5 opacity-80">
                  {selectedItem.praktika_match_reason}
                </p>
              ) : (
                <p className="mt-3 text-xs leading-5 opacity-80">
                  Run patient matching when the item has enough text/OCR to
                  identify the patient.
                </p>
              )}

              <PraktikaMatchCandidatesPanel
                inboxItemId={selectedItem.id}
                candidates={selectedItem.praktika_match_candidates}
                selectedPatientId={selectedItem.praktika_patient_id}
                onConfirmed={(item) => {
                  replaceItem(item);
                  setMessage("Praktika patient match confirmed.");
                }}
              />
            </div>

            {/* Create new Praktika patient */}
<div className="mt-5">
  <CreateNewPraktikaPatientFromInboxButton
    inboxItem={selectedItem}
    onCreated={async (item) => {
      if (item) {
        updateSelectedItem(item);
      }

      setMessage("New Praktika patient workflow completed.");

      await refreshWorkbenchItems({ silent: true });
    }}
  />
</div>

<div className="mt-5">
  <PraktikaReferralWorkflowSection
    inboxItem={selectedItem}
    onUpdated={async (item) => {
      if (item) {
        updateSelectedItem(item);
      }

      await refreshWorkbenchItems({ silent: true });
      setMessage("Praktika referrer/referral workflow updated.");
    }}
  />
</div>


{/* File to Praktika */}
<div className="mt-5">
  <FileInboxItemToPraktikaButton
    inboxItemId={selectedItem.id}
    praktikaPatientId={
      selectedItem.praktika_patient_id &&
      ["matched_existing", "confirmed_manual"].includes(
        selectedItem.praktika_match_status || "",
      )
        ? String(selectedItem.praktika_patient_id)
        : null
    }
    filingStatus={selectedItem.praktika_filing_status}
  />
</div>

            <div className="mt-5">
              <AutomationPreviewCard
                inboxItemId={selectedItem.id}
                onExecuted={(item) => {
                  if (item) {
                    replaceItem(item);
                  }
                  setMessage("Safe automation execution completed.");
                }}
              />
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Attachments
                </h3>
                <p className="text-sm text-slate-500">
                  Open documents and images from the Outlook email.
                </p>
              </div>

              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
                {selectedAttachments.length} file
                {selectedAttachments.length === 1 ? "" : "s"}
              </span>
            </div>

            {selectedAttachments.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                No attachments found.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {selectedAttachments.map((attachment, index) => {
                  const statusLabel = attachmentStatusLabel(attachment);
                  const storagePath = attachment.storage_path || `${index}`;

                  return (
                    <div
                      key={`${storagePath}-${index}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {attachment.name || "Unnamed attachment"}
                          </p>

                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-600">
                              {attachmentKind(attachment)}
                            </span>
                            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-600">
                              {formatFileSize(attachment.size)}
                            </span>
                            {statusLabel ? (
                              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-blue-700">
                                {statusLabel}
                              </span>
                            ) : null}
                          </div>

                          {showAdvanced && attachment.ocr_error ? (
                            <p className="mt-2 text-xs text-rose-600">
                              OCR note: {attachment.ocr_error}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => openAttachment(attachment)}
                            disabled={
                              busy === `open-${attachment.storage_path}`
                            }
                            className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                          >
                            Open
                          </button>

                          {showAdvanced &&
                          (attachment.needs_ocr ||
                            attachment.ocr_status === "needed" ||
                            attachment.ocr_status === "failed") ? (
                            <button
                              type="button"
                              onClick={() => runManualOcr(attachment)}
                              disabled={
                                busy === `ocr-${attachment.storage_path}`
                              }
                              className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                            >
                              Run OCR
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Reception summary
              </h3>
              <p className="text-sm text-slate-500">
                Plain-English summary and suggested next action.
              </p>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-slate-700">Summary</p>
                <div className="mt-2 min-h-[110px] rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  {selectedItem.summary || "No summary yet."}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-700">
                  Suggested action
                </p>
                <div className="mt-2 min-h-[110px] rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  {selectedItem.suggested_action || "No suggested action yet."}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  AI Brain review
                </h3>
                <p className="text-sm text-slate-500">
                  Safety and workflow reasoning for the selected item.
                </p>
              </div>

              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
                Risk: {getRisk(selectedItem)}
              </span>
            </div>

            <div className="mt-4 grid gap-3 text-sm text-slate-700">
              <p>
                <span className="font-medium">Operational intent:</span>{" "}
                {selectedDecision?.operational_intent || "Unknown"}
              </p>
              <p>
                <span className="font-medium">Confidence:</span>{" "}
                {selectedDecision?.confidence ??
                  selectedItem.confidence ??
                  "Unknown"}
              </p>
              <p>
                <span className="font-medium">Safe to auto-draft:</span>{" "}
                {selectedDecision?.safe_to_auto_draft === false ? "No" : "Yes"}
              </p>
              <p>
                <span className="font-medium">Why:</span>{" "}
                {selectedDecision?.explanation ||
                  "No AI explanation available."}
              </p>
            </div>

            {Array.isArray(selectedDecision?.risks) &&
            selectedDecision.risks.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Risks detected</p>
                <ul className="mt-2 list-disc pl-5">
                  {selectedDecision.risks.map((risk: string, index: number) => (
                    <li key={`${risk}-${index}`}>{risk}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <button
              type="button"
              onClick={() => setShowExtractedText((current) => !current)}
              className="text-sm font-medium text-slate-700 hover:text-slate-950"
            >
              {showExtractedText
                ? "Hide extracted text"
                : "Show extracted text"}
            </button>

            {showExtractedText ? (
              <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                {selectedItem.raw_text ||
                  selectedItem.extracted_text ||
                  selectedItem.body ||
                  "No extracted text available."}
              </pre>
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <button
              type="button"
              onClick={() => setShowAuditTrail((current) => !current)}
              className="text-sm font-medium text-slate-700 hover:text-slate-950"
            >
              {showAuditTrail ? "Hide audit trail" : "Show audit trail"}
            </button>

            {showAuditTrail ? (
              <div className="mt-4">
                <InboxItemAuditTrail inboxItemId={selectedItem.id} />
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <button
              type="button"
              onClick={() => setShowAudit((current) => !current)}
              className="text-sm font-medium text-slate-700 hover:text-slate-950"
            >
              {showAudit ? "Hide audit/debug data" : "Show audit/debug data"}
            </button>

            {showAudit ? (
              <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                {JSON.stringify(
                  {
                    item: selectedItem,
                    latestDecision: selectedDecision,
                    workflowState: selectedState,
                  },
                  null,
                  2,
                )}
              </pre>
            ) : null}
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-5 xl:max-h-[calc(100vh-40px)] xl:overflow-y-auto">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Draft & Review</h2>
            <p className="mt-1 text-sm text-slate-500">
              Review the draft, create an Outlook draft, or finish the item.
            </p>
          </div>

          <div className="mt-5 space-y-3">
            <button
              type="button"
              onClick={createOutlookDraft}
              disabled={
                busy === "create-outlook-draft" ||
                !draftBody ||
                selectedState.key.startsWith("processing")
              }
              className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
            >
              Create Outlook draft
            </button>

            <button
  type="button"
  onClick={saveReview}
  disabled={
    busy === "save-review" ||
    !draftBody ||
    selectedState.key.startsWith("processing")
  }
  className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
>
  {busy === "save-review" ? "Saving review..." : "Save Review + Train AI"}
</button>

            {selectedItem.outlook_web_link || selectedItem.source_email_url ? (
              <button
                type="button"
                onClick={() =>
                  window.open(
                    selectedItem.outlook_web_link ||
                      selectedItem.source_email_url ||
                      "",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              >
                Open Outlook
              </button>
            ) : null}

            {selectedItem.outlook_draft_id ? (
              <button
                type="button"
                onClick={sendOutlookDraft}
                disabled={
                  busy === "send-outlook-draft" ||
                  selectedItem.email_status === "sent"
                }
                className="w-full rounded-2xl border border-green-200 bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedItem.email_status === "sent"
                  ? "Email sent"
                  : busy === "send-outlook-draft"
                    ? "Sending..."
                    : "Send from Outlook"}
              </button>
            ) : null}

            {selectedItem.trello_card_url ? (
              <button
                type="button"
                onClick={() =>
                  window.open(
                    selectedItem.trello_card_url || "",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="w-full rounded-2xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm font-medium text-purple-700 hover:bg-purple-100"
              >
                Open Trello card
              </button>
            ) : (
              <button
                type="button"
                onClick={createManualTrelloTask}
                disabled={busy === "create-trello-task"}
                className="w-full rounded-2xl border border-purple-200 bg-purple-600 px-4 py-3 text-sm font-bold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "create-trello-task"
                  ? "Creating Trello task..."
                  : "Create Trello task"}
              </button>
            )}

            <button
              type="button"
              onClick={matchPraktikaPatient}
              disabled={busy === "match-praktika-patient"}
              className="w-full rounded-2xl border border-blue-200 bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "match-praktika-patient"
                ? "Matching Praktika patient..."
                : "Match Praktika patient"}
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={archiveItem}
                disabled={busy === "archive"}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Archive
              </button>

              <button
                type="button"
                onClick={markNoReply}
                disabled={busy === "no-reply"}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                No reply
              </button>
            </div>

            <button
              type="button"
              onClick={sendClinicalReview}
              disabled={busy === "clinical-review"}
              className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              Clinical review
            </button>
          </div>

          {showAdvanced ? (
            <div className="mt-5 space-y-4">
              {/* Advanced draft tools */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">
                  Advanced draft tools
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={generateDraft}
                    disabled={busy === "generate-draft"}
                    className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy === "generate-draft"
                      ? "Re-analysing..."
                      : "Re-analyse V2"}
                  </button>

                  <button
                    type="button"
                    onClick={saveDraft}
                    disabled={busy === "save-draft"}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Save
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(draftBody || "")
                    }
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Copy
                  </button>

                  <button
                    type="button"
                    onClick={checkSent}
                    disabled={busy === "check-sent"}
                    className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    Check sent
                  </button>
                </div>
              </div>

              {/* File to Praktika */}
              <FileInboxItemToPraktikaButton
                inboxItemId={selectedItem.id}
                praktikaPatientId={
                  selectedItem.praktika_patient_id &&
                  ["matched_existing", "confirmed_manual"].includes(
                    selectedItem.praktika_match_status || "",
                  )
                    ? selectedItem.praktika_patient_id
                    : null
                }
                filingStatus={selectedItem.praktika_filing_status}
              />

              {/* Classification V2 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Classification V2
                    </div>

                    <p className="mt-1 text-xs text-slate-500">
                      Run the newer AI classification pipeline.
                    </p>
                  </div>

                  <ClassificationV2Button
                    inboxItemId={selectedItem.id}
                    onComplete={async () => {
                      await refreshWorkbenchItems({ silent: true });
                      setMessage("Classification V2 completed.");
                    }}
                  />
                </div>
              </div>

              {/* Audit trail */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <button
                  type="button"
                  onClick={() => setShowAuditTrail((current) => !current)}
                  className="text-sm font-medium text-slate-700"
                >
                  {showAuditTrail ? "Hide audit trail" : "Show audit trail"}
                </button>

                {showAuditTrail ? (
                  <div className="mt-4">
                    <InboxItemAuditTrail inboxItemId={selectedItem.id} />
                  </div>
                ) : null}
              </div>

              {/* Archived status */}
              {selectedItem.archived_at ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Archived on {formatDate(selectedItem.archived_at)}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-5 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700">
                Draft subject
              </label>
              <input
                value={draftSubject}
                onChange={(event) => setLocalDraftSubject(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                placeholder="No draft subject yet"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-700">
                Draft body
              </label>
              <textarea
                value={draftBody}
                onChange={(event) => setLocalDraftBody(event.target.value)}
                className="mt-2 min-h-[320px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                placeholder="No draft body yet"
              />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
