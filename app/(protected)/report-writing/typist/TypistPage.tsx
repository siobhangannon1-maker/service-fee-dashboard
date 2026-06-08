"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import ReferrerSearchBox from "@/components/report-writing/ReferrerSearchBox";
import DraftImagePanel from "@/components/report-writing/DraftImagePanel";
import PraktikaToolsPopup from "@/components/report-writing/PraktikaToolsPopup";
import MedirefToolsPopup from "@/components/report-writing/MedirefToolsPopup";

type Provider = {
  id: string;
  name: string;
  typist_letters_require_approval: boolean | null;
};

type ReportTypeOption = {
  value: string;
  label: string;
};

type PreferredExampleOption = {
  id: string;
  title: string | null;
  report_type: string;
  scenario_tags: string[] | null;
  scenario_summary: string | null;
  is_preferred: boolean | null;
};

type Draft = {
  id: string;
  patient_name: string | null;
  patient_dob: string | null;
  referrer_name: string | null;
  referrer_address: string | null;
  report_type: string;
  clinical_notes?: string | null;
  source_clinical_notes?: string | null;
  edited_text: string | null;
  ai_generated_text: string | null;
  status: string;
  praktika_patient_id?: string | null;
  created_at: string;
  uploaded_to_praktika?: boolean | null;
  uploaded_to_praktika_at?: string | null;
  emailed_to_referrer_at?: string | null;
  emailed_to_referrer_email?: string | null;
  emailed_to_referrer_resend_id?: string | null;
  typist_instructions?: string | null;
};

type QueueItem = {
  id: string;
  provider_id: string | null;
  report_draft_id: string | null;
  appointment_id?: string | null;
  praktika_patient_id: string | null;
  patient_first_name: string | null;
  patient_last_name: string | null;
  patient_dob: string | null;
  patient_gender?: PatientGender | null;
  referrer_name?: string | null;
  referrer_address?: string | null;
  source_clinical_notes?: string | null;
  appointment_time: string | null;
  queue_reason: string | null;
  status: string;
  raw_json?: Record<string, unknown> | null;
};

type ListTab = "queue" | "awaiting" | "completed";

type QueueStatusTab = "active" | "queued" | "started" | "completed";

type AutoGenerateStatus =
  | "idle"
  | "loading_notes"
  | "selecting_report_type"
  | "generating"
  | "ready"
  | "error";

type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

type PraktikaCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  matchScore: number | null;
  matchReason: string;
};

type LatestPraktikaReferral = {
  referralId: string | number;
  referralDate: string;
  createdDate: string;
  referrerName: string;
  referrerAddress: string;
  providerId: string | number | null;
  providerNumber: string;
  clinicId: string | number | null;
  reason: string;
};

type MedirefAdditionalRecipient = {
  id: string;
  name: string;
  practiceName: string;
  address: string;
};

type PatientGender = "male" | "female" | "neutral";

function splitPatientName(name: string | null) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function safeFileName(name: string | null | undefined) {
  return String(name || "Patient")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function getFilenameFromResponse(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="(.+?)"/);

  if (match?.[1]) return match[1];

  return fallback;
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function formatManualReferrerAddress(referrer: any) {
  const practiceName = String(
    referrer?.practice_name ||
      referrer?.practiceName ||
      referrer?.clinic_name ||
      referrer?.clinicName ||
      referrer?.practice ||
      referrer?.raw_json?.vchClinic ||
      ""
  ).trim();

  const address = String(referrer?.address || "").trim();

  if (!practiceName) return address;
  if (!address) return practiceName;

  const firstAddressLine = address.split(/\n+/)[0]?.trim().toLowerCase();

  if (firstAddressLine === practiceName.toLowerCase()) {
    return address;
  }

  return [practiceName, address].filter(Boolean).join("\n");
}



function getMedirefPracticeNameFromAddress(value: string | null | undefined) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return "";

  const lines = cleanValue
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";

  return lines[0];
}

function parsePdfCcRecipientsForMediref(value: string) {
  return String(value || "")
    .split(/\n|;/)
    .map((line) => line.replace(/^cc\.?\s*/i, "").trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `pdf-cc-${index}-${line}`,
      name: line,
      practiceName: "",
      address: "",
    }));
}

function medirefRecipientKey(recipient: {
  name: string;
  practiceName?: string;
  address?: string;
}) {
  return [
    cleanString(recipient.name).toLowerCase(),
    cleanString(recipient.practiceName).toLowerCase(),
    cleanString(recipient.address).toLowerCase(),
  ].join("|");
}

function getDraftClinicalNotes(draft: Draft) {
  return (
    cleanString(draft.clinical_notes) ||
    cleanString(draft.source_clinical_notes) ||
    ""
  );
}

