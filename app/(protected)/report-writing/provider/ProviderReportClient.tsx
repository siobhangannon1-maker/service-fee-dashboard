"use client";

import { useEffect, useMemo, useState } from "react";
import ReferrerSearchBox from "@/components/report-writing/ReferrerSearchBox";
import OpenAIDictationBox from "@/components/report-writing/OpenAIDictationBox";
import SmartDictateBox from "@/components/report-writing/SmartDictateBox";
import RichTextLetterEditor from "@/components/report-writing/RichTextLetterEditor";
import ProviderSimpleImageUpload from "@/components/report-writing/ProviderSimpleImageUpload";
import ProviderTypistSmsBox from "@/components/report-writing/ProviderTypistSmsBox";

type ReportTypeOption = {
  value: string;
  label: string;
};

type Draft = {
  id: string;
  patient_name: string | null;
  patient_dob: string | null;
  referrer_name: string | null;
  referrer_address: string | null;
  report_type: string;
  edited_text: string | null;
  ai_generated_text: string | null;
  status: string;
  created_at: string;
  provider_approved_at?: string | null;
  uploaded_to_praktika?: boolean | null;
  uploaded_to_praktika_at?: string | null;
  emailed_to_referrer_at?: string | null;
  emailed_to_referrer_email?: string | null;
  praktika_patient_id?: string | null;
  typist_instructions?: string | null;
  typist_queries?: string | null;
  source_type?: LetterSourceType | string | null;
};

type ProviderReportClientProps = {
  providerId: string;
};

type LetterSourceType = "dictation" | "smart_dictation" | "clinical_notes";

function isLetterSourceType(value: unknown): value is LetterSourceType {
  return (
    value === "dictation" ||
    value === "smart_dictation" ||
    value === "clinical_notes"
  );
}

function sourceTypeToTab(sourceType: LetterSourceType): ActiveTab {
  if (sourceType === "smart_dictation") return "smart";
  if (sourceType === "clinical_notes") return "notes";
  return "dictate";
}

type PatientGender = "male" | "female" | "neutral";

type PatientAndReferrerFieldsProps = {
  patientFirstName: string;
  setPatientFirstName: (value: string) => void;
  patientLastName: string;
  setPatientLastName: (value: string) => void;
  patientDob: string;
  setPatientDob: (value: string) => void;
  patientGender: PatientGender;
  setPatientGender: (value: PatientGender) => void;
  reportType: string;
  setReportType: (value: string) => void;
  reportTypes: ReportTypeOption[];
  referrerName: string;
  setReferrerName: (value: string) => void;
  referrerAddress: string;
  setReferrerAddress: (value: string) => void;
  typistInstructions: string;
  setTypistInstructions: (value: string) => void;
  typistQueriesForProvider?: string | null;
};

type ActiveTab =
  | "drafts"
  | "smart"
  | "dictate"
  | "notes"
  | "approval"
  | "approved";

type SidebarView = "drafts" | "approval" | "approved";

const DOB_MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function expandDobYear(value: string) {
  const numericYear = Number(value);

  if (value.length === 4) {
    return numericYear;
  }

  const currentYear = new Date().getFullYear();
  const currentTwoDigitYear = currentYear % 100;

  return numericYear <= currentTwoDigitYear
    ? 2000 + numericYear
    : 1900 + numericYear;
}

function formatDobAsIso(day: number, month: number, year: number) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return null;
  }

  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const candidate = new Date(year, month - 1, day);

  const isValidDate =
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day;

  if (!isValidDate) {
    return null;
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (candidate > today) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parsePastedDob(rawValue: string) {
  const value = rawValue
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!value) {
    return null;
  }

  // ISO format, including a date copied from another date field.
  const isoMatch = value.match(/(?:^|\D)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
  if (isoMatch) {
    return formatDobAsIso(
      Number(isoMatch[3]),
      Number(isoMatch[2]),
      Number(isoMatch[1]),
    );
  }

  // Australian numeric formats: DD/MM/YYYY, DD-MM-YYYY or DD.MM.YYYY.
  const numericMatch = value.match(
    /(?:^|\D)(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\D|$)/,
  );
  if (numericMatch) {
    return formatDobAsIso(
      Number(numericMatch[1]),
      Number(numericMatch[2]),
      expandDobYear(numericMatch[3]),
    );
  }

  // Written formats: 1 Feb 1980, 1 February 1980, or 1st Feb 1980.
  const writtenMatch = value.match(
    /(?:^|\D)(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]{3,9})\.?[,]?\s+(\d{2}|\d{4})(?:\D|$)/i,
  );
  if (writtenMatch) {
    const month = DOB_MONTHS[writtenMatch[2].toLowerCase()];

    if (month) {
      return formatDobAsIso(
        Number(writtenMatch[1]),
        month,
        expandDobYear(writtenMatch[3]),
      );
    }
  }

  return null;
}

function PatientAndReferrerFields({
  patientFirstName,
  setPatientFirstName,
  patientLastName,
  setPatientLastName,
  patientDob,
  setPatientDob,
  patientGender,
  setPatientGender,
  reportType,
  setReportType,
  reportTypes,
  referrerName,
  setReferrerName,
  referrerAddress,
  setReferrerAddress,
  typistInstructions,
  setTypistInstructions,
  typistQueriesForProvider,
}: PatientAndReferrerFieldsProps) {
  const [dobFocused, setDobFocused] = useState(false);
  const [dobPasteError, setDobPasteError] = useState("");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <input
        className="rounded-xl border border-slate-300 p-3"
        placeholder="Patient First Name"
        value={patientFirstName}
        onChange={(e) => setPatientFirstName(e.target.value)}
      />

      <input
        className="rounded-xl border border-slate-300 p-3"
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
            dobPasteError ? "border-red-400" : "border-slate-300",
            !patientDob && !dobFocused ? "text-transparent" : "text-slate-900",
          ].join(" ")}
          type="date"
          value={patientDob}
          onFocus={() => setDobFocused(true)}
          onBlur={() => setDobFocused(false)}
          onChange={(e) => {
            setDobPasteError("");
            setPatientDob(e.target.value);
          }}
          onPaste={(event) => {
            const pastedText = event.clipboardData.getData("text");
            const parsedDob = parsePastedDob(pastedText);

            event.preventDefault();

            if (!parsedDob) {
              setDobPasteError(
                "Could not recognise that DOB. Try DD/MM/YYYY, DD-MM-YYYY or 1 Feb 1980.",
              );
              return;
            }

            setDobPasteError("");
            setPatientDob(parsedDob);
          }}
          aria-invalid={Boolean(dobPasteError)}
          aria-describedby={dobPasteError ? "patient-dob-error" : undefined}
          title="Choose a date or paste a DOB such as 01/02/1980"
        />

        {dobPasteError ? (
          <p id="patient-dob-error" className="mt-1 text-xs text-red-600">
            {dobPasteError}
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            You can choose a date or paste a DOB such as 01/02/1980.
          </p>
        )}
      </div>

      <select
        className="rounded-xl border border-slate-300 p-3"
        value={patientGender}
        onChange={(e) => setPatientGender(e.target.value as PatientGender)}
      >
        <option value="neutral">Gender/pronouns: Neutral</option>
        <option value="female">Gender/pronouns: Female</option>
        <option value="male">Gender/pronouns: Male</option>
      </select>

      <select
        className="rounded-xl border border-slate-300 p-3"
        value={reportType}
        onChange={(e) => setReportType(e.target.value)}
      >
        {reportTypes.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>

      <ReferrerSearchBox
        selectedName={referrerName}
        selectedAddress={referrerAddress}
        onClear={() => {
          setReferrerName("");
          setReferrerAddress("");
        }}
        onSelect={(referrer) => {
          setReferrerName(referrer.name);
          setReferrerAddress(formatManualReferrerAddress(referrer));
        }}
      />

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 md:col-span-2">
        <label className="block text-xs font-bold uppercase tracking-wide text-amber-800">
          Typist instructions
        </label>
        <p className="mt-1 text-xs text-amber-700">
          Internal notes only. These will show on the typist page but will not
          be included in the letter.
        </p>
        <textarea
          className="mt-3 h-28 w-full rounded-xl border border-amber-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
          placeholder="Examples: attach PA X-Ray, attach periodontal chart, cc to Dr John Smith..."
          value={typistInstructions}
          onChange={(e) => setTypistInstructions(e.target.value)}
        />
      </div>

      {typistQueriesForProvider?.trim() ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 md:col-span-2">
          <div className="text-xs font-bold uppercase tracking-wide text-sky-900">
            Queries from typist
          </div>
          <p className="mt-1 text-xs text-sky-700">
            Internal notes from the typist for provider review. These are not
            included in the final letter.
          </p>
          <div className="mt-3 whitespace-pre-line rounded-xl border border-sky-200 bg-white p-3 text-sm leading-6 text-sky-950">
            {typistQueriesForProvider}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";

  try {
    return new Date(value).toLocaleString("en-AU");
  } catch {
    return value;
  }
}

const REPORT_TYPE_LABEL_OVERRIDES: Record<string, string> = {
  SPT_report: "SPT Report",
  spt_report: "SPT Report",
  consultation_report: "Consultation Report",
  Consultation_report: "Consultation Report",
};

function formatReportType(value: string | null | undefined) {
  const text = String(value || "").trim();

  if (!text) return "Letter";

  if (REPORT_TYPE_LABEL_OVERRIDES[text]) {
    return REPORT_TYPE_LABEL_OVERRIDES[text];
  }

  const acronymWords = new Set(["SPT", "CBCT", "OPG", "PA", "TMJ", "IV", "LA"]);

  return text
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      const upperWord = word.toUpperCase();
      if (acronymWords.has(upperWord)) return upperWord;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatReportTypeOptions(types: ReportTypeOption[]) {
  return types.map((type) => ({
    ...type,
    label: formatReportType(type.label || type.value),
  }));
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function TrashBinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4.5 w-4.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7L18.132 19.142C18.058 20.173 17.199 21 16.165 21H7.835C6.801 21 5.942 20.173 5.868 19.142L5 7M10 11V17M14 11V17M4 7H20M9 7V4C9 3.448 9.448 3 10 3H14C14.552 3 15 3.448 15 4V7"
      />
    </svg>
  );
}

function getReportText(draft: Draft | null) {
  return draft?.edited_text || draft?.ai_generated_text || "";
}

function learningWillBeSaved(draft: Draft | null) {
  if (!draft) return false;

  const original = String(draft.ai_generated_text || "").trim();
  const final = String(draft.edited_text || "").trim();

  return Boolean(original && final && original !== final);
}

function formatManualReferrerAddress(referrer: any) {
  const practiceName = String(
    referrer?.practice_name ||
      referrer?.practiceName ||
      referrer?.clinic_name ||
      referrer?.clinicName ||
      referrer?.practice ||
      referrer?.raw_json?.vchClinic ||
      "",
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


function inferDraftSourceType(draft: Draft | null): LetterSourceType {
  const sourceType = String(draft?.source_type || "").trim();

  if (
    sourceType === "dictation" ||
    sourceType === "smart_dictation" ||
    sourceType === "clinical_notes"
  ) {
    return sourceType;
  }

  if (draft?.report_type === "dictated_letter") {
    return "dictation";
  }

  return "clinical_notes";
}

async function readJsonSafely(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return { success: false, error: "Empty server response." };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: "Server returned non-JSON response.",
      preview: text.slice(0, 500),
    };
  }
}

export default function ProviderReportClient({
  providerId,
}: ProviderReportClientProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("drafts");
  const [sidebarView, setSidebarView] = useState<SidebarView>("drafts");

  const [reportTypes, setReportTypes] = useState<ReportTypeOption[]>([
    { value: "consultation_report", label: "Consultation Report" },
  ]);

  const [patientFirstName, setPatientFirstName] = useState("");
  const [patientLastName, setPatientLastName] = useState("");
  const [patientDob, setPatientDob] = useState("");
  const [patientGender, setPatientGender] = useState<PatientGender>("neutral");
  const [referrerName, setReferrerName] = useState("");
  const [referrerAddress, setReferrerAddress] = useState("");
  const [reportType, setReportType] = useState("consultation_report");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [generatedReport, setGeneratedReport] = useState("");
  const [originalGeneratedReport, setOriginalGeneratedReport] = useState("");
  const [dictatedLetter, setDictatedLetter] = useState("");
  const [typistInstructions, setTypistInstructions] = useState("");

  const [letterDrafts, setLetterDrafts] = useState<Draft[]>([]);
  const [approvalDrafts, setApprovalDrafts] = useState<Draft[]>([]);
  const [approvedDrafts, setApprovedDrafts] = useState<Draft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [selectedApprovalDraft, setSelectedApprovalDraft] =
    useState<Draft | null>(null);
  const [selectedApprovedDraft, setSelectedApprovedDraft] =
    useState<Draft | null>(null);
  const [draftSearch, setDraftSearch] = useState("");
  const [recordingState, setRecordingState] = useState<
    "idle" | "recording" | "paused" | "saving"
  >("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [loading, setLoading] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [savedToastTitle, setSavedToastTitle] = useState("Letter saved");
  const [savedToastText, setSavedToastText] = useState("");
  const [approvalSearch, setApprovalSearch] = useState("");
  const [approvedSearch, setApprovedSearch] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const [defaultLetterSource, setDefaultLetterSource] =
    useState<LetterSourceType>("dictation");
  const [preferenceLoading, setPreferenceLoading] = useState(true);
  const [preferenceSaving, setPreferenceSaving] = useState(false);

  const patientName = `${patientFirstName} ${patientLastName}`.trim();

  const filteredLetterDrafts = useMemo(() => {
    const query = draftSearch.trim().toLowerCase();
    if (!query) return letterDrafts;

    return letterDrafts.filter((draft) => {
      return [draft.patient_name, draft.referrer_name, draft.report_type]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [letterDrafts, draftSearch]);

  const filteredApprovalDrafts = useMemo(() => {
    const query = approvalSearch.trim().toLowerCase();
    if (!query) return approvalDrafts;

    return approvalDrafts.filter((draft) => {
      return [draft.patient_name, draft.referrer_name, draft.report_type]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [approvalDrafts, approvalSearch]);

  const filteredApprovedDrafts = useMemo(() => {
    const query = approvedSearch.trim().toLowerCase();
    if (!query) return approvedDrafts;

    return approvedDrafts.filter((draft) => {
      return [draft.patient_name, draft.referrer_name, draft.report_type]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [approvedDrafts, approvedSearch]);

  async function loadProviderLetterPreference() {
    setPreferenceLoading(true);

    try {
      const response = await fetch(
        `/api/report-writing/provider-letter-preference?providerId=${encodeURIComponent(providerId)}`,
        { cache: "no-store" },
      );

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        console.error(
          "Could not load provider letter preference:",
          data.error || "Unknown error",
        );
        return;
      }

      if (isLetterSourceType(data.defaultLetterSource)) {
        setDefaultLetterSource(data.defaultLetterSource);
      }
    } catch (error) {
      console.error("Could not load provider letter preference:", error);
    } finally {
      setPreferenceLoading(false);
    }
  }

  async function saveProviderLetterPreference(
    nextPreference: LetterSourceType,
  ) {
    const previousPreference = defaultLetterSource;

    setDefaultLetterSource(nextPreference);
    setPreferenceSaving(true);

    try {
      const response = await fetch(
        "/api/report-writing/provider-letter-preference",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerId,
            defaultLetterSource: nextPreference,
          }),
        },
      );

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        setDefaultLetterSource(previousPreference);
        alert(data.error || "Could not save the default letter method.");
        return;
      }

      showSavedConfirmation(
        "Default method saved",
        `${data.label || "Letter method"} will open for each new letter.`,
      );
    } catch (error) {
      console.error("Could not save provider letter preference:", error);
      setDefaultLetterSource(previousPreference);
      alert("Could not save the default letter method.");
    } finally {
      setPreferenceSaving(false);
    }
  }

  async function loadReportTypes() {
    const response = await fetch(
      `/api/report-writing/correspondence-types?providerId=${providerId}`,
    );

    const data = await readJsonSafely(response);

    if (data.success) {
      setReportTypes(formatReportTypeOptions(data.types || []));

      if (
        data.types?.length > 0 &&
        !data.types.some((type: ReportTypeOption) => type.value === reportType)
      ) {
        setReportType(data.types[0].value);
      }
    }
  }

  async function loadDrafts() {
    const response = await fetch(
      `/api/report-writing/get-drafts?providerId=${providerId}`,
    );

    const data = await readJsonSafely(response);

    if (data.success) {
      const drafts: Draft[] = data.drafts || [];

      setLetterDrafts(
        drafts.filter((draft: Draft) => draft.status === "draft"),
      );

      setApprovalDrafts(
        drafts.filter(
          (draft: Draft) => draft.status === "awaiting_provider_approval",
        ),
      );

      setApprovedDrafts(
        drafts.filter(
          (draft: Draft) =>
            draft.status === "approved" &&
            !Boolean(draft.emailed_to_referrer_at),
        ),
      );
    }
  }

  useEffect(() => {
    loadDrafts();
    loadReportTypes();
    loadProviderLetterPreference();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  useEffect(() => {
    if (recordingState !== "recording") return;

    const timer = window.setInterval(() => {
      setRecordingSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [recordingState]);

  function validatePatientName() {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first name and last name are required.");
      return false;
    }

    return true;
  }

  function showSavedConfirmation(title: string, message: string) {
    setSavedToastTitle(title);
    setSavedToastText(message);
    setShowSavedToast(true);

    window.setTimeout(() => {
      setShowSavedToast(false);
    }, 4500);
  }

  function clearGeneratedForm() {
    setGeneratedReport("");
    setOriginalGeneratedReport("");
    setClinicalNotes("");
  }

  function resetLetterEditor() {
    setPatientFirstName("");
    setPatientLastName("");
    setPatientDob("");
    setPatientGender("neutral");
    setReferrerName("");
    setReferrerAddress("");
    setReportType(reportTypes[0]?.value || "consultation_report");
    setClinicalNotes("");
    setGeneratedReport("");
    setOriginalGeneratedReport("");
    setDictatedLetter("");
    setTypistInstructions("");
    setSelectedDraft(null);
  }

  function loadDraftIntoEditor(draft: Draft) {
    const splitName = splitPatientName(draft.patient_name);

    setSelectedDraft(draft);
    setPatientFirstName(splitName.firstName);
    setPatientLastName(splitName.lastName);
    setPatientDob(draft.patient_dob || "");
    setReferrerName(draft.referrer_name || "");
    setReferrerAddress(draft.referrer_address || "");
    setReportType(
      draft.report_type === "dictated_letter"
        ? "consultation_report"
        : draft.report_type,
    );
    setDictatedLetter(getReportText(draft));
    setGeneratedReport(getReportText(draft));
    setOriginalGeneratedReport(draft.ai_generated_text || "");
    setClinicalNotes(draft.ai_generated_text || draft.edited_text || "");
    setTypistInstructions(draft.typist_instructions || "");
    setActiveTab("drafts");
    setSidebarView("drafts");
    setSavedMessage(
      `Draft opened. Last saved ${formatDateTime(draft.created_at)}.`,
    );
  }

  function editApprovedLetter(draft: Draft | null) {
    if (!draft) return;

    loadDraftIntoEditor(draft);
    setSelectedApprovedDraft(null);
    setActiveTab("drafts");
    setSidebarView("drafts");

    setSavedMessage(
      "Approved letter opened for editing. Make changes, then save or approve again.",
    );
  }

  async function unapproveLetter(draft: Draft | null) {
    if (!draft) return;

    const confirmed = confirm(
      `Unapprove the letter for ${draft.patient_name || "this patient"}? It will move back to Approval Required.`,
    );

    if (!confirmed) return;

    setLoading(true);
    setSavedMessage("");

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          editedText: getReportText(draft),
          status: "awaiting_provider_approval",
          unapprove: true,
          learnFromEdits: false,
          typistInstructions: draft.typist_instructions || "",
          typistQueries: draft.typist_queries || "",
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to unapprove letter.");
        return;
      }

      setSelectedApprovedDraft(null);
      setSelectedApprovalDraft(data.draft || null);
      setActiveTab("approval");
      setSidebarView("approval");

      showSavedConfirmation(
        "Letter unapproved",
        "The letter has moved back to Approval Required.",
      );

      setSavedMessage(
        "Letter unapproved. It is now waiting in Approval Required.",
      );

      await loadDrafts();
    } finally {
      setLoading(false);
    }
  }

  async function updateExistingDraftFromEditor(options?: {
    status?: string;
    showToast?: boolean;
  }) {
    if (!selectedDraft) return null;
    if (!validatePatientName()) return null;

    const text = String(dictatedLetter || generatedReport || "").trim();

    if (!text) {
      alert("There is no letter text to save.");
      return null;
    }

    setLoading(true);
    setSavedMessage("");

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          editedText: text,
          status: options?.status || selectedDraft.status,
          patientName,
          patientDob,
          referrerName,
          referrerAddress,
          reportType:
            inferDraftSourceType(selectedDraft) === "dictation"
              ? "dictated_letter"
              : reportType,
          clinicalNotes,
          typistInstructions,
          typistQueries: selectedDraft.typist_queries || "",
          learnFromEdits: false,
        }),
      });

      const data = await readJsonSafely(response);

      if (!data.success) {
        alert(data.error || "Failed to update letter.");
        return null;
      }

      setSelectedDraft(data.draft);

      const message =
        options?.status === "approved"
          ? "Letter saved and approved."
          : "Letter changes saved.";

      setSavedMessage(message);

      if (options?.showToast !== false) {
        showSavedConfirmation(
          options?.status === "approved" ? "Letter approved" : "Letter saved",
          message,
        );
      }

      await loadDrafts();

      return data;
    } finally {
      setLoading(false);
    }
  }

  async function createImageDraftForUpload() {
  if (!patientFirstName.trim() || !patientLastName.trim()) {
    alert("Please enter the patient first and last name before uploading images.");
    return null;
  }

  const response = await fetch("/api/report-writing/save-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId,
      patientName,
      patientDob,
      referrerName,
      referrerAddress,
      reportType,
      clinicalNotes: "",
      generatedReport: "",
      editedText: "",
      sourceType: "clinical_notes",
      status: "draft",
      typistInstructions,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    alert(data.error || "Could not create draft for image upload.");
    return null;
  }

  setSelectedDraft(data.draft);
  await loadDrafts();

  return data.draft;
}

  async function saveLetterAsDraft(options?: {
  text?: string;
  sourceType?: LetterSourceType;
  showToast?: boolean;
}) {
  const text = String(
    options?.text ?? dictatedLetter ?? generatedReport ?? "",
  ).trim();

  if (!validatePatientName()) return null;

  if (!text) {
    alert("Dictate, smart dictate, or write the letter before saving a draft.");
    return null;
  }

  setRecordingState((current) =>
    current === "recording" || current === "paused" ? "saving" : current,
  );
  setLoading(true);
  setSavedMessage("");

  try {
    const sourceType = options?.sourceType || "dictation";

    const response = await fetch("/api/report-writing/save-draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId,
        patientName,
        patientDob,
        referrerName,
        referrerAddress,
        reportType: sourceType === "dictation" ? "dictated_letter" : reportType,
        clinicalNotes: text,
        typistInstructions,
        generatedReport: text,
        editedText: text,
        sourceType,
        status: "draft",
        learnFromEdits: false,
        praktikaPatientId: null,
      }),
    });

    const data = await readJsonSafely(response);

    if (!data.success) {
      alert(data.error || "Failed to save draft");
      return null;
    }

    if (data.draft) {
      setSelectedDraft(data.draft);
    }

    const successMessage =
      "Draft saved. You can reopen it from the Drafts panel.";

    setSavedMessage(successMessage);

    if (options?.showToast !== false) {
      showSavedConfirmation("Draft saved", successMessage);
    }

    await loadDrafts();

    return data;
  } finally {
    setLoading(false);
    setRecordingState("idle");
  }
}

  async function approveCurrentDraft(options?: {
    sourceType?: LetterSourceType;
  }) {
    const sourceType =
      options?.sourceType ||
      (selectedDraft ? inferDraftSourceType(selectedDraft) : dictatedLetter.trim() ? "dictation" : "clinical_notes");

    const text = (
      selectedDraft
        ? dictatedLetter || generatedReport || getReportText(selectedDraft)
        : dictatedLetter || generatedReport
    ).trim();

    if (!text) {
      alert("There is no letter text to approve.");
      return;
    }

    if (selectedDraft) {
      setLoading(true);

      try {
        const response = await fetch("/api/report-writing/update-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftId: selectedDraft.id,
            editedText:
              dictatedLetter || generatedReport || getReportText(selectedDraft),
            status: "approved",
            learnFromEdits: false,
            typistInstructions,
          }),
        });

        const data = await readJsonSafely(response);

        if (!data.success) {
          alert(data.error || "Failed to approve draft");
          return;
        }

        showSavedConfirmation(
          "Letter approved",
          "The letter has moved to Approved Letters.",
        );
        resetLetterEditor();
        setActiveTab("approved");
        setSidebarView("approved");
        await loadDrafts();
      } finally {
        setLoading(false);
      }

      return;
    }

    setLoading(true);
    setSavedMessage("");

    try {
      const response = await fetch("/api/report-writing/save-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientName,
          patientDob,
          referrerName,
          referrerAddress,
          reportType: sourceType === "dictation" ? "dictated_letter" : reportType,
          clinicalNotes: sourceType === "clinical_notes" ? clinicalNotes : text,
          typistInstructions,
          generatedReport: text,
          editedText: text,
          originalAiText: originalGeneratedReport || text,
          finalApprovedText: text,
          sourceType,
          status: "approved",
          learnFromEdits: false,
          praktikaPatientId: null,
        }),
      });

      const data = await readJsonSafely(response);

      if (!data.success) {
        alert(data.error || "Failed to approve letter");
        return;
      }

      showSavedConfirmation(
        "Letter approved",
        "The letter has moved to Approved Letters.",
      );
      resetLetterEditor();
      setActiveTab("approved");
      setSidebarView("approved");
      await loadDrafts();
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateFromNotes() {
    if (!validatePatientName()) return;

    if (!clinicalNotes.trim()) {
      alert("Enter clinical notes first.");
      return;
    }

    setLoading(true);
    setSavedMessage("");

    try {
      const response = await fetch("/api/report-writing/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientName,
          patientFirstName,
          patientDob,
          patientGender,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
        }),
      });

      const data = await readJsonSafely(response);

      console.log("Provider generation debug:", data.debug);
      console.log("Provider clinical scenario:", data.clinicalScenario);

      if (!data.success) {
        alert(data.error || "Failed to generate report");
        return;
      }

      setGeneratedReport(data.report);
      setOriginalGeneratedReport(data.report);
    } catch (error) {
      console.error(error);
      alert("Error generating report");
    } finally {
      setLoading(false);
    }
  }

  async function saveNotesDraft() {
    if (!validatePatientName()) return;

    if (!generatedReport.trim()) {
      alert("Generate or write a report before saving.");
      return;
    }

    const originalAiText = originalGeneratedReport || generatedReport;
    const finalApprovedText = generatedReport;
    const hasEditedAiText =
      originalAiText.trim() !== finalApprovedText.trim() &&
      Boolean(originalAiText.trim());

    setLoading(true);
    setSavedMessage("");

    try {
      const response = await fetch("/api/report-writing/save-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientName,
          patientDob,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
          typistInstructions,
          generatedReport: originalAiText,
          editedText: finalApprovedText,
          originalAiText,
          finalApprovedText,
          learnFromEdits: hasEditedAiText,
          learningSource: "provider_direct_generation_approval",
          sourceType: "clinical_notes",
          status: "draft",
          praktikaPatientId: null,
        }),
      });

      const data = await readJsonSafely(response);

      if (!data.success) {
        alert(data.error || "Failed to save draft");
        return;
      }

      const successMessage =
        "Draft saved. You can reopen it from the Drafts panel.";

      setSavedMessage(successMessage);
      showSavedConfirmation("Letter saved", successMessage);
      clearGeneratedForm();
      setTypistInstructions("");
      await loadDrafts();
    } finally {
      setLoading(false);
    }
  }

  async function saveDictatedLetter() {
    if (!validatePatientName()) return;

    if (!dictatedLetter.trim()) {
      alert("Dictate or enter the letter first.");
      return;
    }

    setLoading(true);
    setSavedMessage("");

    try {
      const response = await fetch("/api/report-writing/save-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientName,
          patientDob,
          referrerName,
          referrerAddress,
          reportType: "dictated_letter",
          clinicalNotes: dictatedLetter,
          typistInstructions,
          generatedReport: dictatedLetter,
          editedText: dictatedLetter,
          sourceType: "dictation",
          status: "approved",
          learnFromEdits: false,
          praktikaPatientId: null,
        }),
      });

      const data = await readJsonSafely(response);

      if (!data.success) {
        alert(data.error || "Failed to save dictated letter");
        return;
      }

      const successMessage =
        "Dictated letter saved and automatically approved.";

      setSavedMessage(successMessage);
      showSavedConfirmation("Letter approved", successMessage);
      setDictatedLetter("");
      setTypistInstructions("");
      setActiveTab("approved");
      setSidebarView("approved");
      await loadDrafts();
    } finally {
      setLoading(false);
    }
  }

  async function approveDraft() {
    if (!selectedApprovalDraft) return;

    const finalText = selectedApprovalDraft.edited_text || "";
    const originalAiText = selectedApprovalDraft.ai_generated_text || "";
    const hasEditedAiText =
      Boolean(originalAiText.trim()) &&
      originalAiText.trim() !== finalText.trim();

    const confirmed = confirm(
      hasEditedAiText
        ? "Approve this letter and save the provider edits for future learning?"
        : "Approve this letter?",
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedApprovalDraft.id,
          editedText: finalText,
          status: "approved",
          originalAiText,
          finalApprovedText: finalText,
          learnFromEdits: hasEditedAiText,
          learningSource: "provider_approval_edit",
          typistInstructions: selectedApprovalDraft.typist_instructions || "",
          typistQueries: selectedApprovalDraft.typist_queries || "",
        }),
      });

      const data = await readJsonSafely(response);

      if (!data.success) {
        alert(data.error || "Failed to approve draft");
        return;
      }

      alert(
        hasEditedAiText
          ? "Letter approved and learning saved."
          : "Letter approved.",
      );

      setSelectedApprovalDraft(null);
      setActiveTab("approved");
      await loadDrafts();
    } finally {
      setLoading(false);
    }
  }

  async function returnToTypist() {
    if (!selectedApprovalDraft) return;

    const confirmed = confirm(
      "Return this letter to the typist for more edits?",
    );
    if (!confirmed) return;

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedApprovalDraft.id,
          editedText: selectedApprovalDraft.edited_text || "",
          status: "edited_by_typist",
          learnFromEdits: false,
          typistInstructions: selectedApprovalDraft.typist_instructions || "",
          typistQueries: selectedApprovalDraft.typist_queries || "",
        }),
      });

      const data = await readJsonSafely(response);

      if (!data.success) {
        alert(data.error || "Failed to return draft");
        return;
      }

      alert("Returned to typist.");
      setSelectedApprovalDraft(null);
      await loadDrafts();
    } finally {
      setLoading(false);
    }
  }

  async function deleteDraft(draft: Draft | null) {
    if (!draft) return;

    const confirmed = confirm(
      `Delete this letter for ${draft.patient_name || "this patient"}? This cannot be undone.`,
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/delete-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });

      const data = await readJsonSafely(response);

      if (!data.success) {
        alert(data.error || "Failed to delete report");
        return;
      }

      alert("Report deleted.");

      if (selectedDraft?.id === draft.id) {
        setSelectedDraft(null);
      }

      if (selectedApprovalDraft?.id === draft.id) {
        setSelectedApprovalDraft(null);
      }

      if (selectedApprovedDraft?.id === draft.id) {
        setSelectedApprovedDraft(null);
      }

      await loadDrafts();
    } finally {
      setLoading(false);
    }
  }

  function selectApprovalDraft(draft: Draft) {
    setSelectedApprovalDraft(draft);
    setSidebarView("approval");
    setShowOriginal(false);
  }


  const sidebarSearchValue =
    sidebarView === "drafts"
      ? draftSearch
      : sidebarView === "approval"
        ? approvalSearch
        : approvedSearch;

  const visibleSidebarDrafts =
    sidebarView === "drafts"
      ? filteredLetterDrafts
      : sidebarView === "approval"
        ? filteredApprovalDrafts
        : filteredApprovedDrafts;

  function handleSidebarSearchChange(value: string) {
    if (sidebarView === "drafts") {
      setDraftSearch(value);
      return;
    }

    if (sidebarView === "approval") {
      setApprovalSearch(value);
      return;
    }

    setApprovedSearch(value);
  }

  function openSidebarView(view: SidebarView) {
    setSidebarView(view);
    setActiveTab(view);
    loadDrafts();
  }

  function selectSidebarDraft(draft: Draft) {
    if (sidebarView === "drafts") {
      loadDraftIntoEditor(draft);
      setSidebarView("drafts");
      return;
    }

    if (sidebarView === "approval") {
      selectApprovalDraft(draft);
      setActiveTab("approval");
      setSidebarView("approval");
      return;
    }

    setSelectedApprovedDraft(draft);
    setActiveTab("approved");
    setSidebarView("approved");
  }

  const sharedPatientFields = (
    <PatientAndReferrerFields
      patientFirstName={patientFirstName}
      setPatientFirstName={setPatientFirstName}
      patientLastName={patientLastName}
      setPatientLastName={setPatientLastName}
      patientDob={patientDob}
      setPatientDob={setPatientDob}
      patientGender={patientGender}
      setPatientGender={setPatientGender}
      reportType={reportType}
      setReportType={setReportType}
      reportTypes={reportTypes}
      referrerName={referrerName}
      setReferrerName={setReferrerName}
      referrerAddress={referrerAddress}
      setReferrerAddress={setReferrerAddress}
      typistInstructions={typistInstructions}
      setTypistInstructions={setTypistInstructions}
      typistQueriesForProvider={
        activeTab === "approval"
          ? selectedApprovalDraft?.typist_queries || null
          : activeTab === "approved"
            ? selectedApprovedDraft?.typist_queries || null
            : selectedDraft?.typist_queries || null
      }
    />
  );

  return (
    <div className="mx-auto max-w-7xl">
      {showSavedToast ? (
        <div className="fixed bottom-6 right-6 z-50 w-[22rem] max-w-[calc(100vw-3rem)] rounded-2xl border border-green-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-lg font-bold text-green-700">
              ✓
            </div>

            <div className="min-w-0 flex-1">
              <div className="font-bold text-slate-950">{savedToastTitle}</div>
              <div className="mt-1 text-sm text-slate-600">
                {savedToastText}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSavedToast(false)}
              className="rounded-full px-2 py-1 text-sm font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close saved message"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-[calc(100vh-7rem)] gap-5 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <aside className="rounded-3xl border bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)] lg:overflow-y-auto">
          <div className="mb-4 border-b pb-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              AI Reports
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-950">
              AI Scribe and Report Writing
            </h1>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Transcribe clinical reports or generate from clinical notes.
            </p>
            <button
              type="button"
              onClick={() => {
                resetLetterEditor();
                setActiveTab(sourceTypeToTab(defaultLetterSource));
                setSidebarView("drafts");
                loadReportTypes();
              }}
              className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              + New Letter
            </button>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <label
                htmlFor="default-letter-source"
                className="block text-xs font-bold uppercase tracking-wide text-slate-600"
              >
                Default new-letter method
              </label>
              <select
                id="default-letter-source"
                value={defaultLetterSource}
                disabled={preferenceLoading || preferenceSaving}
                onChange={(event) => {
                  const nextPreference = event.target.value;
                  if (isLetterSourceType(nextPreference)) {
                    void saveProviderLetterPreference(nextPreference);
                  }
                }}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="dictation">Dictate</option>
                <option value="smart_dictation">Smart Dictate</option>
                <option value="clinical_notes">Generate from Clinical Notes</option>
              </select>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                This provider&apos;s selection will open when New Letter is clicked.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => openSidebarView("drafts")}
              className={[
                "rounded-xl px-2 py-2 text-center text-xs font-bold transition",
                sidebarView === "drafts"
                  ? "bg-white text-blue-800 shadow-sm"
                  : "text-slate-600 hover:text-slate-950",
              ].join(" ")}
            >
              <span className="block">Drafts</span>
              <span className="mt-0.5 block text-[11px] font-semibold">
                {letterDrafts.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openSidebarView("approval")}
              className={[
                "rounded-xl px-2 py-2 text-center text-xs font-bold transition",
                sidebarView === "approval"
                  ? "bg-white text-amber-800 shadow-sm"
                  : "text-slate-600 hover:text-slate-950",
              ].join(" ")}
            >
              <span className="block">Approval Required</span>
              <span className="mt-0.5 block text-[11px] font-semibold">
                {approvalDrafts.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openSidebarView("approved")}
              className={[
                "rounded-xl px-2 py-2 text-center text-xs font-bold transition",
                sidebarView === "approved"
                  ? "bg-white text-green-800 shadow-sm"
                  : "text-slate-600 hover:text-slate-950",
              ].join(" ")}
            >
              <span className="block">Approved</span>
              <span className="mt-0.5 block text-[11px] font-semibold">
                {approvedDrafts.length}
              </span>
            </button>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-950">
                  {sidebarView === "drafts"
                    ? "Drafts"
                    : sidebarView === "approval"
                      ? "Approval Required"
                      : "Approved"}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {sidebarView === "drafts"
                    ? "Letters saved automatically."
                    : sidebarView === "approval"
                      ? "Letters waiting for review."
                      : "Recently approved letters."}
                </p>
              </div>

              <button
                type="button"
                onClick={loadDrafts}
                disabled={loading}
                className="rounded-xl border px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <input
              className="mt-3 w-full rounded-xl border p-2 text-xs"
              placeholder={
                sidebarView === "drafts"
                  ? "Search drafts..."
                  : sidebarView === "approval"
                    ? "Search approval..."
                    : "Search approved..."
              }
              value={sidebarSearchValue}
              onChange={(e) => handleSidebarSearchChange(e.target.value)}
            />

            <div className="mt-3 space-y-2">
              {visibleSidebarDrafts.map((draft) => {
                const canDeleteFromSidebar =
                  sidebarView === "drafts" || sidebarView === "approved";

                return (
                  <div
                    key={draft.id}
                    className={[
                      "group flex items-start gap-2 rounded-2xl border p-2",
                      sidebarView === "drafts" && selectedDraft?.id === draft.id
                        ? "border-blue-500 bg-blue-50"
                        : sidebarView === "approval" &&
                            selectedApprovalDraft?.id === draft.id
                          ? "border-amber-500 bg-amber-50"
                          : sidebarView === "approved" &&
                              selectedApprovedDraft?.id === draft.id
                            ? "border-green-500 bg-green-50"
                            : "border-slate-200 bg-white",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => selectSidebarDraft(draft)}
                      className="min-w-0 flex-1 rounded-xl p-1 text-left text-sm hover:bg-white/60"
                    >
                      <div className="truncate font-semibold text-slate-950">
                        {draft.patient_name || "Unnamed patient"}
                      </div>
                      <div className="mt-1 truncate text-xs text-slate-500">
                        {sidebarView === "approved"
                          ? "Approved"
                          : draft.referrer_name || formatReportType(draft.report_type)}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-400">
                        {formatDateTime(
                          sidebarView === "approved"
                            ? draft.provider_approved_at || draft.created_at
                            : draft.created_at,
                        )}
                      </div>
                    </button>

                    {canDeleteFromSidebar ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteDraft(draft);
                        }}
                        disabled={loading}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Delete ${draft.patient_name || "letter"}`}
                        title={
                          sidebarView === "approved"
                            ? "Delete approved letter"
                            : "Delete draft"
                        }
                      >
                        <TrashBinIcon />
                      </button>
                    ) : null}
                  </div>
                );
              })}

              {visibleSidebarDrafts.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-4 text-xs text-slate-500">
                  {sidebarView === "drafts"
                    ? "No drafts."
                    : sidebarView === "approval"
                      ? "No letters awaiting approval."
                      : "No approved letters."}
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <main className="space-y-6">
          <ProviderTypistSmsBox providerId={providerId} />

          <section className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                  AI Reports
                </p>
                <h2 className="mt-1 text-2xl font-bold text-slate-950">
                  AI Scribe and Report Writing
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Transcribe clinical reports or generate from clinical notes.
                </p>
              </div>

              {activeTab === "dictate" ||
              activeTab === "smart" ||
              activeTab === "notes" ? (
                <div className="flex flex-wrap gap-2">
                  {[
                    ["dictate", "Dictate"],
                    ["smart", "Smart Dictate"],
                    ["notes", "Generate from Clinical Notes"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setActiveTab(key as ActiveTab);
                        loadReportTypes();
                      }}
                      className={[
                        "rounded-full px-4 py-2 text-sm font-semibold transition",
                        activeTab === key
                          ? "bg-slate-950 text-white"
                          : "border bg-white text-slate-700 hover:bg-slate-50",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
          {savedMessage ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              {savedMessage}
            </div>
          ) : null}

          {activeTab === "smart" ? (
            <div className="space-y-6">
              {sharedPatientFields}

              <ProviderSimpleImageUpload
  reportDraftId={selectedDraft?.id || null}
  onCreateDraft={createImageDraftForUpload}
/>

              <div className="space-y-6 rounded-2xl border bg-white p-5">
                <SmartDictateBox
                  providerId={providerId}
                  patientFirstName={patientFirstName}
                  patientLastName={patientLastName}
                  patientDob={patientDob}
                  disabled={!patientFirstName.trim() || !patientLastName.trim()}
                  reportTypes={reportTypes}
                  selectedReportType={reportType}
                  onReportTypeChange={setReportType}
                  onResult={(result) => {
                    const report = result.report || "";
                    setClinicalNotes(result.clinicalNotes || "");
                    setGeneratedReport(report);
                    setOriginalGeneratedReport(report);
                    setSavedMessage("");

                    if (report.trim()) {
                      void saveLetterAsDraft({
                        text: report,
                        sourceType: "smart_dictation",
                      });
                    }
                  }}
                />

                <RichTextLetterEditor
                  value={generatedReport}
                  onChange={setGeneratedReport}
                  placeholder="Smart Dictate generated report..."
                  minHeightClassName="min-h-96"
                />

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() =>
                      saveLetterAsDraft({
                        text: generatedReport,
                        sourceType: "smart_dictation",
                      })
                    }
                    disabled={loading}
                    className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Save Smart Dictate Draft
                  </button>

                  <button
                    onClick={() =>
                      approveCurrentDraft({ sourceType: "smart_dictation" })
                    }
                    disabled={loading}
                    className="rounded-xl bg-green-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Approve Letter
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "dictate" ? (
            <div className="space-y-6 rounded-2xl border bg-white p-5">
              {sharedPatientFields}

              <ProviderSimpleImageUpload
  reportDraftId={selectedDraft?.id || null}
  onCreateDraft={createImageDraftForUpload}
/>

              <OpenAIDictationBox
                providerId={providerId}
                patientFirstName={patientFirstName}
                patientLastName={patientLastName}
                disabled={!patientFirstName.trim() || !patientLastName.trim()}
                onStarted={() => {
                  setRecordingSeconds(0);
                  setRecordingState("recording");
                }}
                onPaused={(text?: string) => {
                  setRecordingState("paused");
                  if (String(text || dictatedLetter).trim()) {
                    void saveLetterAsDraft({
                      text: String(text || dictatedLetter),
                      sourceType: "dictation",
                    });
                  }
                }}
                onResumed={() => setRecordingState("recording")}
                onFinished={(text) => {
                  setDictatedLetter(text);
                  setRecordingState("saving");
                  void saveLetterAsDraft({ text, sourceType: "dictation" });
                }}
              />

              <RichTextLetterEditor
                value={dictatedLetter}
                onChange={setDictatedLetter}
                placeholder="Dictated letter will appear here after dictation stops..."
                minHeightClassName="min-h-96"
              />

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() =>
                    saveLetterAsDraft({
                      text: dictatedLetter,
                      sourceType: "dictation",
                    })
                  }
                  disabled={loading}
                  className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Save Draft
                </button>

                <button
                  onClick={() => approveCurrentDraft({ sourceType: "dictation" })}
                  disabled={loading}
                  className="rounded-xl bg-green-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Approve Letter
                </button>
              </div>
            </div>
          ) : null}

          {activeTab === "notes" ? (
            <div className="space-y-6 rounded-2xl border bg-white p-5">
              {sharedPatientFields}

              <ProviderSimpleImageUpload
  reportDraftId={selectedDraft?.id || null}
  onCreateDraft={createImageDraftForUpload}
/>

              <textarea
                className="h-64 w-full rounded-xl border border-slate-300 p-4"
                placeholder="Paste clinical notes to generate a report..."
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
              />

              <button
                onClick={handleGenerateFromNotes}
                disabled={loading}
                className="rounded-xl bg-slate-950 px-6 py-3 font-semibold text-white disabled:opacity-50"
              >
                {loading ? "Working..." : "Generate Report From Clinical Notes"}
              </button>

              <RichTextLetterEditor
                value={generatedReport}
                onChange={setGeneratedReport}
                placeholder="Generated report..."
                minHeightClassName="min-h-96"
              />

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={saveNotesDraft}
                  disabled={loading}
                  className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Save Draft
                </button>

                <button
                  onClick={() =>
                    approveCurrentDraft({ sourceType: "clinical_notes" })
                  }
                  disabled={loading}
                  className="rounded-xl bg-green-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Approve Letter
                </button>
              </div>
            </div>
          ) : null}

          {activeTab === "drafts" ? (
            <div className="grid gap-5 lg:grid-cols-12">
              <div className="hidden">
                <div className="rounded-2xl border bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold">Drafts</h2>
                      <p className="text-sm text-slate-500">
                        Paused or stopped letters waiting for review.
                      </p>
                    </div>
                    <button
                      onClick={loadDrafts}
                      disabled={loading}
                      className="rounded-xl border px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    >
                      Refresh
                    </button>
                  </div>

                  <input
                    className="mt-4 w-full rounded-xl border p-3 text-sm"
                    placeholder="Search drafts..."
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                  />
                </div>

                {filteredLetterDrafts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                    No saved drafts yet.
                  </div>
                ) : null}

                {filteredLetterDrafts.map((draft) => (
                  <button
                    key={draft.id}
                    onClick={() => loadDraftIntoEditor(draft)}
                    className={[
                      "w-full rounded-2xl border bg-white p-4 text-left shadow-sm hover:bg-slate-50",
                      selectedDraft?.id === draft.id
                        ? "border-blue-600 ring-2 ring-blue-100"
                        : "border-slate-200",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          {draft.patient_name || "Unnamed patient"}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {formatReportType(draft.report_type)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Last saved: {formatDateTime(draft.created_at)}
                        </div>
                        {draft.referrer_name ? (
                          <div className="mt-1 text-xs text-slate-500">
                            Referrer: {draft.referrer_name}
                          </div>
                        ) : null}
                      </div>

                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        Draft
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-12">
                {selectedDraft ? (
                  <div className="space-y-4 rounded-2xl border bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                      <div>
                        <h2 className="text-2xl font-bold">
                          {selectedDraft.patient_name || "Unnamed patient"}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Draft saved {formatDateTime(selectedDraft.created_at)}
                        </p>
                      </div>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        Draft
                      </span>
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                      Draft recovered. Review or edit the text below, then
                      approve when ready.
                    </div>

                    {sharedPatientFields}

                   <ProviderSimpleImageUpload
  reportDraftId={selectedDraft?.id || null}
  onCreateDraft={createImageDraftForUpload}
/>

                    <RichTextLetterEditor
                      value={dictatedLetter || generatedReport}
                      onChange={(value) => {
                        setDictatedLetter(value);
                        setGeneratedReport(value);
                      }}
                      placeholder="Review or edit the draft letter..."
                      minHeightClassName="min-h-[36rem]"
                    />

                    <div className="flex flex-wrap gap-3 border-t pt-4">
                      <button
                        onClick={() => updateExistingDraftFromEditor()}
                        disabled={loading}
                        className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        {selectedDraft.status === "approved" ? "Save Changes" : "Save Draft"}
                      </button>

                      <button
                        onClick={() =>
                          updateExistingDraftFromEditor({ status: "approved" })
                        }
                        disabled={loading}
                        className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        {selectedDraft.status === "approved"
                          ? "Save and Keep Approved"
                          : "Approve Letter"}
                      </button>

                      <button
                        onClick={() => deleteDraft(selectedDraft)}
                        disabled={loading}
                        className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        {selectedDraft.status === "approved" ? "Delete Letter" : "Delete Draft"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
                    Select a draft to continue.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "approval" ? (
            <div className="grid gap-5 lg:grid-cols-12">
              <div className="hidden">
                <div className="rounded-2xl border bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold">Approval Inbox</h2>
                      <p className="text-sm text-slate-500">
                        Letters awaiting provider review.
                      </p>
                    </div>
                    <button
                      onClick={loadDrafts}
                      disabled={loading}
                      className="rounded-xl border px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    >
                      Refresh
                    </button>
                  </div>

                  <input
                    className="mt-4 w-full rounded-xl border p-3 text-sm"
                    placeholder="Search patient, referrer, report type..."
                    value={approvalSearch}
                    onChange={(e) => setApprovalSearch(e.target.value)}
                  />
                </div>

                {filteredApprovalDrafts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                    No letters awaiting approval.
                  </div>
                ) : null}

                {filteredApprovalDrafts.map((draft) => (
                  <button
                    key={draft.id}
                    onClick={() => selectApprovalDraft(draft)}
                    className={[
                      "w-full rounded-2xl border bg-white p-4 text-left shadow-sm hover:bg-slate-50",
                      selectedApprovalDraft?.id === draft.id
                        ? "border-blue-600 ring-2 ring-blue-100"
                        : "border-slate-200",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          {draft.patient_name || "Unnamed patient"}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {formatReportType(draft.report_type)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          Created: {formatDateTime(draft.created_at)}
                        </div>
                        {draft.referrer_name ? (
                          <div className="mt-1 text-xs text-slate-500">
                            Referrer: {draft.referrer_name}
                          </div>
                        ) : null}
                      </div>

                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                        Review
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-12">
                {selectedApprovalDraft ? (
                  <div className="space-y-4 rounded-2xl border bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                      <div>
                        <h2 className="text-2xl font-bold">
                          {selectedApprovalDraft.patient_name ||
                            "Unnamed patient"}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatReportType(selectedApprovalDraft.report_type)} • Created{" "}
                          {formatDateTime(selectedApprovalDraft.created_at)}
                        </p>
                        {selectedApprovalDraft.referrer_name ? (
                          <p className="mt-1 text-sm text-slate-500">
                            Referrer: {selectedApprovalDraft.referrer_name}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                          Awaiting approval
                        </span>
                        <span
                          className={[
                            "rounded-full px-3 py-1",
                            learningWillBeSaved(selectedApprovalDraft)
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-200 text-slate-600",
                          ].join(" ")}
                        >
                          {learningWillBeSaved(selectedApprovalDraft)
                            ? "Learning will be saved"
                            : "No edit-learning change"}
                        </span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <label className="block text-sm font-bold text-amber-900">
                        Instructions for typist
                      </label>
                      <p className="mt-1 text-xs text-amber-700">
                        Internal action notes only. These will not be included
                        in the final letter.
                      </p>
                      <textarea
                        className="mt-3 h-28 w-full rounded-xl border border-amber-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                        placeholder="Examples: attach PA X-Ray, attach periodontal chart, cc to Dr John Smith..."
                        value={selectedApprovalDraft.typist_instructions || ""}
                        onChange={(e) =>
                          setSelectedApprovalDraft({
                            ...selectedApprovalDraft,
                            typist_instructions: e.target.value,
                          })
                        }
                      />
                    </div>

                    {selectedApprovalDraft.typist_queries?.trim() ? (
                      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                        <div className="text-sm font-bold text-sky-900">
                          Queries from typist
                        </div>
                        <p className="mt-1 text-xs text-sky-700">
                          Internal notes from the typist for provider review.
                          These are not included in the final letter.
                        </p>
                        <div className="mt-3 whitespace-pre-line rounded-xl border border-sky-200 bg-white p-3 text-sm leading-6 text-sky-950">
                          {selectedApprovalDraft.typist_queries}
                        </div>
                      </div>
                    ) : null}

                    <ProviderSimpleImageUpload
  reportDraftId={selectedDraft?.id || null}
  onCreateDraft={createImageDraftForUpload}
/>

                    {selectedApprovalDraft.ai_generated_text ? (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setShowOriginal((current) => !current)}
                          className="rounded-xl border px-4 py-2 text-xs font-semibold text-slate-700"
                        >
                          {showOriginal
                            ? "Show editable version"
                            : "Compare original AI version"}
                        </button>
                      </div>
                    ) : null}

                    {showOriginal ? (
                      <div className="grid gap-4 xl:grid-cols-2">
                        <div>
                          <div className="mb-2 text-sm font-semibold text-slate-700">
                            Original AI version
                          </div>
                          <RichTextLetterEditor
                            value={selectedApprovalDraft.ai_generated_text || ""}
                            readOnly
                            minHeightClassName="min-h-[32rem]"
                            showToolbar={false}
                          />
                        </div>
                        <div>
                          <div className="mb-2 text-sm font-semibold text-slate-700">
                            Final edited version
                          </div>
                          <RichTextLetterEditor
                            value={selectedApprovalDraft.edited_text || ""}
                            onChange={(value) =>
                              setSelectedApprovalDraft({
                                ...selectedApprovalDraft,
                                edited_text: value,
                              })
                            }
                            minHeightClassName="min-h-[32rem]"
                          />
                        </div>
                      </div>
                    ) : (
                      <RichTextLetterEditor
                        value={selectedApprovalDraft.edited_text || ""}
                        onChange={(value) =>
                          setSelectedApprovalDraft({
                            ...selectedApprovalDraft,
                            edited_text: value,
                          })
                        }
                        minHeightClassName="min-h-[36rem]"
                      />
                    )}

                    <div className="flex flex-wrap gap-3 border-t pt-4">
                      <button
                        onClick={approveDraft}
                        disabled={loading}
                        className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        {loading ? "Approving..." : "Approve Letter"}
                      </button>

                      <button
                        onClick={() => deleteDraft(selectedApprovalDraft)}
                        disabled={loading}
                        className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        Delete Letter
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
                    Select a letter to review.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "approved" ? (
            <div className="grid gap-5 lg:grid-cols-12">
              <div className="hidden">
                <div className="rounded-2xl border bg-white p-4">
                  <h2 className="text-xl font-bold">Approved Letters</h2>
                  <p className="text-sm text-slate-500">
                    Recently approved reports ready for typist PDF workflow.
                  </p>
                  <input
                    className="mt-4 w-full rounded-xl border p-3 text-sm"
                    placeholder="Search approved letters..."
                    value={approvedSearch}
                    onChange={(e) => setApprovedSearch(e.target.value)}
                  />
                </div>

                {filteredApprovedDrafts.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                    No approved letters yet.
                  </div>
                ) : null}

                {filteredApprovedDrafts.map((draft) => (
                  <button
                    key={draft.id}
                    onClick={() => setSelectedApprovedDraft(draft)}
                    className={[
                      "w-full rounded-2xl border bg-white p-4 text-left shadow-sm hover:bg-slate-50",
                      selectedApprovedDraft?.id === draft.id
                        ? "border-green-600 ring-2 ring-green-100"
                        : "border-slate-200",
                    ].join(" ")}
                  >
                    <div className="font-semibold">
                      {draft.patient_name || "Unnamed patient"}
                    </div>
                    <div className="mt-1 text-sm text-green-600">Approved</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {formatDateTime(
                        draft.provider_approved_at || draft.created_at,
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-12">
                {selectedApprovedDraft ? (
                  <div className="space-y-4 rounded-2xl border bg-white p-5">
                    <div className="flex items-start justify-between gap-3 border-b pb-4">
                      <div>
                        <h2 className="text-2xl font-bold">
                          {selectedApprovedDraft.patient_name ||
                            "Unnamed patient"}
                        </h2>
                        <p className="mt-1 text-sm text-slate-500">
                          Approved{" "}
                          {formatDateTime(
                            selectedApprovedDraft.provider_approved_at ||
                              selectedApprovedDraft.created_at,
                          )}
                        </p>
                      </div>
                      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                        Approved
                      </span>
                    </div>

                    <RichTextLetterEditor
                      value={getReportText(selectedApprovedDraft)}
                      readOnly
                      minHeightClassName="min-h-[36rem]"
                      showToolbar={false}
                    />

                    <ProviderSimpleImageUpload
  reportDraftId={selectedDraft?.id || null}
  onCreateDraft={createImageDraftForUpload}
/>

                    {selectedApprovedDraft.typist_instructions?.trim() ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <div className="text-sm font-bold text-amber-900">
                          Instructions for typist
                        </div>
                        <div className="mt-2 whitespace-pre-line text-sm leading-6 text-amber-950">
                          {selectedApprovedDraft.typist_instructions}
                        </div>
                      </div>
                    ) : null}

                    {selectedApprovedDraft.typist_queries?.trim() ? (
                      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                        <div className="text-sm font-bold text-sky-900">
                          Queries from typist
                        </div>
                        <p className="mt-1 text-xs text-sky-700">
                          Internal notes from the typist for provider review.
                          These are not included in the final letter.
                        </p>
                        <div className="mt-3 whitespace-pre-line rounded-xl border border-sky-200 bg-white p-3 text-sm leading-6 text-sky-950">
                          {selectedApprovedDraft.typist_queries}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                      This letter is approved. The typist portal is used to add
                      images, generate the branded PDF, complete the final
                      upload, and send secure email correspondence.
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => editApprovedLetter(selectedApprovedDraft)}
                        disabled={loading}
                        className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        Edit Letter
                      </button>

                      <button
                        onClick={() => unapproveLetter(selectedApprovedDraft)}
                        disabled={loading}
                        className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Unapprove Letter
                      </button>

                      <button
                        onClick={() => deleteDraft(selectedApprovedDraft)}
                        disabled={loading}
                        className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                      >
                        Delete Letter
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
                    Select an approved letter.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