function getQueueSearchText(item: QueueItem) {
  const raw = item.raw_json || {};

  return [
    item.queue_reason,
    raw.vchAppointmentNotes,
    raw.vchTxType,
    raw.vchTxLabel,
    raw.vchTreatmentType,
    raw.treatment_type,
    raw.appointment_type,
  ]
    .map(cleanString)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferReportTypeFromQueueItem(
  item: QueueItem,
  reportTypes: ReportTypeOption[],
) {
  const text = getQueueSearchText(item);
  const available = new Set(reportTypes.map((type) => type.value));

  const candidates: Array<{ value: string; keywords: string[] }> = [
    {
      value: "osseointegration_letter",
      keywords: [
        "osseointegration",
        "implant review",
        "implant check",
        "implant",
      ],
    },
    {
      value: "post_op_letter",
      keywords: [
        "post op",
        "post-op",
        "postoperative",
        "post operative",
        "healing review",
      ],
    },
    {
      value: "surgery_report",
      keywords: [
        "surgery",
        "surgical",
        "extraction",
        "expose",
        "biopsy",
        "graft",
      ],
    },
    {
      value: "SPT_report",
      keywords: [
        "spt",
        "supportive periodontal",
        "maintenance",
        "perio maintenance",
      ],
    },
    {
      value: "review",
      keywords: ["review", "follow up", "follow-up", "recall"],
    },
    {
      value: "treatment_report",
      keywords: [
        "treatment",
        "debridement",
        "fmd",
        "root planing",
        "non-surgical",
      ],
    },
    {
      value: "consultation_report",
      keywords: [
        "consult",
        "consultation",
        "new patient",
        "initial",
        "specialist consultation",
      ],
    },
  ];

  for (const candidate of candidates) {
    if (!available.has(candidate.value)) continue;

    if (candidate.keywords.some((keyword) => text.includes(keyword))) {
      return candidate.value;
    }
  }

  if (available.has("consultation_report")) return "consultation_report";

  return reportTypes[0]?.value || "consultation_report";
}

function getQueueBadges(item: QueueItem) {
  const text = getQueueSearchText(item);
  const badges: Array<{ label: string; className: string }> = [];

  if (/urgent|asap|today|pain|swelling|infection/.test(text)) {
    badges.push({
      label: "Urgent",
      className: "bg-red-100 text-red-700",
    });
  }

  if (/consult|consultation|new patient|initial/.test(text)) {
    badges.push({
      label: "Consult",
      className: "bg-blue-100 text-blue-700",
    });
  }

  if (/surgery|surgical|extraction|biopsy|graft/.test(text)) {
    badges.push({
      label: "Surgery",
      className: "bg-purple-100 text-purple-700",
    });
  }

  if (/review|post op|post-op|postoperative|post operative/.test(text)) {
    badges.push({
      label: "Review",
      className: "bg-amber-100 text-amber-700",
    });
  }

  if (/implant|osseointegration/.test(text)) {
    badges.push({
      label: "Implant",
      className: "bg-indigo-100 text-indigo-700",
    });
  }

  if (/spt|maintenance|supportive periodontal/.test(text)) {
    badges.push({
      label: "SPT",
      className: "bg-emerald-100 text-emerald-700",
    });
  }

  return badges.slice(0, 3);
}

function getSuggestedReportTypeLabel(
  item: QueueItem,
  reportTypes: ReportTypeOption[],
) {
  const inferredType = inferReportTypeFromQueueItem(item, reportTypes);

  return (
    reportTypes.find((type) => type.value === inferredType)?.label ||
    inferredType.replace(/_/g, " ")
  );
}

function getQueueClinicalNotes(item: QueueItem) {
  const raw = item.raw_json || {};

  const appointmentNotes = cleanString(raw.vchAppointmentNotes);
  const treatmentType = cleanString(raw.vchTxType);
  const treatmentLabel = cleanString(raw.vchTxLabel);

  const lines = [
    appointmentNotes ? `Appointment notes: ${appointmentNotes}` : "",
    treatmentType ? `Treatment type: ${treatmentType}` : "",
    treatmentLabel ? `Treatment label: ${treatmentLabel}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

function parseEmailList(value: string) {
  return value
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function hasInvalidEmail(value: string) {
  const emails = parseEmailList(value);
  return emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function extractPdfCcText(text: string) {
  const match = String(text || "").match(/\[\[PDF_CC:([\s\S]*?)\]\]/);
  return match?.[1]?.trim() || "";
}

function extractPdfDateText(text: string) {
  const match = String(text || "").match(/\[\[PDF_DATE:([\s\S]*?)\]\]/);
  return match?.[1]?.trim() || "";
}

function stripPdfMarkers(text: string) {
  return String(text || "")
    .replace(/\n?\[\[PDF_CC:[\s\S]*?\]\]/g, "")
    .replace(/\n?\[\[PDF_DATE:[\s\S]*?\]\]/g, "")
    .trimEnd();
}

function buildLetterTextForSave(
  letterBody: string,
  pdfCcText: string,
  pdfLetterDate: string,
) {
  const cleanBody = stripPdfMarkers(letterBody);
  const cleanCc = String(pdfCcText || "").trim();
  const cleanDate = String(pdfLetterDate || "").trim();

  const markers = [
    cleanCc ? `[[PDF_CC:${cleanCc}]]` : "",
    cleanDate ? `[[PDF_DATE:${cleanDate}]]` : "",
  ].filter(Boolean);

  if (markers.length === 0) return cleanBody;

  return `${cleanBody}\n\n${markers.join("\n")}`;
}

function getInclusiveDateRangeDays(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T00:00:00`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return null;
  }

  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

export default function TypistPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [reportTypes, setReportTypes] = useState<ReportTypeOption[]>([
    { value: "consultation_report", label: "Consultation Report" },
  ]);
  const [preferredExamples, setPreferredExamples] = useState<
    PreferredExampleOption[]
  >([]);
  const [preferredExampleId, setPreferredExampleId] = useState("");

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeQueueItemId, setActiveQueueItemId] = useState<string | null>(
    null,
  );

  const [queueFromDate, setQueueFromDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [queueToDate, setQueueToDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [listTab, setListTab] = useState<ListTab>("queue");
  const [queueStatusTab, setQueueStatusTab] =
    useState<QueueStatusTab>("active");

  const [patientFirstName, setPatientFirstName] = useState("");
  const [patientLastName, setPatientLastName] = useState("");
  const [patientDob, setPatientDob] = useState("");
  const [patientGender, setPatientGender] = useState<PatientGender>("neutral");
  const [dobFocused, setDobFocused] = useState(false);

  const [referrerName, setReferrerName] = useState("");
  const [referrerAddress, setReferrerAddress] = useState("");
  const [latestPraktikaReferral, setLatestPraktikaReferral] =
    useState<LatestPraktikaReferral | null>(null);
  const [referralAutoFillStatus, setReferralAutoFillStatus] = useState<
    "idle" | "loading" | "found" | "filled" | "not_found" | "error"
  >("idle");
  const [referralAutoFillError, setReferralAutoFillError] = useState("");
  const [reportType, setReportType] = useState("consultation_report");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [letterText, setLetterText] = useState("");
  const [generatedAiLetterText, setGeneratedAiLetterText] = useState("");
  const [pdfCcText, setPdfCcText] = useState("");
  const [pdfLetterDate, setPdfLetterDate] = useState(
    new Date().toISOString().slice(0, 10),
  );

  const [praktikaCandidates, setPraktikaCandidates] = useState<
    PraktikaCandidate[]
  >([]);
  const [selectedPraktikaPatientId, setSelectedPraktikaPatientId] =
    useState("");
  const [matchingPatient, setMatchingPatient] = useState(false);

  const [loading, setLoading] = useState(false);
  const [autoGenerateStatus, setAutoGenerateStatus] =
    useState<AutoGenerateStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutosavedTextRef = useRef("");
  const letterTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const referrerAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [secureEmailModalOpen, setSecureEmailModalOpen] = useState(false);
  const [secureEmailRecipient, setSecureEmailRecipient] = useState("");
  const [secureEmailCc, setSecureEmailCc] = useState("");
  const [secureEmailSubject, setSecureEmailSubject] = useState("");
  const [secureEmailBody, setSecureEmailBody] = useState("");
  const [secureEmailConfirmed, setSecureEmailConfirmed] = useState(false);
  const [attachPeriodontalChart, setAttachPeriodontalChart] = useState(false);
  const [secureEmailPreviewLoading, setSecureEmailPreviewLoading] =
    useState(false);

  const [medirefModalOpen, setMedirefModalOpen] = useState(false);
  const [medirefRecipientName, setMedirefRecipientName] = useState("");
  const [medirefRecipientPracticeName, setMedirefRecipientPracticeName] =
    useState("");
  const [medirefAutoMatchRecipient, setMedirefAutoMatchRecipient] =
    useState(true);
  const [medirefRecipientEmail, setMedirefRecipientEmail] = useState("");
  const [medirefRecipientProviderNumber, setMedirefRecipientProviderNumber] =
    useState("");
  const [medirefPatientEmail, setMedirefPatientEmail] = useState("");
  const [medirefAdditionalRecipients, setMedirefAdditionalRecipients] =
    useState<MedirefAdditionalRecipient[]>([]);
  const [medirefMessage, setMedirefMessage] = useState("");
  const [medirefConfirmed, setMedirefConfirmed] = useState(false);
  const [medirefCompleteWorkflow, setMedirefCompleteWorkflow] = useState(false);

  const [pdfPreviewModalOpen, setPdfPreviewModalOpen] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState("PDF preview");

  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [completeConfirmed, setCompleteConfirmed] = useState(false);
  const [completeStep, setCompleteStep] = useState("");

  const patientName = `${patientFirstName} ${patientLastName}`.trim();

  const selectedProvider = providers.find(
    (provider) => provider.id === selectedProviderId,
  );
  const [mounted, setMounted] = useState(false);
  const [showPraktikaTools, setShowPraktikaTools] = useState(false);
  const [showMedirefTools, setShowMedirefTools] = useState(false);
  const [praktikaPreSyncMessage, setPraktikaPreSyncMessage] =
    useState<string | null>(null);
  const [praktikaNeedsReconnect, setPraktikaNeedsReconnect] = useState(false);
  const [praktikaSyncingQueue, setPraktikaSyncingQueue] = useState(false);
  const [praktikaSyncingReferrers, setPraktikaSyncingReferrers] =
    useState(false);
  const [imageDraftId, setImageDraftId] = useState<string | null>(null);
  const [imageDraftCreating, setImageDraftCreating] = useState(false);
  const [imageDraftError, setImageDraftError] = useState<string | null>(null);
  const autoImageDraftQueueIdRef = useRef<string | null>(null);

  const selectedProviderRequiresApproval =
    selectedProvider?.typist_letters_require_approval !== false;

  const filteredDrafts = useMemo(() => {
    if (listTab === "awaiting") {
      return drafts.filter(
        (draft) => draft.status === "awaiting_provider_approval",
      );
    }

    if (listTab === "completed") {
      return drafts.filter(
        (draft) =>
          draft.status === "approved" ||
          Boolean(draft.emailed_to_referrer_at) ||
          Boolean(draft.uploaded_to_praktika_at),
      );
    }

    return drafts;
  }, [drafts, listTab]);

  const visibleDraftIds = filteredDrafts.map((draft) => draft.id);

  const allVisibleSelected =
    visibleDraftIds.length > 0 &&
    visibleDraftIds.every((id) => selectedDraftIds.includes(id));

  const countDrafts = drafts.filter((draft) =>
    ["draft", "edited_by_typist"].includes(draft.status),
  ).length;

  const countAwaiting = drafts.filter(
    (draft) => draft.status === "awaiting_provider_approval",
  ).length;

  const countCompleted = drafts.filter(
    (draft) =>
      draft.status === "approved" ||
      Boolean(draft.emailed_to_referrer_at) ||
      Boolean(draft.uploaded_to_praktika_at),
  ).length;

  const selectedDraftHasPraktikaPatient = Boolean(
    selectedPraktikaPatientId || selectedDraft?.praktika_patient_id,
  );

  const selectedDraftUploadedToPraktika = Boolean(
    selectedDraft?.uploaded_to_praktika ||
    selectedDraft?.uploaded_to_praktika_at,
  );

  const selectedDraftEmailed = Boolean(selectedDraft?.emailed_to_referrer_at);

  const selectedDraftCanComplete = Boolean(
    selectedDraft &&
    ["approved", "uploaded_to_praktika"].includes(selectedDraft.status),
  );

  const currentImageDraftId = selectedDraft?.id || imageDraftId;

  function getNextWorkflowAction() {
    if (!selectedDraft) return "Select or create a letter.";

    if (selectedDraft.status !== "approved") {
      return selectedProviderRequiresApproval
        ? "Send this letter to the provider for approval."
        : "Mark this letter approved when ready.";
    }

    if (!selectedDraftHasPraktikaPatient) {
      return "Search/select the Praktika patient match.";
    }

    if (!selectedDraftUploadedToPraktika) {
      return "Upload the approved PDF to Praktika.";
    }

    if (!selectedDraftEmailed) {
      return "Send the approved PDF to the referrer via MediRef.";
    }

    return "Completed: uploaded and sent via MediRef.";
  }

  function getAutoGenerateStatusLabel() {
    if (autoGenerateStatus === "loading_notes") {
      return "Loading appointment and same-day clinical notes...";
    }

    if (autoGenerateStatus === "selecting_report_type") {
      return "Selecting the best report type from the appointment notes...";
    }

    if (autoGenerateStatus === "generating") {
      return "Ready to generate the AI draft manually.";
    }

    if (autoGenerateStatus === "ready") {
      return "Clinical notes loaded. Click Generate Letter From Notes when ready.";
    }

    if (autoGenerateStatus === "error") {
      return "Clinical notes could not be fully loaded. You can still edit or generate manually.";
    }

    return "Select a queue item to begin.";
  }

  function getSaveStatusLabel() {
    if (!selectedDraft) {
      return letterText.trim() ? "Not saved yet" : "No draft selected";
    }

    if (saveStatus === "saving") return "Saving edits...";
    if (saveStatus === "unsaved") return "Unsaved changes";
    if (saveStatus === "error") return "Autosave failed";

    if (lastSavedAt) {
      return `Saved ${new Date(lastSavedAt).toLocaleTimeString("en-AU", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }

    return "Saved";
  }

  function handleLetterTextChange(value: string) {
    setLetterText(value);

    if (selectedDraft) {
      const existingText = stripPdfMarkers(
        selectedDraft.edited_text || selectedDraft.ai_generated_text || "",
      );

      if (value !== existingText) {
        setSaveStatus("unsaved");
      }
    }
  }

  async function persistCurrentReferrerDetails(options?: { quiet?: boolean }) {
    if (!selectedDraft) return true;

    const currentReferrerName = cleanString(referrerName);
    const currentReferrerAddress = cleanString(referrerAddress);

    const savedReferrerName = cleanString(selectedDraft.referrer_name);
    const savedReferrerAddress = cleanString(selectedDraft.referrer_address);

    if (
      currentReferrerName === savedReferrerName &&
      currentReferrerAddress === savedReferrerAddress
    ) {
      return true;
    }

    try {
      if (!options?.quiet) {
        setSaveStatus("saving");
      }

      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          referrerName: currentReferrerName,
          referrerAddress: currentReferrerAddress,
          patientName,
          patientDob,
          reportType,
          clinicalNotes,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        console.error("Failed to save referrer details:", data);
        if (!options?.quiet) {
          setSaveStatus("error");
        }
        return false;
      }

      setSelectedDraft((current) =>
        current && current.id === selectedDraft.id
          ? {
              ...current,
              referrer_name: currentReferrerName || null,
              referrer_address: currentReferrerAddress || null,
              patient_name: patientName || current.patient_name,
              patient_dob: patientDob || current.patient_dob,
              report_type: reportType || current.report_type,
            }
          : current,
      );

      setDrafts((current) =>
        current.map((draft) =>
          draft.id === selectedDraft.id
            ? {
                ...draft,
                referrer_name: currentReferrerName || null,
                referrer_address: currentReferrerAddress || null,
              }
            : draft,
        ),
      );

      setLastSavedAt(new Date().toISOString());
      setSaveStatus("saved");
      return true;
    } catch (error) {
      console.error("Failed to persist referrer details:", error);
      if (!options?.quiet) {
        setSaveStatus("error");
      }
      return false;
    }
  }


  function getQueueStatusLabel(status: QueueStatusTab) {
    if (status === "active") return "Active";
    if (status === "queued") return "Queued";
    if (status === "started") return "Started";
    return "Completed / Sent";
  }

  function getDefaultSecureEmailSubject() {
    const name = selectedDraft?.patient_name || patientName || "Patient";
    return `Secure correspondence from Focus Dental Specialists - ${name}`;
  }

  function getDefaultSecureEmailBody() {
    return `You have received secure correspondence from Focus Dental Specialists regarding ${
      selectedDraft?.patient_name || patientName || "this patient"
    }. The attached PDF is password encrypted with the patient DOB (DDMMYYYY).`;
  }

  function getLetterTextForSave() {
    return buildLetterTextForSave(letterText, pdfCcText, pdfLetterDate);
  }

  async function ensureImageDraftForCurrentWork(options?: { quiet?: boolean }) {
    if (selectedDraft?.id) {
      setImageDraftId(selectedDraft.id);
      setImageDraftError(null);
      return selectedDraft.id;
    }

    if (imageDraftId) {
      setImageDraftError(null);
      return imageDraftId;
    }

    if (!selectedProviderId) {
      const message = "Please select a provider before uploading images.";
      setImageDraftError(message);
      if (!options?.quiet) alert(message);
      return null;
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      const message = "Patient first name and last name are required before uploading images.";
      setImageDraftError(message);
      if (!options?.quiet) alert(message);
      return null;
    }

    setImageDraftCreating(true);
    setImageDraftError(null);

    try {
      const placeholderText =
        getLetterTextForSave().trim() ||
        "[Temporary image workspace. Replace this text before finalising the letter.]";

      const response = await fetch("/api/report-writing/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProviderId,
          patientName,
          patientDob,
          patientGender,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
          generatedReport: generatedAiLetterText || placeholderText,
          editedText: placeholderText,
          finalApprovedText: placeholderText,
          originalAiText: generatedAiLetterText || placeholderText,
          learnFromEdits: false,
          learningSource: "typist_image_workspace",
          praktikaPatientId: selectedPraktikaPatientId || null,
          queueId: activeQueueItemId,
          status: "draft",
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data?.error || "Could not prepare image upload workspace.");
      }

      const createdDraftId = String(data.draft?.id || data.draftId || data.id || "").trim();

      if (!createdDraftId) {
        throw new Error("Image workspace was created but no draft ID was returned.");
      }

      setImageDraftId(createdDraftId);
      await loadDrafts(selectedProviderId);
      return createdDraftId;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not prepare image upload workspace.";

      console.error("Failed to prepare image upload workspace:", error);
      setImageDraftError(message);
      if (!options?.quiet) alert(message);
      return null;
    } finally {
      setImageDraftCreating(false);
    }
  }

  function insertImagePlaceholder(imageNumber: number) {
    const textarea = letterTextareaRef.current;
    const placeholder = `\n\n[[IMAGE:${imageNumber}]]\n\n`;

    if (!textarea) {
      handleLetterTextChange(`${letterText}${placeholder}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = letterText.slice(0, start);
    const after = letterText.slice(end);
    const nextText = `${before}${placeholder}${after}`;

    handleLetterTextChange(nextText);

    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextCursorPosition = start + placeholder.length;
      textarea.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  function toggleBoldSelectedText() {
    const textarea = letterTextareaRef.current;

    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = letterText.slice(start, end);

    if (!selected) {
      alert("Highlight the words you want to bold first, then click Bold.");
      return;
    }

    const before = letterText.slice(0, start);
    const after = letterText.slice(end);
    const alreadyBold = selected.startsWith("**") && selected.endsWith("**");
    const replacement = alreadyBold
      ? selected.replace(/^\*\*/, "").replace(/\*\*$/, "")
      : `**${selected}**`;

    handleLetterTextChange(`${before}${replacement}${after}`);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + replacement.length);
    });
  }

  async function pullSameDayClinicalNotes(params: {
    patientId: string;
    appointmentDate: string;
    appointmentId?: string | null;
  }) {
    const response = await fetch(
      "/api/report-writing/praktika-clinical-notes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patientId: params.patientId,
          appointmentDate: params.appointmentDate,
          appointmentId: params.appointmentId || null,
        }),
      },
    );

    const text = await response.text();

    if (!text.trim()) {
      throw new Error("Clinical notes API returned an empty response.");
    }

    let data: any;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Clinical notes API returned non-JSON: ${text.slice(0, 300)}`,
      );
    }

    if (!response.ok || !data.success) {
      throw new Error(
        data?.error ||
          `Clinical notes request failed with status ${response.status}.`,
      );
    }

    return String(data.text || "").trim();
  }

  async function openOneClickCompleteModal() {
    if (!selectedDraft) return;

    if (!["approved", "uploaded_to_praktika"].includes(selectedDraft.status)) {
      alert("Only approved reports can be completed.");
      return;
    }

    const finalPraktikaPatientId =
      selectedPraktikaPatientId || selectedDraft.praktika_patient_id || "";

    if (!finalPraktikaPatientId) {
      alert(
        "Please search/select the Praktika patient match before completing.",
      );
      return;
    }

    setSecureEmailPreviewLoading(true);
    setCompleteConfirmed(false);
    setAttachPeriodontalChart(false);
    setCompleteStep("");
    setSecureEmailSubject(getDefaultSecureEmailSubject());
    setSecureEmailBody(getDefaultSecureEmailBody());
    setSecureEmailRecipient(selectedDraft.emailed_to_referrer_email || "");
    setSecureEmailCc("");
    setCompleteModalOpen(true);

    try {
      const response = await fetch(
        `/api/report-writing/get-referrer-email?draftId=${selectedDraft.id}`,
      );

      const data = await response.json();

      if (data.success && data.email?.trim()) {
        setSecureEmailRecipient(data.email.trim());
      }
    } catch (error) {
      console.error("Referrer email lookup failed:", error);
    } finally {
      setSecureEmailPreviewLoading(false);
    }
  }

  async function completeUploadAndEmailFromModal() {
    if (!selectedDraft) return;

    if (!["approved", "uploaded_to_praktika"].includes(selectedDraft.status)) {
      alert("Only approved reports can be completed.");
      return;
    }

    const finalPraktikaPatientId =
      selectedPraktikaPatientId || selectedDraft.praktika_patient_id || "";

    if (!finalPraktikaPatientId) {
      alert("Please select the correct Praktika patient first.");
      return;
    }

    if (!secureEmailRecipient.trim() || !secureEmailRecipient.includes("@")) {
      alert("Please enter a valid referrer email address.");
      return;
    }

    if (hasInvalidEmail(secureEmailCc)) {
      alert(
        "Please check the CC email address(es). Use commas to separate multiple addresses.",
      );
      return;
    }

    if (!completeConfirmed) {
      alert("Please tick the checkbox confirming the details are correct.");
      return;
    }

    if (!secureEmailSubject.trim()) {
      alert("Please enter an email subject.");
      return;
    }

    if (!secureEmailBody.trim()) {
      alert("Please enter email text.");
      return;
    }

    if (selectedDraftUploadedToPraktika || selectedDraftEmailed) {
      const alreadyDoneParts = [
        selectedDraftUploadedToPraktika ? "already uploaded to Praktika" : "",
        selectedDraftEmailed ? "already emailed" : "",
      ].filter(Boolean);

      const continueAnyway = confirm(
        `This letter has ${alreadyDoneParts.join(" and ")}. Continue anyway?`,
      );

      if (!continueAnyway) return;
    }

    setLoading(true);

    try {
      setCompleteStep("Uploading approved PDF to Praktika...");

      const uploadResponse = await fetch(
        "/api/report-writing/upload-to-praktika",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draftId: selectedDraft.id,
            praktikaPatientId: finalPraktikaPatientId,
          }),
        },
      );

      const uploadData = await uploadResponse.json();

      if (!uploadData.success) {
        alert(uploadData.error || "Failed to upload to Praktika.");
        console.error("Praktika upload error:", uploadData);
        return;
      }

      setCompleteStep(
        "Updating Praktika letter icon and completing queue item...",
      );

      const iconResponse = await fetch(
        "/api/report-writing/update-praktika-letter-icons",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            queueId: activeQueueItemId,
            draftId: selectedDraft.id,
          }),
        },
      );

      const iconData = await iconResponse.json();

      if (!iconData.success) {
        console.warn("Praktika icon update skipped or failed:", iconData);

        const noQueueLinked =
          iconData.error?.toLowerCase?.().includes("queue") ||
          iconData.error?.toLowerCase?.().includes("appointment") ||
          iconData.error?.toLowerCase?.().includes("not found") ||
          !activeQueueItemId;

        if (!noQueueLinked) {
          alert(
            "PDF uploaded to Praktika, but the Praktika appointment icon could not be updated. The secure email will still be sent.",
          );
        }
      }

      setCompleteStep("Emailing encrypted PDF to referrer...");

      const emailResponse = await fetch(
        "/api/report-writing/email-secure-pdf",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draftId: selectedDraft.id,
            toEmail: secureEmailRecipient.trim(),
            email: secureEmailRecipient.trim(),
            ccEmails: parseEmailList(secureEmailCc),
            subject: secureEmailSubject,
            message: secureEmailBody,
            attachPeriodontalChart,
            praktikaPatientId:
              selectedPraktikaPatientId ||
              selectedDraft.praktika_patient_id ||
              null,
          }),
        },
      );

      const emailData = await emailResponse.json();

      if (!emailData.success) {
        alert(
          emailData.error ||
            "PDF uploaded to Praktika, but failed to email secure PDF.",
        );
        return;
      }

      const completedAt = new Date().toISOString();

      setSelectedDraft({
        ...selectedDraft,
        uploaded_to_praktika: true,
        uploaded_to_praktika_at: completedAt,
        emailed_to_referrer_at: completedAt,
        emailed_to_referrer_email:
          emailData.email || secureEmailRecipient.trim(),
        emailed_to_referrer_resend_id: emailData.resendId || null,
      });

      setActiveQueueItemId(null);
      setCompleteStep("Complete.");
      setCompleteModalOpen(false);
      setCompleteConfirmed(false);
      setAttachPeriodontalChart(false);

      alert(
        `Completed. PDF uploaded to Praktika and secure email sent to ${
          emailData.email || secureEmailRecipient.trim()
        }.${
          attachPeriodontalChart
            ? emailData.periodontalChartAttached
              ? " Periodontal chart attached."
              : ` Periodontal chart was NOT attached: ${
                  emailData.periodontalChartError || "unknown reason"
                }`
            : ""
        }`,
      );

      await loadDrafts(selectedProviderId);
      await loadQueue(selectedProviderId, queueStatusTab);
    } finally {
      setLoading(false);
    }
  }

  async function openSecureEmailModal() {
    if (!selectedDraft) return;

    if (!["approved", "uploaded_to_praktika"].includes(selectedDraft.status)) {
      alert("Only approved reports can be emailed securely.");
      return;
    }

    setSecureEmailPreviewLoading(true);
    setSecureEmailConfirmed(false);
    setAttachPeriodontalChart(false);
    setSecureEmailSubject(getDefaultSecureEmailSubject());
    setSecureEmailBody(getDefaultSecureEmailBody());
    setSecureEmailRecipient(selectedDraft.emailed_to_referrer_email || "");
    setSecureEmailCc("");
    setSecureEmailModalOpen(true);

    try {
      const response = await fetch(
        `/api/report-writing/get-referrer-email?draftId=${selectedDraft.id}`,
      );

      const data = await response.json();

      if (data.success && data.email?.trim()) {
        setSecureEmailRecipient(data.email.trim());
      }
    } catch (error) {
      console.error("Referrer email lookup failed:", error);
    } finally {
      setSecureEmailPreviewLoading(false);
    }
  }

  async function sendSecureEmailFromModal() {
    if (!selectedDraft) return;

    if (!secureEmailRecipient.trim() || !secureEmailRecipient.includes("@")) {
      alert("Please enter a valid referrer email address.");
      return;
    }

    if (hasInvalidEmail(secureEmailCc)) {
      alert(
        "Please check the CC email address(es). Use commas to separate multiple addresses.",
      );
      return;
    }

    if (!secureEmailConfirmed) {
      alert(
        "Please tick the checkbox confirming the email address is correct.",
      );
      return;
    }

    if (!secureEmailSubject.trim()) {
      alert("Please enter an email subject.");
      return;
    }

    if (!secureEmailBody.trim()) {
      alert("Please enter email text.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/email-secure-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          toEmail: secureEmailRecipient.trim(),
          email: secureEmailRecipient.trim(),
          ccEmails: parseEmailList(secureEmailCc),
          subject: secureEmailSubject,
          message: secureEmailBody,
          attachPeriodontalChart,
          praktikaPatientId:
            selectedPraktikaPatientId ||
            selectedDraft.praktika_patient_id ||
            null,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        alert(data.error || "Failed to email secure PDF.");
        return;
      }

      const iconResponse = await fetch(
        "/api/report-writing/update-praktika-letter-icons",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draftId: selectedDraft.id,
          }),
        },
      );

      const iconData = await iconResponse.json();

      if (!iconData.success) {
        alert(
          `Secure PDF emailed to ${data.email}, but Praktika icons were not updated.${
            attachPeriodontalChart
              ? data.periodontalChartAttached
                ? " Periodontal chart attached."
                : ` Periodontal chart was NOT attached: ${
                    data.periodontalChartError || "unknown reason"
                  }`
              : ""
          }`,
        );
        console.error("Praktika icon update error:", iconData);
      } else {
        alert(
          `Secure PDF emailed to ${data.email}. Praktika icons updated.${
            attachPeriodontalChart
              ? data.periodontalChartAttached
                ? " Periodontal chart attached."
                : ` Periodontal chart was NOT attached: ${
                    data.periodontalChartError || "unknown reason"
                  }`
              : ""
          }`,
        );
      }

      const emailedAt = new Date().toISOString();
      setSelectedDraft({
        ...selectedDraft,
        emailed_to_referrer_at: emailedAt,
        emailed_to_referrer_email: data.email || null,
        emailed_to_referrer_resend_id: data.resendId || null,
      });

      setSecureEmailModalOpen(false);
      setSecureEmailConfirmed(false);
      setAttachPeriodontalChart(false);

      await loadDrafts(selectedProviderId);
      await loadQueue(selectedProviderId, queueStatusTab);
    } finally {
      setLoading(false);
    }
  }


  function getDefaultMedirefMessage() {
    return `Specialist correspondence for ${
      selectedDraft?.patient_name || patientName || "this patient"
    }.`;
  }

  function addMedirefAdditionalRecipient(referrer: any) {
    const name = cleanString(referrer?.name);
    const address = formatManualReferrerAddress(referrer);
    const practiceName = getMedirefPracticeNameFromAddress(address);

    if (!name) return;

    const nextRecipient: MedirefAdditionalRecipient = {
      id: `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      practiceName,
      address,
    };

    setMedirefAdditionalRecipients((current) => {
      const nextKey = medirefRecipientKey(nextRecipient);

      if (
        current.some((recipient) => medirefRecipientKey(recipient) === nextKey)
      ) {
        return current;
      }

      return [...current, nextRecipient];
    });

    setMedirefConfirmed(false);
  }

  function removeMedirefAdditionalRecipient(id: string) {
    setMedirefAdditionalRecipients((current) =>
      current.filter((recipient) => recipient.id !== id),
    );
    setMedirefConfirmed(false);
  }

  function openMedirefModal(options?: { completeWorkflow?: boolean }) {
    if (!selectedDraft) return;

    if (!["approved", "uploaded_to_praktika"].includes(selectedDraft.status)) {
      alert("Only approved reports can be sent via MediRef.");
      return;
    }

    const completeWorkflow = Boolean(options?.completeWorkflow);
    const finalPraktikaPatientId =
      selectedPraktikaPatientId || selectedDraft.praktika_patient_id || "";

    if (completeWorkflow && !finalPraktikaPatientId) {
      alert(
        "Please search/select the Praktika patient match before completing.",
      );
      return;
    }

    setMedirefRecipientName(referrerName || selectedDraft.referrer_name || "");
    setMedirefRecipientPracticeName(
      getMedirefPracticeNameFromAddress(
        referrerAddress || selectedDraft.referrer_address || "",
      ),
    );
    setMedirefAutoMatchRecipient(true);
    setMedirefRecipientEmail("");
    setMedirefRecipientProviderNumber("");
    setMedirefPatientEmail("");
    setMedirefAdditionalRecipients(parsePdfCcRecipientsForMediref(pdfCcText));
    setMedirefMessage(getDefaultMedirefMessage());
    setAttachPeriodontalChart(false);
    setMedirefCompleteWorkflow(completeWorkflow);
    setCompleteStep("");
    setMedirefConfirmed(false);
    setMedirefModalOpen(true);
  }

  async function uploadToPraktikaAndUpdateIconForMediref() {
    if (!selectedDraft) return false;

    const finalPraktikaPatientId =
      selectedPraktikaPatientId || selectedDraft.praktika_patient_id || "";

    if (!finalPraktikaPatientId) {
      alert("Please select the correct Praktika patient first.");
      return false;
    }

    setCompleteStep("Uploading approved PDF to Praktika...");

    const uploadResponse = await fetch(
      "/api/report-writing/upload-to-praktika",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          praktikaPatientId: finalPraktikaPatientId,
        }),
      },
    );

    const uploadData = await uploadResponse.json();

    if (!uploadData.success) {
      alert(uploadData.error || "Failed to upload to Praktika.");
      console.error("Praktika upload error:", uploadData);
      return false;
    }

    setCompleteStep("Updating Praktika letter icon and queue item...");

    const iconResponse = await fetch(
      "/api/report-writing/update-praktika-letter-icons",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          queueId: activeQueueItemId,
          draftId: selectedDraft.id,
        }),
      },
    );

    const iconData = await iconResponse.json();

    if (!iconData.success) {
      console.warn("Praktika icon update skipped or failed:", iconData);
    }

    return true;
  }

  async function sendViaMedirefFromModal() {
    if (!selectedDraft) return;

    if (
      !medirefRecipientName.trim() &&
      !medirefRecipientPracticeName.trim() &&
      !medirefRecipientEmail.trim() &&
      !medirefRecipientProviderNumber.trim()
    ) {
      alert("Enter a referrer name, practice name, email, or provider number.");
      return;
    }

    if (
      medirefRecipientEmail.trim() &&
      hasInvalidEmail(medirefRecipientEmail)
    ) {
      alert("Please check the recipient email address.");
      return;
    }

    if (medirefPatientEmail.trim() && hasInvalidEmail(medirefPatientEmail)) {
      alert("Please check the patient email address.");
      return;
    }

    if (!medirefConfirmed) {
      alert("Please tick the confirmation checkbox.");
      return;
    }

    if (medirefCompleteWorkflow) {
      const alreadyDoneParts = [
        selectedDraftUploadedToPraktika ? "already uploaded to Praktika" : "",
        selectedDraftEmailed ? "already queued/sent through MediRef" : "",
      ].filter(Boolean);

      if (alreadyDoneParts.length > 0) {
        const continueAnyway = confirm(
          `This letter has ${alreadyDoneParts.join(" and ")}. Continue anyway?`,
        );

        if (!continueAnyway) return;
      }
    }

    setLoading(true);

    try {
      if (medirefCompleteWorkflow) {
        const uploaded = await uploadToPraktikaAndUpdateIconForMediref();

        if (!uploaded) return;
      }

      setCompleteStep(
        medirefCompleteWorkflow
          ? "Queuing MediRef send..."
          : "",
      );

      const response = await fetch("/api/report-writing/send-via-mediref", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          referrerName: medirefRecipientName.trim(),
          referrerPracticeName: medirefRecipientPracticeName.trim(),
          medirefAutoMatchRecipient,
          referrerEmail: medirefRecipientEmail.trim(),
          referrerProviderNumber: medirefRecipientProviderNumber.trim(),
          patientEmail: medirefPatientEmail.trim(),
          additionalRecipients: medirefAdditionalRecipients.map((recipient) => ({
            name: recipient.name,
            practiceName: recipient.practiceName,
            address: recipient.address,
          })),
          additionalRecipientsText: pdfCcText,
          message: medirefMessage,
          attachPeriodontalChart,
          praktikaPatientId:
            selectedPraktikaPatientId ||
            selectedDraft.praktika_patient_id ||
            null,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to queue MediRef send.");
        return;
      }

      const sentAt = new Date().toISOString();

      setSelectedDraft({
        ...selectedDraft,
        uploaded_to_praktika: medirefCompleteWorkflow
          ? true
          : selectedDraft.uploaded_to_praktika,
        uploaded_to_praktika_at: medirefCompleteWorkflow
          ? sentAt
          : selectedDraft.uploaded_to_praktika_at,
        emailed_to_referrer_at: sentAt,
        emailed_to_referrer_email:
          data.recipient ||
          medirefRecipientEmail.trim() ||
          medirefRecipientName.trim(),
        emailed_to_referrer_resend_id: data.jobId
          ? `mediref:${data.jobId}`
          : null,
      });

      if (medirefCompleteWorkflow) {
        setActiveQueueItemId(null);
        setCompleteStep("Complete.");
      }

      alert(
        `${medirefCompleteWorkflow ? "Workflow complete. " : ""}MediRef send queued.${
          attachPeriodontalChart
            ? data.periodontalChartAttached
              ? " Periodontal chart attached."
              : ` Periodontal chart was NOT attached: ${
                  data.periodontalChartError || "unknown reason"
                }`
            : ""
        }`,
      );

      setMedirefModalOpen(false);
      setMedirefConfirmed(false);
      setAttachPeriodontalChart(false);
      setMedirefCompleteWorkflow(false);
      setCompleteStep("");

      await loadDrafts(selectedProviderId);
      await loadQueue(selectedProviderId, queueStatusTab);
    } finally {
      setLoading(false);
    }
  }

  async function loadProviders() {
    const response = await fetch("/api/report-writing/get-providers");
    const data = await response.json();

    if (data.success) {
      setProviders(data.providers);

      if (data.providers.length > 0 && !selectedProviderId) {
        setSelectedProviderId(data.providers[0].id);
      }
    }
  }

  async function loadReportTypes(providerIdToLoad: string) {
    const response = await fetch(
      `/api/report-writing/correspondence-types?providerId=${providerIdToLoad}`,
    );

    const data = await response.json();

    if (data.success) {
      setReportTypes(data.types);

      if (
        data.types.length > 0 &&
        !data.types.some((type: ReportTypeOption) => type.value === reportType)
      ) {
        setReportType(data.types[0].value);
      }
    }
  }

  async function loadPreferredExamples(
    providerIdToLoad: string,
    reportTypeToLoad: string,
  ) {
    if (!providerIdToLoad || !reportTypeToLoad) {
      setPreferredExamples([]);
      return;
    }

    const params = new URLSearchParams();
    params.set("providerId", providerIdToLoad);
    params.set("reportType", reportTypeToLoad);

    const response = await fetch(
      `/api/report-writing/provider-examples-for-generation?${params.toString()}`,
    );

    const data = await response.json();

    if (data.success) {
      setPreferredExamples(data.examples || []);
    } else {
      console.error("Failed to load preferred examples:", data);
      setPreferredExamples([]);
    }
  }

  async function loadDrafts(providerId: string) {
    const response = await fetch(
      `/api/report-writing/get-drafts?providerId=${providerId}`,
    );

    const data = await response.json();

    if (data.success) {
      setDrafts(data.drafts);
    }
  }

  async function loadQueue(
    providerId: string,
    status: QueueStatusTab = queueStatusTab,
  ) {
    const params = new URLSearchParams();
    params.set("providerId", providerId);
    params.set("status", status);

    const response = await fetch(
      `/api/report-writing/letter-queue?${params.toString()}`,
    );

    const data = await response.json();

    if (data.success) {
      setQueue(data.queue);
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        window.URL.revokeObjectURL(pdfPreviewUrl);
      }
    };
  }, [pdfPreviewUrl]);

  useEffect(() => {
    loadProviders();
  }, []);

  useEffect(() => {
    if (selectedProviderId) {
      loadDrafts(selectedProviderId);
      loadReportTypes(selectedProviderId);
      loadQueue(selectedProviderId, queueStatusTab);
      clearForm();
      setSelectedDraftIds([]);
    }
  }, [selectedProviderId, queueStatusTab]);

  useEffect(() => {
    if (selectedProviderId && reportType) {
      loadPreferredExamples(selectedProviderId, reportType);
      setPreferredExampleId("");
    }
  }, [selectedProviderId, reportType]);

  useEffect(() => {
    if (!selectedDraft) return;

    const existingText =
      selectedDraft.edited_text || selectedDraft.ai_generated_text || "";

    const finalLetterTextForSave = getLetterTextForSave();

    if (finalLetterTextForSave === selectedDraft.edited_text) return;
    if (finalLetterTextForSave === lastAutosavedTextRef.current) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        setSaveStatus("saving");

        const response = await fetch("/api/report-writing/update-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: selectedDraft.id,
            editedText: finalLetterTextForSave,
            status: selectedDraft.status,
            learnFromEdits: false,
            learningSource: "typist_autosave",
          }),
        });

        const data = await response.json();

        if (!data.success) {
          console.error("Autosave failed:", data);
          setSaveStatus("error");
          return;
        }

        lastAutosavedTextRef.current = finalLetterTextForSave;
        setLastSavedAt(new Date().toISOString());
        setSaveStatus("saved");

        setSelectedDraft((current) =>
          current && current.id === selectedDraft.id
            ? { ...current, edited_text: finalLetterTextForSave }
            : current,
        );
      } catch (error) {
        console.error("Autosave error:", error);
        setSaveStatus("error");
      }
    }, 1500);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [letterText, pdfCcText, pdfLetterDate, selectedDraft]);


  useEffect(() => {
    if (!selectedDraft) return;

    const currentReferrerName = cleanString(referrerName);
    const currentReferrerAddress = cleanString(referrerAddress);
    const savedReferrerName = cleanString(selectedDraft.referrer_name);
    const savedReferrerAddress = cleanString(selectedDraft.referrer_address);

    if (
      currentReferrerName === savedReferrerName &&
      currentReferrerAddress === savedReferrerAddress
    ) {
      return;
    }

    if (referrerAutosaveTimerRef.current) {
      clearTimeout(referrerAutosaveTimerRef.current);
    }

    referrerAutosaveTimerRef.current = setTimeout(() => {
      persistCurrentReferrerDetails({ quiet: true });
    }, 700);

    return () => {
      if (referrerAutosaveTimerRef.current) {
        clearTimeout(referrerAutosaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraft?.id, referrerName, referrerAddress]);

  function clearForm() {
    setSelectedDraft(null);
    setActiveQueueItemId(null);
    setPatientFirstName("");
    setPatientLastName("");
    setPatientDob("");
    setPatientGender("neutral");
    setDobFocused(false);
    setReferrerName("");
    setReferrerAddress("");
    setLatestPraktikaReferral(null);
    setReferralAutoFillStatus("idle");
    setReportType("consultation_report");
    setPreferredExampleId("");
    setClinicalNotes("");
    setLetterText("");
    setGeneratedAiLetterText("");
    setPdfCcText("");
    setPdfLetterDate(new Date().toISOString().slice(0, 10));
    setAutoGenerateStatus("idle");
    setSaveStatus("idle");
    setLastSavedAt(null);
    lastAutosavedTextRef.current = "";
    setPraktikaCandidates([]);
    setSelectedPraktikaPatientId("");
    setAttachPeriodontalChart(false);
    setMedirefRecipientName("");
    setMedirefRecipientPracticeName("");
    setMedirefAutoMatchRecipient(true);
    setMedirefRecipientEmail("");
    setMedirefRecipientProviderNumber("");
    setMedirefAdditionalRecipients([]);
    setMedirefMessage("");
    setMedirefConfirmed(false);
    setImageDraftId(null);
    setImageDraftError(null);
    autoImageDraftQueueIdRef.current = null;
  }

  function selectDraft(draft: Draft) {
    const splitName = splitPatientName(draft.patient_name);

    setSelectedDraft(draft);
    setPatientFirstName(splitName.firstName);
    setPatientLastName(splitName.lastName);
    setPatientDob(draft.patient_dob || "");
    setPatientGender("neutral");
    setReferrerName(draft.referrer_name || "");
    setReferrerAddress(draft.referrer_address || "");
    setLatestPraktikaReferral(null);
    setReferralAutoFillStatus("idle");
    setReportType(draft.report_type);
    setPreferredExampleId("");

    // Do not clear the notes panel when opening an existing draft.
    // If the get-drafts API returns saved source notes, show them here.
    setClinicalNotes(getDraftClinicalNotes(draft));

    const savedLetterText = draft.edited_text || draft.ai_generated_text || "";
    setPdfCcText(extractPdfCcText(savedLetterText));
    setPdfLetterDate(
      extractPdfDateText(savedLetterText) ||
        new Date().toISOString().slice(0, 10),
    );
    setLetterText(stripPdfMarkers(savedLetterText));
    setGeneratedAiLetterText(stripPdfMarkers(draft.ai_generated_text || ""));
    setSaveStatus("saved");
    setLastSavedAt(draft.created_at || new Date().toISOString());
    lastAutosavedTextRef.current = savedLetterText;
    setAutoGenerateStatus("idle");
    setPraktikaCandidates([]);
    setSelectedPraktikaPatientId(draft.praktika_patient_id || "");
    setImageDraftId(draft.id);
    setImageDraftError(null);
    autoImageDraftQueueIdRef.current = null;
  }

  async function autoFillReferrerFromLatestPraktikaReferral(
    praktikaPatientId: string,
  ) {
    if (!praktikaPatientId) {
      console.warn("Auto-referrer lookup skipped: no Praktika patient ID", {
        activeQueueItemId,
        selectedDraftId: selectedDraft?.id,
        selectedDraftPraktikaPatientId: selectedDraft?.praktika_patient_id,
        patientName,
      });
      setLatestPraktikaReferral(null);
      setReferralAutoFillError("No Praktika patient ID is linked to this queue item or draft.");
      setReferralAutoFillStatus("not_found");
      return;
    }

    console.log("Auto-referrer lookup starting", {
      praktikaPatientId,
      activeQueueItemId,
      selectedDraftId: selectedDraft?.id,
      selectedDraftPraktikaPatientId: selectedDraft?.praktika_patient_id,
      patientName,
    });

    setLatestPraktikaReferral(null);
    setReferralAutoFillError("");
    setReferralAutoFillStatus("loading");

    try {
      const response = await fetch(
        "/api/report-writing/praktika-referrals/latest",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            patientId: praktikaPatientId,
          }),
        },
      );

      const text = await response.text();
      let data: any = {};

      try {
        data = text.trim() ? JSON.parse(text) : {};
      } catch {
        data = {
          success: false,
          error: `Referral API returned non-JSON response: ${text.slice(0, 300)}`,
        };
      }

      if (!response.ok || !data.success) {
        const message =
          data?.error ||
          `Referral API failed with status ${response.status}. Check the server logs.`;

        console.warn("Praktika referral lookup failed:", {
          status: response.status,
          data,
        });

        setReferralAutoFillError(message);
        setReferralAutoFillStatus("error");
        return;
      }

      console.log("Auto-referrer lookup response", data);

      const referral = data.referral as LatestPraktikaReferral | null;

      if (!referral?.referrerName) {
        setReferralAutoFillError(
          data?.debug?.message ||
            "No referral with a provider name was found for this patient.",
        );
        setReferralAutoFillStatus("not_found");
        return;
      }

      setReferrerName(referral.referrerName);

      if (referral.referrerAddress) {
        setReferrerAddress(referral.referrerAddress);
      }

      setLatestPraktikaReferral(referral);
      setReferralAutoFillError("");
      setReferralAutoFillStatus("found");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Praktika referral lookup failed.";

      console.error("Praktika referral lookup error:", error);
      setReferralAutoFillError(message);
      setReferralAutoFillStatus("error");
    }
  }

  async function startLetterFromQueue(item: QueueItem) {
    setAutoGenerateStatus("loading_notes");
    setSaveStatus("idle");
    setLastSavedAt(null);
    lastAutosavedTextRef.current = "";
    setActiveQueueItemId(item.id);
    setSelectedDraft(null);
    setImageDraftId(item.report_draft_id || null);
    setImageDraftError(null);
    autoImageDraftQueueIdRef.current = null;

    const firstName = item.patient_first_name || "";
    const lastName = item.patient_last_name || "";
    const dob = item.patient_dob || "";
    const linkedPraktikaPatientId = item.praktika_patient_id || "";
    const raw = item.raw_json || {};

    const appointmentId =
      item.appointment_id ||
      String(raw.iAppointmentId || raw.appointment_id || "").trim() ||
      null;

    setAutoGenerateStatus("selecting_report_type");

    const inferredReportType = inferReportTypeFromQueueItem(item, reportTypes);
    const appointmentNotes = getQueueClinicalNotes(item);
    const savedClinicalNotes = cleanString(item.source_clinical_notes);

    setPatientFirstName(firstName);
    setPatientLastName(lastName);
    setPatientDob(dob);
    setPatientGender(item.patient_gender || "neutral");
    setReferrerName(item.referrer_name || "");
    setReferrerAddress(item.referrer_address || "");
    setReportType(inferredReportType);
    setPreferredExampleId("");

    if (item.referrer_name || item.referrer_address) {
      setReferralAutoFillStatus("filled");
    } else {
      setReferralAutoFillStatus("idle");
    }

    if (savedClinicalNotes) {
      setClinicalNotes(savedClinicalNotes);
      setLetterText("");
      setGeneratedAiLetterText("");
      setPdfCcText("");
      setPdfLetterDate(new Date().toISOString().slice(0, 10));
      setPraktikaCandidates([]);
      setSelectedPraktikaPatientId(linkedPraktikaPatientId);
      setAutoGenerateStatus("ready");
    } else {
      const cachedClinicalNotes = cleanString(raw.cached_clinical_notes);

      if (cachedClinicalNotes) {
        const combinedCachedNotes = [
          appointmentNotes,
          "Same-day Praktika clinical notes:",
          cachedClinicalNotes,
        ]
          .filter(Boolean)
          .join("\n\n");

        setClinicalNotes(combinedCachedNotes);
        setLetterText("");
        setGeneratedAiLetterText("");
        setPdfCcText("");
        setPdfLetterDate(new Date().toISOString().slice(0, 10));
        setPraktikaCandidates([]);
        setSelectedPraktikaPatientId(linkedPraktikaPatientId);
        setAutoGenerateStatus("ready");
      } else {
        const initialClinicalNotes = [
          appointmentNotes,
          linkedPraktikaPatientId && item.appointment_time
            ? "Loading same-day Praktika clinical notes..."
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        setClinicalNotes(initialClinicalNotes);
        setLetterText("");
        setGeneratedAiLetterText("");
        setPdfCcText("");
        setPdfLetterDate(new Date().toISOString().slice(0, 10));
        setPraktikaCandidates([]);
        setSelectedPraktikaPatientId(linkedPraktikaPatientId);

        let sameDayClinicalNotes = "";

        if (linkedPraktikaPatientId && item.appointment_time) {
          try {
            sameDayClinicalNotes = await pullSameDayClinicalNotes({
              patientId: linkedPraktikaPatientId,
              appointmentDate: item.appointment_time.slice(0, 10),
              appointmentId,
            });

            if (sameDayClinicalNotes.trim()) {
              await fetch("/api/report-writing/letter-queue", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  queueId: item.id,
                  status: item.status === "completed" ? "completed" : "started",
                  cachedClinicalNotes: sameDayClinicalNotes,
                  cachedClinicalNotesSource: "praktika_live",
                }),
              });

              setQueue((current) =>
                current.map((queueItem) => {
                  if (queueItem.id !== item.id) return queueItem;

                  return {
                    ...queueItem,
                    status: item.status === "completed" ? "completed" : "started",
                    raw_json: {
                      ...(queueItem.raw_json || {}),
                      cached_clinical_notes: sameDayClinicalNotes,
                      cached_clinical_notes_source: "praktika_live",
                      cached_clinical_notes_at: new Date().toISOString(),
                    },
                  };
                }),
              );
            }
          } catch (error) {
            console.error("Failed to pull Praktika clinical notes:", error);

            const fallbackNotes = [
              appointmentNotes,
              "Same-day Praktika clinical notes could not be loaded. Praktika may be disconnected, refreshing, or waiting for MFA. Existing appointment notes have been preserved.",
            ]
              .filter(Boolean)
              .join("\n\n");

            setClinicalNotes(fallbackNotes);
            setAutoGenerateStatus("error");
          }
        }

        if (autoGenerateStatus !== "error") {
          const combinedClinicalNotes = [
            appointmentNotes,
            sameDayClinicalNotes ? "Same-day Praktika clinical notes:" : "",
            sameDayClinicalNotes,
          ]
            .filter(Boolean)
            .join("\n\n");

          setClinicalNotes(combinedClinicalNotes || appointmentNotes);
          setAutoGenerateStatus("ready");
        }
      }
    }
  }

  useEffect(() => {
    if (!activeQueueItemId) return;
    if (selectedDraft || imageDraftId || imageDraftCreating) return;
    if (!patientFirstName.trim() || !patientLastName.trim()) return;
    if (autoImageDraftQueueIdRef.current === activeQueueItemId) return;

    autoImageDraftQueueIdRef.current = activeQueueItemId;
    void ensureImageDraftForCurrentWork({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQueueItemId, selectedDraft?.id, imageDraftId, imageDraftCreating, patientFirstName, patientLastName]);

  async function updateQueueStatus(queueId: string, status: string) {
    await fetch("/api/report-writing/letter-queue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queueId,
        status,
      }),
    });
  }

  async function markQueueItemStarted(item: QueueItem) {
    await updateQueueStatus(item.id, "started");
    await loadQueue(selectedProviderId);
  }

  async function updatePraktikaLetterIconsForCurrentDraft() {
    if (!selectedDraft) return;

    const response = await fetch(
      "/api/report-writing/update-praktika-letter-icons",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          queueId: activeQueueItemId,
          draftId: selectedDraft.id,
        }),
      },
    );

    const data = await response.json();

    if (!data.success) {
      alert(
        data.error ||
          "Report was completed, but failed to update Praktika letter icons.",
      );
      return;
    }

    setActiveQueueItemId(null);
    await loadQueue(selectedProviderId, queueStatusTab);
  }

  function getPraktikaStatusMessage(status: string | null | undefined) {
    if (status === "connected") {
      return "Praktika is connected.";
    }

    if (status === "waiting_for_mfa") {
      return "Praktika is waiting for MFA.";
    }

    if (status === "waiting_for_credentials") {
      return "Praktika login is needed.";
    }

    if (status === "refresh_requested") {
      return "Praktika reconnect has been requested. Please wait for the local helper.";
    }

    if (status === "refreshing") {
      return "Praktika is currently reconnecting.";
    }

    if (status === "expired") {
      return "Praktika session has expired.";
    }

    if (status === "error") {
      return "Praktika connection has an error.";
    }

    if (status === "not_started") {
      return "Praktika has not been connected yet.";
    }

    return "Praktika is not connected.";
  }

  async function ensurePraktikaConnectedBeforeSync() {
    setPraktikaPreSyncMessage(null);

    try {
      const response = await fetch("/api/praktika/session/status?scope=user", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data) {
        const message =
          "Could not check Praktika connection. Click Manage, reconnect Praktika, then run the sync again.";

        setPraktikaNeedsReconnect(true);
        setShowPraktikaTools(true);
        setPraktikaPreSyncMessage(message);
        return false;
      }

      const status = String(data.status || "not_started");

      // IMPORTANT:
      // Helper-job syncs use the live local Playwright/Chrome helper browser.
      // They should NOT be blocked just because no copied Praktika cookie is
      // saved in Supabase. Praktika appears to reject copied-cookie requests
      // quickly, so "hasCookie" is no longer a reliable sync gate.
      if (status !== "connected") {
        const statusLabel = getPraktikaStatusMessage(status);
        const message = `${statusLabel} Click Manage, reconnect Praktika, then run the sync again.`;

        setPraktikaNeedsReconnect(true);
        setShowPraktikaTools(true);
        setPraktikaPreSyncMessage(message);
        return false;
      }

      setPraktikaNeedsReconnect(false);
      setPraktikaPreSyncMessage(null);
      return true;
    } catch (error) {
      console.error("Could not check Praktika session before sync:", error);

      const message =
        "Could not check Praktika connection. Click Manage, reconnect Praktika, then run the sync again.";

      setPraktikaNeedsReconnect(true);
      setShowPraktikaTools(true);
      setPraktikaPreSyncMessage(message);

      return false;
    }
  }

  async function syncPraktikaReferrers() {
    const canSync = await ensurePraktikaConnectedBeforeSync();

    if (!canSync) {
      return;
    }

    setPraktikaSyncingReferrers(true);

    try {
      const response = await fetch("/api/report-writing/referrers/sync-praktika", {
        method: "POST",
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const needsReconnect =
          response.status === 409 ||
          data?.needsPraktikaLogin ||
          String(data?.error || "")
            .toLowerCase()
            .includes("praktika");

        if (needsReconnect) {
          setPraktikaNeedsReconnect(true);
          setShowPraktikaTools(true);
          setPraktikaPreSyncMessage(
            data?.error ||
              "Praktika needs to be reconnected before referrers can be synced.",
          );
        }

        if (!needsReconnect) {
          alert(data?.error || "Failed to sync Praktika referrers.");
        }
        return;
      }

      setPraktikaNeedsReconnect(false);
      setPraktikaPreSyncMessage(
        `Referrers synced. Imported ${data.imported || 0} item(s).`,
      );

      alert(
        `Referrers synced. Imported ${data.imported || 0} item(s). Skipped ${
          data.skipped || 0
        }.`,
      );
    } catch (error) {
      console.error("Failed to sync Praktika referrers:", error);
      setPraktikaPreSyncMessage(
        error instanceof Error
          ? error.message
          : "Failed to sync Praktika referrers.",
      );
      alert(
        error instanceof Error
          ? error.message
          : "Failed to sync Praktika referrers.",
      );
    } finally {
      setPraktikaSyncingReferrers(false);
    }
  }

  async function syncQueueRange() {
    if (!queueFromDate || !queueToDate) {
      alert("Please select both a from date and a to date.");
      return;
    }

    if (queueFromDate > queueToDate) {
      alert("From date cannot be after to date.");
      return;
    }

    const rangeDays = getInclusiveDateRangeDays(queueFromDate, queueToDate);

    if (!rangeDays || rangeDays > 7) {
      alert("Please choose a queue sync range of 7 days or less.");
      return;
    }

    const canSync = await ensurePraktikaConnectedBeforeSync();

    if (!canSync) {
      return;
    }

    setPraktikaSyncingQueue(true);
    setLoading(true);
    setPraktikaPreSyncMessage(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, 180_000);

    try {
      const response = await fetch(
        "/api/report-writing/letter-queue/sync-praktika",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fromDate: queueFromDate,
            toDate: queueToDate,
          }),
          signal: controller.signal,
        },
      );

      const text = await response.text();
      let data: any = {};

      try {
        data = text.trim() ? JSON.parse(text) : {};
      } catch {
        data = {
          success: false,
          error: `Queue sync returned non-JSON: ${text.slice(0, 300)}`,
        };
      }

      if (!response.ok || !data.success) {
        const needsReconnect =
          response.status === 409 ||
          data?.needsPraktikaLogin ||
          String(data?.error || "")
            .toLowerCase()
            .includes("praktika");

        if (needsReconnect) {
          setPraktikaNeedsReconnect(true);
          setShowPraktikaTools(true);
          setPraktikaPreSyncMessage(
            data.error ||
              "Praktika needs to be reconnected before the queue can be synced.",
          );
        } else {
          setPraktikaPreSyncMessage(
            data.error || "Failed to sync letter queue.",
          );
          alert(data.error || "Failed to sync letter queue.");
        }

        return;
      }

      setPraktikaNeedsReconnect(false);
      setPraktikaPreSyncMessage(
        `Queue synced. ${data.queued || 0} item(s) found.`,
      );

      alert(`Queue synced. ${data.queued || 0} item(s) found.`);

      if (selectedProviderId) {
        await loadQueue(selectedProviderId);
      }
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Queue sync is taking too long. The helper may still be running in the background. Wait a minute, then refresh and check the queue."
          : error instanceof Error
            ? error.message
            : "Failed to sync letter queue.";

      setPraktikaPreSyncMessage(message);
      alert(message);
    } finally {
      window.clearTimeout(timeout);
      setPraktikaSyncingQueue(false);
      setLoading(false);
    }
  }

  function toggleDraftSelection(draftId: string) {
    setSelectedDraftIds((current) =>
      current.includes(draftId)
        ? current.filter((id) => id !== draftId)
        : [...current, draftId],
    );
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedDraftIds((current) =>
        current.filter((id) => !visibleDraftIds.includes(id)),
      );
    } else {
      setSelectedDraftIds((current) =>
        Array.from(new Set([...current, ...visibleDraftIds])),
      );
    }
  }

  async function generateLetter() {
    if (!selectedProviderId) {
      alert("Please select a provider first.");
      return;
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first name and last name are required.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProviderId,
          patientName,
          patientFirstName,
          patientDob,
          patientGender,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
          preferredExampleId: preferredExampleId || null,
        }),
      });

      const data = await response.json();

      // TEMPORARY DEBUGGING: this confirms exactly what the generation API used.
      // Open Chrome DevTools > Console, then generate a letter and inspect these logs.
      console.log("Generation response:", data);
      console.log("Generation debug:", data.debug);
      console.log("Clinical scenario:", data.clinicalScenario);
      console.log("Report type used:", data.debug?.reportType);
      console.log("Provider ID used:", data.debug?.providerId);
      console.log("Examples used:", data.debug?.examplesUsed);
      console.log("Selected examples:", data.debug?.selectedExamples);
      console.log("Scenario tags:", data.debug?.scenarioTags);
      console.log("Preferred example ID:", data.debug?.preferredExampleId);
      console.log("Patient gender used:", data.debug?.patientGender);
      console.log("Rules used:", data.debug?.rulesUsed);

      if (!data.success) {
        alert(data.error || "Failed to generate letter");
        return;
      }

      if (data.debug?.examplesUsed === "No provider-specific examples saved.") {
        alert(
          "Letter generated, but no provider-specific examples were loaded. Check the selected provider and report type.",
        );
      }

      setPdfCcText("");
      setLetterText(data.report);
      setGeneratedAiLetterText(data.report);
      setAutoGenerateStatus("ready");
    } finally {
      setLoading(false);
    }
  }

  async function saveNewDraft(
    status:
      | "draft"
      | "edited_by_typist"
      | "awaiting_provider_approval"
      | "approved" = "draft",
  ) {
    if (!selectedProviderId) {
      alert("Please select a provider first.");
      return;
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first name and last name are required.");
      return;
    }

    if (!letterText.trim()) {
      alert("Generate or write a letter first.");
      return;
    }

    if (status === "approved") {
      const confirmed = confirm(
        "Approve this letter now? Any edits made to the AI-generated text will be included for provider-specific learning.",
      );

      if (!confirmed) return;
    }

    const finalLetterTextForSave = getLetterTextForSave();
    const originalAiText = generatedAiLetterText || finalLetterTextForSave;
    const finalApprovedText = finalLetterTextForSave;
    const hasEditedAiText =
      Boolean(generatedAiLetterText.trim()) &&
      generatedAiLetterText.trim() !== finalLetterTextForSave.trim();

    setLoading(true);

    try {
      if (imageDraftId) {
        const response = await fetch("/api/report-writing/update-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: imageDraftId,
            editedText: finalLetterTextForSave,
            status,
            referrerName,
            referrerAddress,
            patientName,
            patientDob,
            reportType,
            clinicalNotes,
            originalAiText,
            finalApprovedText,
            praktikaPatientId: selectedPraktikaPatientId || null,
            learnFromEdits: status === "approved" && hasEditedAiText,
            learningSource: "typist_image_workspace_final_save",
          }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || !data.success) {
          alert(data.error || "Failed to save letter");
          return;
        }

        alert(
          status === "approved"
            ? "Letter approved."
            : status === "awaiting_provider_approval"
              ? "Letter sent to provider approval."
              : "Draft saved for provider.",
        );

        if (activeQueueItemId) {
          await fetch("/api/report-writing/letter-queue", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              queueId: activeQueueItemId,
              status: "completed",
              reportDraftId: imageDraftId,
            }),
          });

          setActiveQueueItemId(null);
          await loadQueue(selectedProviderId, queueStatusTab);
        }

        setSaveStatus("saved");
        setLastSavedAt(new Date().toISOString());

        await loadDrafts(selectedProviderId);
        clearForm();
        return;
      }

      const response = await fetch("/api/report-writing/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProviderId,
          patientName,
          patientDob,
          patientGender,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
          generatedReport: originalAiText,
          editedText: finalApprovedText,
          finalApprovedText,
          originalAiText,
          learnFromEdits: status === "approved" && hasEditedAiText,
          learningSource: "typist_direct_approval",
          praktikaPatientId: selectedPraktikaPatientId || null,
          queueId: activeQueueItemId,
          status,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        alert(data.error || "Failed to save letter");
        return;
      }

      alert(
        status === "approved"
          ? "Letter approved."
          : status === "awaiting_provider_approval"
            ? "Letter sent to provider approval."
            : "Draft saved for provider.",
      );

      if (activeQueueItemId) {
        await fetch("/api/report-writing/letter-queue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            queueId: activeQueueItemId,
            status: "completed",
            reportDraftId: data.draft?.id || data.draftId || data.id,
          }),
        });

        setActiveQueueItemId(null);
        await loadQueue(selectedProviderId, queueStatusTab);
      }

      setSaveStatus("saved");
      setLastSavedAt(new Date().toISOString());

      await loadDrafts(selectedProviderId);
      clearForm();
    } finally {
      setLoading(false);
    }
  }

  async function updateExistingDraft(status: string) {
    if (!selectedDraft) return;

    const finalLetterTextForSave = getLetterTextForSave();

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          editedText: finalLetterTextForSave,
          status,
          referrerName,
          referrerAddress,
          patientName,
          patientDob,
          reportType,
          clinicalNotes,
          originalAiText:
            selectedDraft.ai_generated_text || generatedAiLetterText,
          finalApprovedText: finalLetterTextForSave,
          learnFromEdits:
            status === "approved" &&
            Boolean(
              (
                selectedDraft.ai_generated_text ||
                generatedAiLetterText ||
                ""
              ).trim(),
            ) &&
            (
              selectedDraft.ai_generated_text ||
              generatedAiLetterText ||
              ""
            ).trim() !== finalLetterTextForSave.trim(),
          learningSource: "typist_existing_draft_approval",
        }),
      });

      const data = await response.json();

      if (!data.success) {
        alert(data.error || "Failed to update draft");
        return;
      }

      alert("Draft updated.");
      setSaveStatus("saved");
      setLastSavedAt(new Date().toISOString());
      lastAutosavedTextRef.current = finalLetterTextForSave;
      await loadDrafts(selectedProviderId);

      setSelectedDraft({
        ...selectedDraft,
        patient_name: patientName,
        patient_dob: patientDob,
        referrer_name: referrerName || null,
        referrer_address: referrerAddress || null,
        report_type: reportType,
        edited_text: finalLetterTextForSave,
        ai_generated_text:
          selectedDraft.ai_generated_text || generatedAiLetterText,
        status,
      });
    } finally {
      setLoading(false);
    }
  }

  async function deleteDraftById(draftId: string) {
    const response = await fetch("/api/report-writing/delete-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to delete draft");
    }
  }

  async function deleteSelectedDraft() {
    if (!selectedDraft) return;

    const confirmed = confirm(
      `Delete this temporary letter for ${
        selectedDraft.patient_name || "this patient"
      }?`,
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      await deleteDraftById(selectedDraft.id);
      alert("Letter deleted.");
      await loadDrafts(selectedProviderId);
      clearForm();
      setSelectedDraftIds((current) =>
        current.filter((id) => id !== selectedDraft.id),
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete letter");
    } finally {
      setLoading(false);
    }
  }

  async function deleteCheckedDrafts() {
    if (selectedDraftIds.length === 0) {
      alert("Select at least one letter to delete.");
      return;
    }

    const confirmed = confirm(
      `Delete ${selectedDraftIds.length} selected letter(s)? This cannot be undone.`,
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      for (const draftId of selectedDraftIds) {
        await deleteDraftById(draftId);
      }

      alert("Selected letters deleted.");
      await loadDrafts(selectedProviderId);

      if (selectedDraft && selectedDraftIds.includes(selectedDraft.id)) {
        clearForm();
      }

      setSelectedDraftIds([]);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Failed to delete selected letters",
      );
    } finally {
      setLoading(false);
    }
  }

  async function generatePdf(draft: Draft) {
    setLoading(true);

    try {
      if (selectedDraft?.id === draft.id) {
        const persisted = await persistCurrentReferrerDetails({ quiet: false });

        if (!persisted) {
          alert("Could not save the referrer details before generating the PDF. Please try again.");
          return;
        }
      }

      const response = await fetch("/api/report-writing/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = "Failed to generate PDF";

        try {
          const parsed = JSON.parse(errorText);
          errorMessage = parsed.error || errorMessage;
        } catch {
          if (errorText.trim()) {
            errorMessage = errorText.slice(0, 500);
          }
        }

        console.error("Generate PDF failed:", errorMessage);
        alert(errorMessage);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const fileName = getFilenameFromResponse(
        response,
        `${safeFileName(draft.patient_name)} Letter.pdf`,
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }


  async function previewPdf(draft: Draft) {
    setLoading(true);

    try {
      if (selectedDraft?.id === draft.id) {
        const persisted = await persistCurrentReferrerDetails({ quiet: false });

        if (!persisted) {
          alert("Could not save the referrer details before previewing the PDF. Please try again.");
          return;
        }
      }

      const response = await fetch("/api/report-writing/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = "Failed to generate PDF preview";

        try {
          const parsed = JSON.parse(errorText);
          errorMessage = parsed.error || errorMessage;
        } catch {
          if (errorText.trim()) {
            errorMessage = errorText.slice(0, 500);
          }
        }

        console.error("Preview PDF failed:", errorMessage);
        alert(errorMessage);
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      if (pdfPreviewUrl) {
        window.URL.revokeObjectURL(pdfPreviewUrl);
      }

      setPdfPreviewTitle(
        getFilenameFromResponse(
          response,
          `${safeFileName(draft.patient_name)} Letter.pdf`,
        ),
      );
      setPdfPreviewUrl(url);
      setPdfPreviewModalOpen(true);
    } finally {
      setLoading(false);
    }
  }

  async function bulkGenerateApprovedPdfs() {
    const selectedDrafts = drafts.filter((draft) =>
      selectedDraftIds.includes(draft.id),
    );

    const approvedDrafts = selectedDrafts.filter(
      (draft) => draft.status === "approved",
    );

    if (approvedDrafts.length === 0) {
      alert("Select at least one approved letter to bulk generate PDFs.");
      return;
    }

    setLoading(true);

    try {
      const zip = new JSZip();

      for (const draft of approvedDrafts) {
        const response = await fetch("/api/report-writing/generate-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: draft.id }),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to generate PDF for ${draft.patient_name || "patient"}`,
          );
        }

        const blob = await response.blob();
        const fileName = getFilenameFromResponse(
          response,
          `${safeFileName(draft.patient_name)} Letter.pdf`,
        );

        zip.file(fileName, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(zipBlob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `branded_letters_${new Date()
        .toISOString()
        .slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Failed to bulk generate PDFs.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function persistPraktikaPatientMatch(praktikaPatientId: string | null) {
    setSelectedPraktikaPatientId(praktikaPatientId || "");

    if (!selectedDraft) return;

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          praktikaPatientId: praktikaPatientId || null,
          learnFromEdits: false,
          learningSource: "typist_praktika_match",
        }),
      });

      const data = await response.json();

      if (!data.success) {
        alert(data.error || "Failed to save Praktika patient match.");
        return;
      }

      setSelectedDraft((current) =>
        current && current.id === selectedDraft.id
          ? { ...current, praktika_patient_id: praktikaPatientId || null }
          : current,
      );

      setDrafts((current) =>
        current.map((draft) =>
          draft.id === selectedDraft.id
            ? { ...draft, praktika_patient_id: praktikaPatientId || null }
            : draft,
        ),
      );
    } catch (error) {
      console.error("Failed to save Praktika patient match:", error);
      alert("Failed to save Praktika patient match.");
    }
  }

  async function searchPraktikaPatientMatch() {
    if (!patientName.trim()) {
      alert("Patient name is required before matching.");
      return;
    }

    setMatchingPatient(true);
    setPraktikaCandidates([]);
    setSelectedPraktikaPatientId("");

    try {
      const response = await fetch(
        "/api/report-writing/match-praktika-patient",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            patientName,
            patientDob,
          }),
        },
      );

      const data = await response.json();

      if (!data.success) {
        alert(data.error || "Failed to search Praktika.");
        return;
      }

      setPraktikaCandidates(data.candidates || []);

      if ((data.candidates || []).length === 1) {
        await persistPraktikaPatientMatch(data.candidates[0].id);
      }
    } finally {
      setMatchingPatient(false);
    }
  }

  async function uploadToPraktika() {
    if (!selectedDraft) return;

    if (!["approved", "uploaded_to_praktika"].includes(selectedDraft.status)) {
      alert("Only approved reports can be uploaded to Praktika.");
      return;
    }

    const finalPraktikaPatientId =
      selectedPraktikaPatientId || selectedDraft.praktika_patient_id || "";

    if (!finalPraktikaPatientId) {
      alert("Please search and select the correct Praktika patient first.");
      return;
    }

    const confirmed = confirm(
      `Upload this approved report to Praktika patient ID ${finalPraktikaPatientId}?`,
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/upload-to-praktika", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          praktikaPatientId: finalPraktikaPatientId,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        alert(data.error || "Failed to upload to Praktika.");
        console.error("Praktika upload error:", data);
        return;
      }

      alert(
        "Report uploaded to Praktika communications. You can now email the encrypted PDF.",
      );
      await updatePraktikaLetterIconsForCurrentDraft();

      setSelectedDraft({
        ...selectedDraft,
        uploaded_to_praktika: true,
        uploaded_to_praktika_at: new Date().toISOString(),
      });

      await loadDrafts(selectedProviderId);
      await loadQueue(selectedProviderId, queueStatusTab);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="grid h-screen grid-cols-12 bg-slate-100">
        <div className="col-span-2 overflow-y-auto border-r bg-white">
          <div className="border-b p-4">
            <h1 className="text-2xl font-bold text-slate-950">Typist Portal</h1>
            <p className="mt-1 text-sm text-slate-500">
              Queue, approve, export, upload, and send letters via MediRef.
            </p>

            <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <label className="text-xs font-bold uppercase tracking-wider text-blue-900">
                Selected provider
              </label>
              <select
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className="mt-2 w-full rounded-xl border border-blue-300 bg-white p-3 text-sm font-semibold text-blue-950 shadow-sm"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>

              <div className="mt-2 text-xs text-blue-800">
                {selectedProvider?.typist_letters_require_approval === false
                  ? "Typist can approve this provider's letters."
                  : "Provider approval required before final upload/email."}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                window.location.href = "/report-writing/history";
              }}
              className="mt-4 w-full rounded-2xl border bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              History / Archive
            </button>
          </div>
        </div>

        <div className="col-span-4 overflow-y-auto border-r bg-slate-50">
          <div className="border-b bg-white p-4">
            <h2 className="font-semibold">
              {selectedProvider?.name || "Provider"} Letters
            </h2>

            <button
              onClick={clearForm}
              className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
            >
              New Letter
            </button>

            <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
              {[
                ["queue", `Queue (${queue.length})`],
                ["awaiting", `Awaiting Approval (${countAwaiting})`],
                ["completed", `Approved (${countCompleted})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setListTab(key as ListTab);
                    setSelectedDraftIds([]);
                  }}
                  className={[
                    "rounded-xl px-3 py-2 text-xs font-bold transition",
                    listTab === key && key === "awaiting"
                      ? "bg-white text-amber-800 shadow-sm"
                      : listTab === key && key === "completed"
                        ? "bg-white text-green-800 shadow-sm"
                        : listTab === key
                          ? "bg-white text-blue-800 shadow-sm"
                          : "text-slate-600 hover:text-slate-950",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            {listTab !== "queue" ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                    />
                    Select all visible
                  </label>

                  <button
                    onClick={deleteCheckedDrafts}
                    disabled={loading || selectedDraftIds.length === 0}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Delete selected ({selectedDraftIds.length})
                  </button>
                </div>

                <button
                  onClick={bulkGenerateApprovedPdfs}
                  disabled={loading || selectedDraftIds.length === 0}
                  className="w-full rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Bulk Generate Branded PDFs
                </button>
              </div>
            ) : null}
          </div>

          {listTab === "queue" ? (
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    "active",
                    "queued",
                    "started",
                    "completed",
                  ] as QueueStatusTab[]
                ).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setQueueStatusTab(status)}
                    className={[
                      "rounded-xl border px-3 py-2 text-xs font-semibold",
                      queueStatusTab === status
                        ? "border-blue-600 bg-blue-50 text-blue-900"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {getQueueStatusLabel(status)}
                  </button>
                ))}
              </div>

              {queue.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No {getQueueStatusLabel(queueStatusTab).toLowerCase()} queue
                  items.
                </div>
              ) : null}

              {queue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={async () => {
                    if (item.status === "completed") return;

                    await startLetterFromQueue(item);
                    await markQueueItemStarted(item);
                  }}
                  className={[
                    "w-full rounded-xl border bg-white p-3 text-left",
                    item.status === "completed"
                      ? "cursor-default opacity-90"
                      : "hover:bg-slate-50",
                    activeQueueItemId === item.id
                      ? "border-blue-600 ring-2 ring-blue-100"
                      : "border-slate-200",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">
                        {[item.patient_first_name, item.patient_last_name]
                          .filter(Boolean)
                          .join(" ") || "Unnamed patient"}
                      </div>

                      <div className="text-sm text-slate-500">
                        DOB: {item.patient_dob || "Not available"}
                      </div>

                      <div className="text-xs text-slate-400">
                        {item.appointment_time
                          ? new Date(item.appointment_time).toLocaleString(
                              "en-AU",
                            )
                          : "No appointment time"}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        {item.queue_reason || "Typist Letter"}
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                          Suggested:{" "}
                          {getSuggestedReportTypeLabel(item, reportTypes)}
                        </span>

                        {getQueueBadges(item).map((badge) => (
                          <span
                            key={badge.label}
                            className={[
                              "rounded-full px-2 py-1 text-xs font-semibold",
                              badge.className,
                            ].join(" ")}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>

                      {item.praktika_patient_id ? (
                        <div className="mt-1 text-xs font-semibold text-indigo-600">
                          Praktika patient linked: {item.praktika_patient_id}
                        </div>
                      ) : null}
                    </div>

                    <div
                      className={[
                        "rounded-full px-2 py-1 text-xs font-semibold",
                        item.status === "queued"
                          ? "bg-blue-100 text-blue-700"
                          : item.status === "started"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700",
                      ].join(" ")}
                    >
                      {item.status === "completed" ? "sent" : item.status}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {filteredDrafts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                  No letters in this list.
                </div>
              ) : null}

              {filteredDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className={[
                    "rounded-xl border bg-white p-3 hover:bg-slate-50",
                    selectedDraft?.id === draft.id
                      ? "border-blue-600"
                      : "border-slate-200",
                  ].join(" ")}
                >
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={selectedDraftIds.includes(draft.id)}
                      onChange={() => toggleDraftSelection(draft.id)}
                      className="mt-1"
                    />

                    <button
                      type="button"
                      onClick={() => selectDraft(draft)}
                      className="flex-1 text-left"
                    >
                      <div className="font-semibold">
                        {draft.patient_name || "Unnamed patient"}
                      </div>

                      <div className="text-sm text-slate-500">
                        {draft.report_type}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        {draft.status}
                      </div>

                      {draft.emailed_to_referrer_at ? (
                        <div className="mt-1 text-xs font-semibold text-emerald-600">
                          Emailed to{" "}
                          {draft.emailed_to_referrer_email || "referrer"}
                        </div>
                      ) : null}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col-span-6 flex flex-col bg-white">
          <div className="border-b p-4">
            <h2 className="text-xl font-bold">
              {selectedDraft ? "Edit Existing Letter" : "Create New Letter"}
            </h2>

            <p className="text-sm text-slate-500">
              Provider: {selectedProvider?.name || "None selected"}
            </p>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div
                className={[
                  "rounded-xl border px-3 py-2 text-xs font-semibold",
                  autoGenerateStatus === "ready"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : autoGenerateStatus === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : ["loading_notes", "selecting_report_type"].includes(
                            autoGenerateStatus,
                          )
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-slate-50 text-slate-600",
                ].join(" ")}
              >
                {getAutoGenerateStatusLabel()}
              </div>

              <div
                className={[
                  "rounded-xl border px-3 py-2 text-xs font-semibold",
                  saveStatus === "saved"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : saveStatus === "saving"
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : saveStatus === "error"
                        ? "border-red-200 bg-red-50 text-red-700"
                        : saveStatus === "unsaved"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-slate-50 text-slate-600",
                ].join(" ")}
              >
                {getSaveStatusLabel()}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input
                className="rounded-xl border p-3"
                placeholder="Patient First Name"
                value={patientFirstName}
                onChange={(e) => setPatientFirstName(e.target.value)}
              />

              <input
                className="rounded-xl border p-3"
                placeholder="Patient Last Name"
                value={patientLastName}
                onChange={(e) => setPatientLastName(e.target.value)}
              />

              <div className="relative">
                {!patientDob && !dobFocused ? (
                  <div className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 bg-white pr-2 text-slate-400">
                    Patient DOB
                  </div>
                ) : null}

                <input
                  className={[
                    "w-full rounded-xl border p-3",
                    !patientDob && !dobFocused
                      ? "text-transparent"
                      : "text-slate-900",
                  ].join(" ")}
                  type="date"
                  value={patientDob}
                  onFocus={() => setDobFocused(true)}
                  onBlur={() => setDobFocused(false)}
                  onChange={(e) => setPatientDob(e.target.value)}
                />
              </div>

              <select
                className="rounded-xl border p-3"
                value={patientGender}
                onChange={(e) =>
                  setPatientGender(e.target.value as PatientGender)
                }
              >
                <option value="neutral">Gender/pronouns: Neutral</option>
                <option value="female">Gender/pronouns: Female</option>
                <option value="male">Gender/pronouns: Male</option>
              </select>

              <select
                className="rounded-xl border p-3"
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                {reportTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              <div className="space-y-2 md:col-span-2">
                <ReferrerSearchBox
                  onSelect={(referrer) => {
                    setReferrerName(referrer.name);
                    setReferrerAddress(formatManualReferrerAddress(referrer));
                    setReferralAutoFillError("");
                    setReferralAutoFillStatus("found");
                  }}
                />

                {referralAutoFillStatus === "loading" ? (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    Looking for the most recent Praktika referral...
                  </div>
                ) : null}

                {referralAutoFillStatus === "found" &&
                latestPraktikaReferral ? (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Auto-filled from most recent Praktika referral:{" "}
                    {latestPraktikaReferral.referrerName}
                    {latestPraktikaReferral.referralDate
                      ? ` (${latestPraktikaReferral.referralDate})`
                      : ""}
                  </div>
                ) : null}

                {referralAutoFillStatus === "not_found" ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    {referralAutoFillError ||
                      "No Praktika referral found. Use manual referrer search."}
                  </div>
                ) : null}

                {referralAutoFillStatus === "error" ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Could not auto-fill from Praktika. Use manual referrer
                    search.
                    {referralAutoFillError ? (
                      <div className="mt-1 font-mono text-[11px] text-amber-900">
                        {referralAutoFillError}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Selected referrer
                  </div>

                  {referrerName || referrerAddress ? (
                    <div className="mt-2 whitespace-pre-line leading-6 text-slate-800">
                      {[referrerName, referrerAddress].filter(Boolean).join("\n")}
                    </div>
                  ) : (
                    <div className="mt-2 text-slate-500">
                      Search and select a referrer.
                    </div>
                  )}
                </div>

                {selectedDraft?.typist_instructions?.trim() ? (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-sm font-black text-amber-900">
                        !
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-amber-950">
                          Provider instructions for typist
                        </div>
                        <div className="mt-1 text-xs text-amber-700">
                          Internal action notes only — do not include this text in the letter.
                        </div>
                        <div className="mt-3 whitespace-pre-line rounded-xl border border-amber-200 bg-white p-3 leading-6 text-amber-950">
                          {selectedDraft.typist_instructions}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {!selectedDraft ? (
              <>
                <textarea
                  className="h-40 w-full rounded-xl border p-4"
                  placeholder="Paste clinical notes here..."
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                />

                <button
                  onClick={generateLetter}
                  disabled={loading}
                  className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  {loading ? "Working..." : "Generate Letter From Notes"}
                </button>
              </>
            ) : null}

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    Letter text
                  </div>
                  <div className="text-xs text-slate-500">
                    Highlight words and click Bold. Bold text will appear bold
                    in the final PDF.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleBoldSelectedText}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
                >
                  Bold selected text
                </button>
              </div>

              <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-blue-950">
                      Place an image in the letter
                    </div>
                    <div className="mt-1 text-xs text-blue-800">
                      Click in the letter where the image should appear, then choose an image number.
                      Image size, crop and alignment are still controlled in the image panel below.
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6].map((imageNumber) => (
                      <button
                        key={imageNumber}
                        type="button"
                        onClick={() => insertImagePlaceholder(imageNumber)}
                        className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-blue-800 shadow-sm ring-1 ring-blue-200 hover:bg-blue-100"
                      >
                        Insert Image {imageNumber}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="mb-4 block rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-bold text-slate-950">
                  PDF letter date
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  This date will appear at the top of the generated PDF letter.
                </div>
                <input
                  type="date"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
                  value={pdfLetterDate}
                  onChange={(e) => setPdfLetterDate(e.target.value)}
                />
              </label>

              <textarea
                ref={letterTextareaRef}
                className="h-96 w-full rounded-xl border p-4"
                placeholder="Letter text..."
                value={letterText}
                onChange={(e) => handleLetterTextChange(e.target.value)}
              />

              <label className="mt-4 block rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                <div className="text-sm font-bold text-indigo-950">
                  PDF cc line after signature, optional
                </div>
                <div className="mt-1 text-xs text-indigo-900">
                  Search for a referrer to add a CC line, or type/edit the CC text manually.
                  The PDF will show this under the signature as italic.
                </div>
                <div className="mt-3">
                  <ReferrerSearchBox
                    onSelect={(referrer) => {
                      const name = cleanString(referrer?.name);
                      const address = formatManualReferrerAddress(referrer);
                      const entry = [name, address].filter(Boolean).join("\n");

                      if (!entry.trim()) return;

                      setPdfCcText((current) =>
                        current.trim() ? `${current.trim()}\n${entry}` : entry,
                      );
                    }}
                  />
                </div>
                <textarea
                  className="mt-2 h-28 w-full rounded-xl border border-indigo-200 bg-white p-3 text-sm"
                  placeholder={"Dr Smith\nBrisbane Dental Clinic\n111 Brisbane Rd, Brisbane."}
                  value={pdfCcText}
                  onChange={(e) => setPdfCcText(e.target.value)}
                />
              </label>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950">Images for this letter</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload images before or after the formal draft is saved. When you are working
                    from the queue, a temporary draft workspace is prepared automatically so images
                    can be attached straight away.
                  </p>
                </div>

                {!currentImageDraftId ? (
                  <button
                    type="button"
                    onClick={() => ensureImageDraftForCurrentWork()}
                    disabled={imageDraftCreating || loading}
                    className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {imageDraftCreating ? "Preparing..." : "Enable image uploads"}
                  </button>
                ) : null}
              </div>

              {imageDraftError ? (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {imageDraftError}
                </div>
              ) : null}

              {imageDraftCreating ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
                  Preparing image upload workspace...
                </div>
              ) : currentImageDraftId ? (
                <DraftImagePanel reportDraftId={currentImageDraftId} />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  Select a queue item or enter patient details, then click Enable image uploads.
                  You do not need to manually save the letter first.
                </div>
              )}
            </section>

            {selectedDraft ? (
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-950">
                      Workflow checklist
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Next step: {getNextWorkflowAction()}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    <span
                      className={[
                        "rounded-full px-3 py-1",
                        selectedDraft.status === "approved"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700",
                      ].join(" ")}
                    >
                      {selectedDraft.status === "approved"
                        ? "Approved"
                        : "Needs approval"}
                    </span>

                    <span
                      className={[
                        "rounded-full px-3 py-1",
                        selectedDraftHasPraktikaPatient
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600",
                      ].join(" ")}
                    >
                      {selectedDraftHasPraktikaPatient
                        ? "Praktika linked"
                        : "No Praktika match"}
                    </span>

                    <span
                      className={[
                        "rounded-full px-3 py-1",
                        selectedDraftUploadedToPraktika
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600",
                      ].join(" ")}
                    >
                      {selectedDraftUploadedToPraktika
                        ? "Uploaded"
                        : "Not uploaded"}
                    </span>

                    <span
                      className={[
                        "rounded-full px-3 py-1",
                        selectedDraftEmailed
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600",
                      ].join(" ")}
                    >
                      {selectedDraftEmailed ? "Emailed" : "Not emailed"}
                    </span>
                  </div>
                </div>
              </section>
            ) : null}

            {selectedDraft?.emailed_to_referrer_at ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="font-bold">Email sent via Mediref</div>
                <div className="mt-1">
                  To: {selectedDraft.emailed_to_referrer_email || "Referrer"}
                </div>
                <div>
                  Sent:{" "}
                  {new Date(
                    selectedDraft.emailed_to_referrer_at,
                  ).toLocaleString("en-AU")}
                </div>
                {selectedDraft.emailed_to_referrer_resend_id ? (
                  <div className="text-xs text-emerald-700">
                    Resend ID: {selectedDraft.emailed_to_referrer_resend_id}
                  </div>
                ) : null}
              </section>
            ) : null}

            {selectedDraftCanComplete && selectedPraktikaPatientId ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="font-bold">Praktika patient already linked</div>
                <div className="mt-1">
                  Patient ID: {selectedPraktikaPatientId}
                </div>
                <button
                  type="button"
                  onClick={() => persistPraktikaPatientMatch(null)}
                  className="mt-3 rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-800"
                >
                  Clear and search again
                </button>
              </section>
            ) : null}

            {selectedDraftCanComplete && !selectedPraktikaPatientId ? (
              <section className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                <div>
                  <h3 className="text-lg font-bold text-indigo-950">
                    Praktika Patient Match
                  </h3>
                  <p className="text-sm text-indigo-900">
                    Search using the entered patient name and DOB, then select
                    the correct patient before uploading.
                  </p>
                </div>

                <button
                  onClick={searchPraktikaPatientMatch}
                  disabled={matchingPatient || loading}
                  className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  {matchingPatient
                    ? "Searching Praktika..."
                    : "Search Praktika Patient Match"}
                </button>

                {praktikaCandidates.length > 0 ? (
                  <div className="space-y-2">
                    {praktikaCandidates.map((candidate) => (
                      <label
                        key={candidate.id}
                        className={[
                          "block cursor-pointer rounded-xl border bg-white p-3",
                          selectedPraktikaPatientId === candidate.id
                            ? "border-indigo-600 ring-2 ring-indigo-200"
                            : "border-slate-200",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="praktikaPatient"
                            checked={selectedPraktikaPatientId === candidate.id}
                            onChange={() =>
                              persistPraktikaPatientMatch(candidate.id)
                            }
                            className="mt-1"
                          />

                          <div>
                            <div className="font-semibold">
                              {candidate.firstName} {candidate.lastName}
                            </div>
                            <div className="text-sm text-slate-600">
                              DOB: {candidate.dob || "Not shown"} | Praktika ID:{" "}
                              {candidate.id}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {candidate.matchReason}
                            </div>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-indigo-300 bg-white p-4 text-sm text-indigo-900">
                    No patient candidates loaded yet.
                  </div>
                )}
              </section>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3 border-t bg-white p-4">
            {!selectedDraft ? (
              <>
                <button
                  onClick={() => saveNewDraft("draft")}
                  disabled={loading}
                  className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Save Draft
                </button>

                <button
                  onClick={() => saveNewDraft("approved")}
                  disabled={loading}
                  className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Typist Approval
                </button>

                <button
                  onClick={() => saveNewDraft("awaiting_provider_approval")}
                  disabled={loading}
                  className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Send to Provider For Approval
                </button>
              </>
            ) : (
              <>
                {selectedDraft.status !== "approved" ? (
                  <>
                    <button
                      onClick={() => updateExistingDraft("approved")}
                      disabled={loading}
                      className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      Typist Approval
                    </button>

                    <button
                      onClick={() =>
                        updateExistingDraft("awaiting_provider_approval")
                      }
                      disabled={loading}
                      className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      Send to Provider For Approval
                    </button>
                  </>
                ) : null}

                {selectedDraftCanComplete ? (
                  <>
                    <button
                      onClick={() => previewPdf(selectedDraft)}
                      disabled={loading}
                      className="rounded-xl bg-slate-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      Preview PDF
                    </button>

                    <button
                      onClick={() => generatePdf(selectedDraft)}
                      disabled={loading}
                      className="rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      {loading ? "Generating PDF..." : "Download PDF"}
                    </button>

                    <button
                      onClick={uploadToPraktika}
                      disabled={loading || !selectedPraktikaPatientId}
                      className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      {selectedDraftUploadedToPraktika
                        ? "Upload Again To Praktika"
                        : "Upload Approved PDF To Praktika"}
                    </button>
                  </>
                ) : null}

                <button
                  onClick={() => openMedirefModal()}
                  disabled={loading || !selectedDraftCanComplete}
                  className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  {selectedDraft.emailed_to_referrer_at
                    ? "Send Again Via MediRef"
                    : "Send Via MediRef"}
                </button>

                <button
                  onClick={() => openMedirefModal({ completeWorkflow: true })}
                  disabled={
                    loading ||
                    !selectedDraftCanComplete ||
                    !selectedDraftHasPraktikaPatient
                  }
                  className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Complete: Upload + Send Via MediRef
                </button>

                <button
                  onClick={deleteSelectedDraft}
                  disabled={loading}
                  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Delete Letter
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
        <button
          type="button"
          onClick={() => setShowMedirefTools(true)}
          className="rounded-full bg-emerald-600 px-6 py-4 text-sm font-bold text-white shadow-2xl hover:bg-emerald-700"
        >
          MediRef tools
        </button>

        <button
          type="button"
          onClick={() => setShowPraktikaTools(true)}
          className="rounded-full bg-slate-950 px-6 py-4 text-sm font-bold text-white shadow-2xl hover:bg-slate-800"
        >
          Praktika tools
        </button>
      </div>

      <MedirefToolsPopup
        open={showMedirefTools}
        onOpenChange={setShowMedirefTools}
      />

      <PraktikaToolsPopup
        open={showPraktikaTools}
        onOpenChange={setShowPraktikaTools}
        queueFromDate={queueFromDate}
        queueToDate={queueToDate}
        onQueueFromDateChange={setQueueFromDate}
        onQueueToDateChange={setQueueToDate}
        onSyncQueue={syncQueueRange}
        onSyncReferrers={syncPraktikaReferrers}
        loadingQueue={praktikaSyncingQueue}
        loadingReferrers={praktikaSyncingReferrers}
        message={praktikaPreSyncMessage}
        needsReconnect={praktikaNeedsReconnect}
      />

      {completeModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">
                Complete Letter: Upload + Email
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Confirm the details below. This will upload the approved PDF to
                Praktika, email the encrypted PDF to the referrer, and complete
                the workflow. If this letter was not generated from the queue,
                the Praktika appointment icon step will be skipped.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="text-xs font-semibold uppercase text-slate-500">
                  Patient
                </div>
                <div className="mt-1 font-semibold text-slate-950">
                  {selectedDraft?.patient_name ||
                    patientName ||
                    "Unnamed patient"}
                </div>
                <div className="mt-1 text-slate-600">
                  DOB/password:{" "}
                  {selectedDraft?.patient_dob || patientDob || "Not entered"}{" "}
                  converted to DDMMYYYY
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="text-xs font-semibold uppercase text-slate-500">
                  Praktika patient
                </div>
                <div className="mt-1 font-semibold text-slate-950">
                  {selectedPraktikaPatientId ||
                    selectedDraft?.praktika_patient_id ||
                    "No patient linked"}
                </div>
                <div className="mt-1 text-slate-600">
                  This patient ID will be used for the Praktika upload.
                </div>
              </div>
            </div>

            {!activeQueueItemId ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="font-semibold">Manual/non-queue letter</div>
                <div className="mt-1">
                  No queue appointment is linked to this letter, so the Praktika
                  appointment icon update will be skipped. The PDF upload and
                  secure email will still proceed.
                </div>
              </div>
            ) : null}

            {selectedDraftUploadedToPraktika || selectedDraftEmailed ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <div className="font-semibold">Duplicate action warning</div>
                <div className="mt-1">
                  {selectedDraftUploadedToPraktika
                    ? "This letter has already been uploaded to Praktika. "
                    : ""}
                  {selectedDraftEmailed
                    ? "This letter has already been emailed. "
                    : ""}
                  Continuing will repeat one or more completion actions.
                </div>
              </div>
            ) : null}

            <div className="mt-4 space-y-4">
              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Referrer email address
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailRecipient}
                  onChange={(e) => {
                    setSecureEmailRecipient(e.target.value);
                    setCompleteConfirmed(false);
                  }}
                  placeholder="referrer@example.com"
                />
                {secureEmailPreviewLoading ? (
                  <div className="mt-1 text-xs text-slate-500">
                    Looking up referrer email...
                  </div>
                ) : null}
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  CC email address(es), optional
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailCc}
                  onChange={(e) => {
                    setSecureEmailCc(e.target.value);
                    setCompleteConfirmed(false);
                  }}
                  placeholder="second.referrer@example.com, practice@example.com"
                />
                <div className="mt-1 text-xs text-slate-500">
                  Separate multiple CC addresses with commas.
                </div>
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Subject
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailSubject}
                  onChange={(e) => setSecureEmailSubject(e.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Email text
                </div>
                <textarea
                  className="h-32 w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailBody}
                  onChange={(e) => setSecureEmailBody(e.target.value)}
                />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <input
                  type="checkbox"
                  checked={attachPeriodontalChart}
                  disabled={
                    !(
                      selectedPraktikaPatientId ||
                      selectedDraft?.praktika_patient_id
                    )
                  }
                  onChange={(e) => setAttachPeriodontalChart(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">
                    Attach periodontal chart
                  </span>
                  <br />
                  Optional. Leave unticked for short update letters. This is
                  only available when a Praktika patient is linked.
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <input
                  type="checkbox"
                  checked={completeConfirmed}
                  onChange={(e) => setCompleteConfirmed(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I have checked the patient, Praktika patient ID, referrer
                  email address, and email text. I understand the attached PDF
                  will be encrypted using the patient DOB in DDMMYYYY format.
                </span>
              </label>

              {completeStep ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
                  {completeStep}
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setCompleteModalOpen(false);
                  setCompleteConfirmed(false);
                  setAttachPeriodontalChart(false);
                  setCompleteStep("");
                }}
                disabled={loading}
                className="rounded-xl border px-5 py-3 font-semibold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={completeUploadAndEmailFromModal}
                disabled={
                  loading ||
                  !completeConfirmed ||
                  !secureEmailRecipient.includes("@") ||
                  hasInvalidEmail(secureEmailCc) ||
                  !(
                    selectedPraktikaPatientId ||
                    selectedDraft?.praktika_patient_id
                  )
                }
                className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                {loading ? "Completing..." : "Upload + Email + Complete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}


      {pdfPreviewModalOpen && pdfPreviewUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Preview PDF</h2>
                <p className="text-sm text-slate-500">{pdfPreviewTitle}</p>
              </div>

              <div className="flex gap-2">
                <a
                  href={pdfPreviewUrl}
                  download={pdfPreviewTitle}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setPdfPreviewModalOpen(false);
                    if (pdfPreviewUrl) {
                      window.URL.revokeObjectURL(pdfPreviewUrl);
                    }
                    setPdfPreviewUrl(null);
                  }}
                  className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
                >
                  Close
                </button>
              </div>
            </div>

            <iframe
              title="PDF preview"
              src={pdfPreviewUrl}
              className="h-full w-full flex-1 bg-slate-100"
            />
          </div>
        </div>
      ) : null}


      {medirefModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">
                Send via MediRef
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                This will queue the branded PDF for the Mac Mini MediRef helper.
                The helper will attach the PDF and send it through the shared
                practice MediRef session.
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div>
                  <span className="font-semibold">Patient:</span>{" "}
                  {selectedDraft?.patient_name || patientName || "Not selected"}
                </div>
                <div>
                  <span className="font-semibold">DOB:</span>{" "}
                  {selectedDraft?.patient_dob || patientDob || "Not entered"}
                </div>
                <div>
                  <span className="font-semibold">Report:</span>{" "}
                  {reportTypes.find((type) => type.value === selectedDraft?.report_type)?.label ||
                    reportTypes.find((type) => type.value === reportType)?.label ||
                    selectedDraft?.report_type ||
                    reportType}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                <div className="font-semibold">Automatic MediRef recipient matching</div>
                <p className="mt-1 text-sm">
                  The Mac Mini helper will search the MediRef directory using the referrer name and practice name below, then select the best matching directory result before attaching the PDF.
                </p>
              </div>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Referrer name
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={medirefRecipientName}
                  onChange={(event) => {
                    setMedirefRecipientName(event.target.value);
                    setMedirefConfirmed(false);
                  }}
                  placeholder="Dr Smith"
                />
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Practice name
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={medirefRecipientPracticeName}
                  onChange={(event) => {
                    setMedirefRecipientPracticeName(event.target.value);
                    setMedirefConfirmed(false);
                  }}
                  placeholder="Practice name from the selected referrer"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Pulled from the first line of the saved referrer address. You can edit it if MediRef uses a slightly different practice name.
                </p>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={medirefAutoMatchRecipient}
                  onChange={(event) => {
                    setMedirefAutoMatchRecipient(event.target.checked);
                    setMedirefConfirmed(false);
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">Match recipient in MediRef automatically</span>
                  <br />
                  Searches by referrer name first, then practice name if needed.
                </span>
              </label>

              <details className="rounded-xl border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">
                  Optional manual fallback details
                </summary>

                <div className="mt-3 space-y-4">
                  <label className="block">
                    <div className="mb-1 text-sm font-semibold text-slate-700">
                      Recipient email, optional
                    </div>
                    <input
                      className="w-full rounded-xl border border-slate-300 p-3"
                      value={medirefRecipientEmail}
                      onChange={(event) => {
                        setMedirefRecipientEmail(event.target.value);
                        setMedirefConfirmed(false);
                      }}
                      placeholder="referrer@example.com"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-1 text-sm font-semibold text-slate-700">
                      MediRef provider number, optional
                    </div>
                    <input
                      className="w-full rounded-xl border border-slate-300 p-3"
                      value={medirefRecipientProviderNumber}
                      onChange={(event) => {
                        setMedirefRecipientProviderNumber(event.target.value);
                        setMedirefConfirmed(false);
                      }}
                      placeholder="Provider number if known"
                    />
                  </label>
                </div>
              </details>

              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div>
                  <div className="text-sm font-semibold text-slate-700">
                    Additional MediRef recipient(s)
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    These are searched in MediRef as extra recipients. The list is prefilled from the PDF CC field when possible.
                  </p>
                </div>

                <ReferrerSearchBox
                  onSelect={(referrer) => addMedirefAdditionalRecipient(referrer)}
                />

                {medirefAdditionalRecipients.length > 0 ? (
                  <div className="space-y-2">
                    {medirefAdditionalRecipients.map((recipient) => (
                      <div
                        key={recipient.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">
                            {recipient.name}
                          </div>
                          {recipient.practiceName ? (
                            <div className="text-xs text-slate-500">
                              {recipient.practiceName}
                            </div>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            removeMedirefAdditionalRecipient(recipient.id)
                          }
                          className="text-xs font-semibold text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                    No additional MediRef recipients selected.
                  </div>
                )}
              </div>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Cc to the patient, optional
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={medirefPatientEmail}
                  onChange={(event) => {
                    setMedirefPatientEmail(event.target.value);
                    setMedirefConfirmed(false);
                  }}
                  placeholder="patient@example.com"
                />
                <p className="mt-1 text-xs text-slate-500">
                  This fills the patient email field in MediRef. It is separate from doctor/referrer CC recipients.
                </p>
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Message
                </div>
                <textarea
                  className="h-32 w-full rounded-xl border border-slate-300 p-3"
                  value={medirefMessage}
                  onChange={(event) => setMedirefMessage(event.target.value)}
                />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <input
                  type="checkbox"
                  checked={attachPeriodontalChart}
                  disabled={
                    !(selectedPraktikaPatientId || selectedDraft?.praktika_patient_id)
                  }
                  onChange={(event) => setAttachPeriodontalChart(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">Attach periodontal chart</span>
                  <br />
                  Optional. Only available when a Praktika patient is linked.
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <input
                  type="checkbox"
                  checked={medirefConfirmed}
                  onChange={(event) => setMedirefConfirmed(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  I have checked the patient, recipient/referrer, additional recipients, patient email, and attachments before sending via MediRef.
                </span>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setMedirefModalOpen(false);
                  setMedirefConfirmed(false);
                  setAttachPeriodontalChart(false);
                }}
                disabled={loading}
                className="rounded-xl border px-5 py-3 font-semibold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
  type="button"
  onClick={sendViaMedirefFromModal}
  disabled={loading || !medirefConfirmed}
  className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
>
  {loading ? (medirefCompleteWorkflow ? "Completing..." : "Queuing...") : medirefCompleteWorkflow ? "Complete Workflow + Queue MediRef Send" : "Queue MediRef Send"}
</button>
            </div>
          </div>
        </div>
      ) : null}

      {secureEmailModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">
                Confirm Secure Email
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Check the referrer email address and edit the message before
                sending the password-protected PDF.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Referrer email address
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailRecipient}
                  onChange={(e) => {
                    setSecureEmailRecipient(e.target.value);
                    setSecureEmailConfirmed(false);
                  }}
                  placeholder="referrer@example.com"
                />
                {secureEmailPreviewLoading ? (
                  <div className="mt-1 text-xs text-slate-500">
                    Looking up referrer email...
                  </div>
                ) : null}
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  CC email address(es), optional
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailCc}
                  onChange={(e) => {
                    setSecureEmailCc(e.target.value);
                    setSecureEmailConfirmed(false);
                  }}
                  placeholder="second.referrer@example.com, practice@example.com"
                />
                <div className="mt-1 text-xs text-slate-500">
                  Separate multiple CC addresses with commas.
                </div>
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Subject
                </div>
                <input
                  className="w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailSubject}
                  onChange={(e) => setSecureEmailSubject(e.target.value)}
                />
              </label>

              <label className="block">
                <div className="mb-1 text-sm font-semibold text-slate-700">
                  Email text
                </div>
                <textarea
                  className="h-36 w-full rounded-xl border border-slate-300 p-3"
                  value={secureEmailBody}
                  onChange={(e) => setSecureEmailBody(e.target.value)}
                />
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <input
                  type="checkbox"
                  checked={attachPeriodontalChart}
                  disabled={
                    !(
                      selectedPraktikaPatientId ||
                      selectedDraft?.praktika_patient_id
                    )
                  }
                  onChange={(e) => setAttachPeriodontalChart(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">
                    Attach periodontal chart
                  </span>
                  <br />
                  Optional. Leave unticked for short update letters. This is
                  only available when a Praktika patient is linked.
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <input
                  type="checkbox"
                  checked={secureEmailConfirmed}
                  onChange={(e) => setSecureEmailConfirmed(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  I have checked that this email address is correct for the
                  intended referrer.
                </span>
              </label>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                The attached PDF password will be the patient DOB in DDMMYYYY
                format.
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setSecureEmailModalOpen(false);
                  setAttachPeriodontalChart(false);
                }}
                disabled={loading}
                className="rounded-xl border px-5 py-3 font-semibold text-slate-700 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={sendSecureEmailFromModal}
                disabled={
                  loading ||
                  !secureEmailConfirmed ||
                  !secureEmailRecipient.includes("@") ||
                  hasInvalidEmail(secureEmailCc)
                }
                className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send Secure Email"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
