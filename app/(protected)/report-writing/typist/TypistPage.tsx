"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import ReferrerSearchBox from "@/components/report-writing/ReferrerSearchBox";
import DraftImagePanel from "@/components/report-writing/DraftImagePanel";
import TypistProviderSmsBox from "@/components/report-writing/TypistProviderSmsBox";
import PraktikaToolsPopup from "@/components/report-writing/PraktikaToolsPopup";
import MedirefToolsPopup from "@/components/report-writing/MedirefToolsPopup";
import RichTextLetterEditor, {
  type RichTextLetterEditorHandle,
} from "@/components/report-writing/RichTextLetterEditor";

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
  typist_queries?: string | null;
  workflow_status?: string | null;
  workflow_started_at?: string | null;
  workflow_completed_at?: string | null;
  workflow_error?: string | null;
  workflow_praktika_upload_status?: string | null;
  workflow_icon_update_status?: string | null;
  workflow_mediref_status?: string | null;
  workflow_periodontal_chart_status?: string | null;
  workflow_last_message?: string | null;
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
    formatReportType(inferredType)
  );
}

async function classifyReportTypeWithAi(params: {
  providerId: string;
  clinicalNotes: string;
  appointmentNotes: string;
  reportTypes: ReportTypeOption[];
  fallbackReportType: string;
}) {
  try {
    const response = await fetch("/api/report-writing/classify-report-type", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providerId: params.providerId,
        clinicalNotes: params.clinicalNotes,
        appointmentNotes: params.appointmentNotes,
        availableReportTypes: params.reportTypes,
        fallbackReportType: params.fallbackReportType,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      console.warn("AI report type classification failed:", data);
      return params.fallbackReportType;
    }

    const aiReportType = String(data.reportType || "").trim();

    if (
      aiReportType &&
      params.reportTypes.some((type) => type.value === aiReportType)
    ) {
      return aiReportType;
    }

    return params.fallbackReportType;
  } catch (error) {
    console.warn("AI report type classification request failed:", error);
    return params.fallbackReportType;
  }
}

function asPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getFirstCleanString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanString(source[key]);

    if (value) return value;
  }

  return "";
}

function getNestedPlainObjects(
  source: Record<string, unknown>,
  keys: string[],
) {
  return keys
    .map((key) => asPlainObject(source[key]))
    .filter((value) => Object.keys(value).length > 0);
}

function normaliseKey(value: string) {
  return String(value || "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

type DeepStringMatch = {
  key: string;
  value: string;
  path: string;
};

function collectDeepStringMatches(
  value: unknown,
  keyMatcher: (normalisedKey: string, rawKey: string) => boolean,
  options?: { maxDepth?: number; path?: string; seen?: WeakSet<object> },
): DeepStringMatch[] {
  const maxDepth = options?.maxDepth ?? 8;
  const path = options?.path ?? "root";
  const seen = options?.seen ?? new WeakSet<object>();

  if (maxDepth < 0 || !value || typeof value !== "object") return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);

  const matches: DeepStringMatch[] = [];

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      matches.push(
        ...collectDeepStringMatches(entry, keyMatcher, {
          maxDepth: maxDepth - 1,
          path: `${path}[${index}]`,
          seen,
        }),
      );
    });
    return matches;
  }

  for (const [rawKey, rawValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const key = normaliseKey(rawKey);
    const nextPath = `${path}.${rawKey}`;

    if (typeof rawValue === "string" || typeof rawValue === "number") {
      const cleanValue = cleanString(rawValue);
      if (cleanValue && keyMatcher(key, rawKey)) {
        matches.push({ key: rawKey, value: cleanValue, path: nextPath });
      }
      continue;
    }

    matches.push(
      ...collectDeepStringMatches(rawValue, keyMatcher, {
        maxDepth: maxDepth - 1,
        path: nextPath,
        seen,
      }),
    );
  }

  return matches;
}

function firstDeepStringMatch(
  value: unknown,
  keyMatcher: (normalisedKey: string, rawKey: string) => boolean,
) {
  return collectDeepStringMatches(value, keyMatcher)[0]?.value || "";
}

function joinUniqueNonEmptyLines(parts: string[]) {
  const seen = new Set<string>();

  return parts
    .flatMap((part) => String(part || "").split(/\n+/))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

function isAppointmentOnlyClinicalText(value: unknown) {
  const text = cleanString(value).toLowerCase();

  if (!text) return true;

  const appointmentMarkers = [
    "appointment notes:",
    "treatment type:",
    "treatment label:",
    "has surgeon approved suitability",
    "949 code added",
    "fasting 6 hours prior",
  ];

  const hasAppointmentMarker = appointmentMarkers.some((marker) =>
    text.includes(marker),
  );

  // If it mainly looks like appointment-admin text, do not treat it as real
  // same-day clinical notes. This prevents duplicated appointment notes from
  // being displayed or cached as clinical notes.
  if (
    hasAppointmentMarker &&
    !/\b(la:|lignocaine|irrigated|closed|suture|ha,|poig|extraction completed|implant|flap|curett|debrid|socket|bone graft)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (text.includes("same-day praktika clinical notes could not be loaded")) {
    return true;
  }

  return false;
}

function cleanClinicalNoteText(value: unknown) {
  const text = cleanString(value);

  if (!text || isAppointmentOnlyClinicalText(text)) return "";

  return text;
}

function joinUniqueAddressLines(parts: string[]) {
  const seen = new Set<string>();

  return parts
    .flatMap((part) => String(part || "").split(/\n+/))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

function getAddressFromObject(source: Record<string, unknown>) {
  const wholeAddress = getFirstCleanString(source, [
    "referrerAddress",
    "referrer_address",
    "providerAddress",
    "provider_address",
    "practiceAddress",
    "practice_address",
    "clinicAddress",
    "clinic_address",
    "address",
    "formattedAddress",
    "formatted_address",
    "vchReferrerAddress",
    "vchReferralProviderAddress",
    "vchProviderAddress",
    "vchPracticeAddress",
    "vchClinicAddress",
  ]);

  const practiceName = getFirstCleanString(source, [
    "practiceName",
    "practice_name",
    "clinicName",
    "clinic_name",
    "businessName",
    "business_name",
    "organisationName",
    "organizationName",
    "organisation_name",
    "organization_name",
    "facilityName",
    "facility_name",
    "vchClinic",
    "vchClinicName",
    "vchPractice",
    "vchPracticeName",
    "vchBusinessName",
  ]);

  const addressLines = [
    getFirstCleanString(source, [
      "addressLine1",
      "address_line_1",
      "line1",
      "vchAddress1",
      "vchAddressLine1",
    ]),
    getFirstCleanString(source, [
      "addressLine2",
      "address_line_2",
      "line2",
      "vchAddress2",
      "vchAddressLine2",
    ]),
    getFirstCleanString(source, [
      "suburb",
      "city",
      "town",
      "vchSuburb",
      "vchCity",
    ]),
    getFirstCleanString(source, ["state", "province", "vchState"]),
    getFirstCleanString(source, [
      "postcode",
      "postCode",
      "postalCode",
      "postal_code",
      "zip",
      "vchPostcode",
      "vchPostCode",
    ]),
  ].filter(Boolean);

  return joinUniqueAddressLines([practiceName, wholeAddress, ...addressLines]);
}

function getQueueRawObject(item: QueueItem) {
  return asPlainObject(item.raw_json);
}

function getQueueReferralObject(item: QueueItem) {
  const raw = getQueueRawObject(item);

  return {
    referral: asPlainObject(raw.referral),
    latestReferral: asPlainObject(raw.latest_referral || raw.latestReferral),
    referrer: asPlainObject(raw.referrer),
  };
}

function getQueueReferrerName(item: QueueItem) {
  const raw = getQueueRawObject(item);
  const { referral, latestReferral, referrer } = getQueueReferralObject(item);

  return (
    cleanString(item.referrer_name) ||
    getFirstCleanString(raw, [
      "referrer_name",
      "referrerName",
      "referring_provider_name",
      "referringProviderName",
      "referral_provider_name",
      "referralProviderName",
      "vchReferrerName",
      "vchReferralProvider",
      "vchReferralProviderName",
      "vchProviderName",
    ]) ||
    getFirstCleanString(referral, [
      "referrerName",
      "referrer_name",
      "providerName",
      "name",
    ]) ||
    getFirstCleanString(latestReferral, [
      "referrerName",
      "referrer_name",
      "providerName",
      "name",
    ]) ||
    getFirstCleanString(referrer, [
      "referrerName",
      "referrer_name",
      "providerName",
      "name",
    ])
  );
}

function formatAppointmentDateTime(value: string | null | undefined) {
  const text = String(value || "").trim();

  if (!text) return "No appointment time";

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return date.toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getQueueReferrerAddress(item: QueueItem) {
  const raw = getQueueRawObject(item);
  const { referral, latestReferral, referrer } = getQueueReferralObject(item);

  const directItemAddress = cleanString(item.referrer_address);
  if (directItemAddress) return directItemAddress;

  const itemAsObject = item as unknown as Record<string, unknown>;

  const directPracticeName =
    getFirstCleanString(itemAsObject, [
      "practice_name",
      "practiceName",
      "clinic_name",
      "clinicName",
      "referrer_practice_name",
      "referrerPracticeName",
      "referrer_clinic_name",
      "referrerClinicName",
    ]) ||
    firstDeepStringMatch(raw, (key) =>
      [
        "practicename",
        "clinicname",
        "businessname",
        "organisationname",
        "organizationname",
        "facilityname",
        "referrerpracticename",
        "referrerclinicname",
        "providerpracticename",
        "providerclinicname",
        "vchclinic",
        "vchclinicname",
        "vchpractice",
        "vchpracticename",
      ].includes(key),
    );

  const wholeAddress =
    getFirstCleanString(itemAsObject, [
      "practice_address",
      "practiceAddress",
      "clinic_address",
      "clinicAddress",
      "referrer_address",
      "referrerAddress",
      "provider_address",
      "providerAddress",
    ]) ||
    firstDeepStringMatch(raw, (key) =>
      [
        "referreraddress",
        "provideraddress",
        "practiceaddress",
        "clinicaddress",
        "formattedaddress",
        "address",
        "vchreferreraddress",
        "vchreferralprovideraddress",
        "vchprovideraddress",
        "vchpracticeaddress",
        "vchclinicaddress",
      ].includes(key),
    );

  const line1 = firstDeepStringMatch(raw, (key) =>
    [
      "addressline1",
      "address1",
      "line1",
      "vchaddress1",
      "vchaddressline1",
    ].includes(key),
  );
  const line2 = firstDeepStringMatch(raw, (key) =>
    [
      "addressline2",
      "address2",
      "line2",
      "vchaddress2",
      "vchaddressline2",
    ].includes(key),
  );
  const suburb = firstDeepStringMatch(raw, (key) =>
    ["suburb", "city", "town", "vchsuburb", "vchcity"].includes(key),
  );
  const state = firstDeepStringMatch(raw, (key) =>
    ["state", "province", "vchstate"].includes(key),
  );
  const postcode = firstDeepStringMatch(raw, (key) =>
    ["postcode", "postalcode", "zipcode", "zip", "vchpostcode"].includes(key),
  );

  const deepAddress = joinUniqueNonEmptyLines([
    directPracticeName,
    wholeAddress,
    line1,
    line2,
    [suburb, state, postcode].filter(Boolean).join(" "),
  ]);

  if (deepAddress) return deepAddress;

  const candidates = [
    itemAsObject,
    raw,
    referral,
    latestReferral,
    referrer,
    ...getNestedPlainObjects(raw, [
      "clinic",
      "practice",
      "referrerClinic",
      "referrer_clinic",
      "referrerPractice",
      "referrer_practice",
      "providerClinic",
      "provider_clinic",
      "providerPractice",
      "provider_practice",
      "latestReferral",
      "latest_referral",
      "referral",
      "referrer",
    ]),
    ...getNestedPlainObjects(referral, [
      "clinic",
      "practice",
      "provider",
      "referrer",
    ]),
    ...getNestedPlainObjects(latestReferral, [
      "clinic",
      "practice",
      "provider",
      "referrer",
    ]),
    ...getNestedPlainObjects(referrer, ["clinic", "practice", "provider"]),
  ];

  for (const candidate of candidates) {
    const address = getAddressFromObject(candidate);
    if (address) return address;
  }

  return "";
}

function getQueueAppointmentNotes(item: QueueItem) {
  const raw = getQueueRawObject(item);

  const appointmentNotes = getFirstCleanString(raw, [
    "vchAppointmentNotes",
    "appointment_notes",
    "appointmentNotes",
    "notes",
  ]);
  const treatmentType = getFirstCleanString(raw, [
    "vchTxType",
    "vchTreatmentType",
    "treatment_type",
    "appointment_type",
  ]);
  const treatmentLabel = getFirstCleanString(raw, [
    "vchTxLabel",
    "treatment_label",
    "appointment_label",
  ]);

  const lines = [
    appointmentNotes ? `Appointment notes: ${appointmentNotes}` : "",
    treatmentType ? `Treatment type: ${treatmentType}` : "",
    treatmentLabel ? `Treatment label: ${treatmentLabel}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

function getQueueSyncedClinicalNotes(item: QueueItem) {
  const raw = getQueueRawObject(item);

  /*
    Important:
    item.source_clinical_notes and raw.source_clinical_notes are often only
    appointment notes from the lightweight queue sync. Do NOT treat those as
    true same-day clinical notes. Real same-day notes should come from the
    cached Praktika clinical-note lookup fields below.
  */
  const directNotes = getFirstCleanString(raw, [
    "cached_clinical_notes",
    "same_day_clinical_notes",
    "sameDayClinicalNotes",
    "praktika_clinical_notes",
    "praktikaClinicalNotes",
    "patient_clinical_notes",
    "patientClinicalNotes",
    "clinical_notes",
    "clinicalNotes",
    "clinical_notes_text",
    "clinicalNotesText",
    "progress_notes",
    "progressNotes",
    "treatment_notes",
    "treatmentNotes",
    "vchClinicalNotes",
    "vchClinicalNote",
    "vchProgressNotes",
    "vchTreatmentNotes",
  ]);

  const cleanedDirectNotes = cleanClinicalNoteText(directNotes);

  if (cleanedDirectNotes) return cleanedDirectNotes;

  const noteMatches = collectDeepStringMatches(raw, (key) => {
    if (key.includes("appointment")) return false;
    if (key.includes("referral")) return false;
    if (key.includes("referrer")) return false;

    return (
      (key.includes("clinical") && key.includes("note")) ||
      (key.includes("progress") && key.includes("note")) ||
      (key.includes("treatment") && key.includes("note")) ||
      key === "notetext" ||
      key === "notebody" ||
      key === "vchclinicalnotes" ||
      key === "vchprogressnotes" ||
      key === "vchtreatmentnotes"
    );
  });

  return joinUniqueNonEmptyLines(noteMatches.map((match) => match.value));
}

function getQueueClinicalNotes(item: QueueItem) {
  const appointmentNotes = getQueueAppointmentNotes(item);
  const syncedClinicalNotes = getQueueSyncedClinicalNotes(item);

  if (appointmentNotes && syncedClinicalNotes) {
    return [
      appointmentNotes,
      "Same-day Praktika clinical notes:",
      syncedClinicalNotes,
    ].join("\n\n");
  }

  return syncedClinicalNotes || appointmentNotes;
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
  const selectedDraftIdRef = useRef<string | null>(null);
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
  const [typistQueries, setTypistQueries] = useState("");
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
  const letterEditorRef = useRef<RichTextLetterEditorHandle | null>(null);
  const referrerAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const patientDetailsAutosaveTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
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
  const [praktikaPreSyncMessage, setPraktikaPreSyncMessage] = useState<
    string | null
  >(null);
  const [praktikaNeedsReconnect, setPraktikaNeedsReconnect] = useState(false);
  const [praktikaSyncingQueue, setPraktikaSyncingQueue] = useState(false);
  const [praktikaSyncingReferrers, setPraktikaSyncingReferrers] =
    useState(false);
  const [imageDraftId, setImageDraftId] = useState<string | null>(null);
  const [imageDraftCreating, setImageDraftCreating] = useState(false);
  const [imageDraftError, setImageDraftError] = useState<string | null>(null);
  const autoImageDraftQueueIdRef = useRef<string | null>(null);
  const queueSelectionTokenRef = useRef(0);

  // Keeps provider-specific async reloads from overwriting the currently
  // selected provider. This fixes queue/draft counters flashing to another
  // provider when an older request returns late.
  const providerDataRequestRef = useRef(0);
  const selectedProviderIdRef = useRef("");

  useEffect(() => {
    selectedDraftIdRef.current = selectedDraft?.id || null;
  }, [selectedDraft?.id]);

  function isCurrentProviderDataRequest(
    providerId: string,
    requestToken: number,
  ) {
    return (
      providerId === selectedProviderIdRef.current &&
      requestToken === providerDataRequestRef.current
    );
  }

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
          draft.status === "approved" && !Boolean(draft.emailed_to_referrer_at),
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
      draft.status === "approved" && !Boolean(draft.emailed_to_referrer_at),
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
      return "AI is choosing the best report type from the clinical notes...";
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

  function handleTypistQueriesChange(value: string) {
    setTypistQueries(value);

    if (selectedDraft && value !== (selectedDraft.typist_queries || "")) {
      setSaveStatus("unsaved");
    }
  }

  async function previewHtmlPdf() {
    if (!selectedDraft) {
      alert("Please select a draft first.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/generate-pdf-html", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: selectedDraft.id }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to generate HTML PDF.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      setPdfPreviewUrl(url);
      setPdfPreviewTitle(
        `HTML PDF Test - ${selectedDraft.patient_name || "Patient"}.pdf`,
      );
      setPdfPreviewModalOpen(true);
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "Failed to generate HTML PDF.",
      );
    } finally {
      setLoading(false);
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

  async function persistCurrentPatientDetails(options?: { quiet?: boolean }) {
    if (!selectedDraft) return true;

    const currentPatientName = cleanString(patientName);
    const currentPatientDob = cleanString(patientDob);

    const savedPatientName = cleanString(selectedDraft.patient_name);
    const savedPatientDob = cleanString(selectedDraft.patient_dob);

    if (
      currentPatientName === savedPatientName &&
      currentPatientDob === savedPatientDob
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
          patientName: currentPatientName,
          patientDob: currentPatientDob,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error("Failed to save patient details:", data);
        if (!options?.quiet) {
          setSaveStatus("error");
        }
        return false;
      }

      setSelectedDraft((current) =>
        current && current.id === selectedDraft.id
          ? {
              ...current,
              patient_name: currentPatientName || null,
              patient_dob: currentPatientDob || null,
              referrer_name: referrerName || current.referrer_name,
              referrer_address: referrerAddress || current.referrer_address,
              report_type: reportType || current.report_type,
            }
          : current,
      );

      setDrafts((current) =>
        current.map((draft) =>
          draft.id === selectedDraft.id
            ? {
                ...draft,
                patient_name: currentPatientName || null,
                patient_dob: currentPatientDob || null,
              }
            : draft,
        ),
      );

      setLastSavedAt(new Date().toISOString());
      setSaveStatus("saved");
      return true;
    } catch (error) {
      console.error("Failed to persist patient details:", error);
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
      const message =
        "Patient first name and last name are required before uploading images.";
      setImageDraftError(message);
      if (!options?.quiet) alert(message);
      return null;
    }

    const clinicalNotesStillLoading =
      autoGenerateStatus === "loading_notes" ||
      autoGenerateStatus === "selecting_report_type" ||
      clinicalNotes.includes("Loading same-day Praktika clinical notes");

    if (clinicalNotesStillLoading || referralAutoFillStatus === "loading") {
      const message =
        "Please wait until clinical notes and referral details have finished loading before uploading images.";
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
          typistQueries,
          generatedReport: generatedAiLetterText || placeholderText,
          editedText: placeholderText,
          finalApprovedText: placeholderText,
          originalAiText: generatedAiLetterText || placeholderText,
          learnFromEdits: false,
          learningSource: "typist_image_workspace",
          praktikaPatientId: selectedPraktikaPatientId || null,
          queueId: activeQueueItemId,
          // Typist queue workspaces should not appear in the provider Drafts folder.
          // The provider Drafts folder intentionally shows only provider-created drafts with status "draft".
          status: "edited_by_typist",
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(
          data?.error || "Could not prepare image upload workspace.",
        );
      }

      const createdDraftId = String(
        data.draft?.id || data.draftId || data.id || "",
      ).trim();

      if (!createdDraftId) {
        throw new Error(
          "Image workspace was created but no draft ID was returned.",
        );
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
    const placeholder = `

[[IMAGE:${imageNumber}]]

`;

    if (letterEditorRef.current) {
      letterEditorRef.current.insertTextAtCursor(placeholder);
      return;
    }

    handleLetterTextChange(`${letterText}${placeholder}`);
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
          // Important: do not use old report_drafts cache here.
          // Some existing drafts contain duplicated appointment notes, which can
          // incorrectly block the live Praktika clinical-note lookup.
          useCache: false,
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
      const details = [
        data?.error,
        data?.message,
        data?.debug?.message,
        data?.source ? `source: ${data.source}` : "",
        typeof data?.matchedCount !== "undefined"
          ? `matched: ${data.matchedCount}`
          : "",
        typeof data?.totalNotes !== "undefined"
          ? `total notes: ${data.totalNotes}`
          : "",
      ]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" | ");

      throw new Error(
        details ||
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
    if (!selectedDraft) return null;

    const finalPraktikaPatientId =
      selectedPraktikaPatientId || selectedDraft.praktika_patient_id || "";

    if (!finalPraktikaPatientId) {
      alert("Please select the correct Praktika patient first.");
      return null;
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

    const uploadData = await uploadResponse.json().catch(() => ({}));

    if (!uploadResponse.ok || !uploadData.success) {
      alert(uploadData.error || "Failed to upload to Praktika.");
      console.error("Praktika upload error:", uploadData);
      return null;
    }

    setCompleteStep("Updating Praktika letter icon...");

    fetch("/api/report-writing/update-praktika-letter-icons", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queueId: activeQueueItemId,
        draftId: selectedDraft.id,
        praktikaPatientId: finalPraktikaPatientId,
      }),
    })
      .then((response) => response.json())
      .then((iconData) => {
        if (!iconData.success || iconData.iconUpdated === false) {
          console.warn("Praktika icon update skipped or failed:", iconData);
        }
      })
      .catch((error) => {
        console.warn("Praktika icon update request failed:", error);
      });

    return uploadData.stagedPdf || null;
  }

  async function updateWorkflowStatus(
    draftId: string,
    values: {
      workflowStatus?: "running" | "completed" | "failed";
      praktikaUploadStatus?:
        | "not_requested"
        | "pending"
        | "running"
        | "completed"
        | "skipped"
        | "failed";
      iconUpdateStatus?:
        | "not_requested"
        | "pending"
        | "running"
        | "completed"
        | "skipped"
        | "failed";
      medirefStatus?:
        | "not_requested"
        | "pending"
        | "running"
        | "completed"
        | "skipped"
        | "failed";
      periodontalChartStatus?:
        | "not_requested"
        | "pending"
        | "running"
        | "completed"
        | "skipped"
        | "failed";
      message?: string;
      workflowError?: string;
    },
  ) {
    const response = await fetch("/api/report-writing/workflow-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        draftId,
        ...values,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      console.warn("Workflow status update failed:", data);
      return null;
    }

    return data.draft || null;
  }

  async function sendViaMedirefFromModal() {
    if (!selectedDraft) return;

    if (medirefPatientEmail.trim() && hasInvalidEmail(medirefPatientEmail)) {
      alert("Please check the patient email address.");
      return;
    }

    if (!medirefConfirmed) {
      alert("Please tick the confirmation checkbox.");
      return;
    }

    const draftSnapshot = selectedDraft;
    const providerIdSnapshot = selectedProviderId;
    const queueStatusSnapshot = queueStatusTab;
    const activeQueueItemIdSnapshot = activeQueueItemId;
    const completeWorkflow = medirefCompleteWorkflow;
    const attachPeriodontalChartSnapshot = attachPeriodontalChart;

    const workflowPayload = {
      draftId: draftSnapshot.id,
      referrerName: medirefRecipientName.trim(),
      referrerPracticeName: medirefRecipientPracticeName.trim(),
      medirefAutoMatchRecipient: false,
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
      attachPeriodontalChart: attachPeriodontalChartSnapshot,
      praktikaPatientId:
        selectedPraktikaPatientId || draftSnapshot.praktika_patient_id || null,
    };

    if (completeWorkflow) {
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

    const runningDraft = await updateWorkflowStatus(draftSnapshot.id, {
      workflowStatus: "running",
      praktikaUploadStatus: completeWorkflow ? "pending" : "not_requested",
      iconUpdateStatus: completeWorkflow ? "pending" : "not_requested",
      medirefStatus: "pending",
      periodontalChartStatus: attachPeriodontalChartSnapshot
        ? "pending"
        : "not_requested",
      message: completeWorkflow
        ? "Workflow queued. Completing Praktika upload, icon update, and MediRef send."
        : "MediRef send queued.",
    });

    const nextDraft: Draft = runningDraft || {
      ...draftSnapshot,
      workflow_status: "running",
      workflow_praktika_upload_status: completeWorkflow
        ? "pending"
        : "not_requested",
      workflow_icon_update_status: completeWorkflow
        ? "pending"
        : "not_requested",
      workflow_mediref_status: "pending",
      workflow_periodontal_chart_status: attachPeriodontalChartSnapshot
        ? "pending"
        : "not_requested",
      workflow_last_message: completeWorkflow
        ? "Workflow queued. Completing in background."
        : "MediRef send queued.",
    };

    setSelectedDraft(nextDraft);
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === draftSnapshot.id ? nextDraft : draft,
      ),
    );

    setMedirefModalOpen(false);
    setMedirefConfirmed(false);
    setAttachPeriodontalChart(false);
    setMedirefCompleteWorkflow(false);
    setCompleteStep("");

    alert(
      completeWorkflow
        ? "Workflow queued. The letter will stay visible as Completing until all steps finish."
        : "MediRef send queued.",
    );

    runMedirefWorkflowInBackground({
      draft: draftSnapshot,
      payload: workflowPayload,
      completeWorkflow,
      activeQueueItemId: activeQueueItemIdSnapshot,
      providerId: providerIdSnapshot,
      queueStatus: queueStatusSnapshot,
    });
  }

  async function runMedirefWorkflowInBackground(params: {
    draft: Draft;
    payload: any;
    completeWorkflow: boolean;
    activeQueueItemId: string | null;
    providerId: string;
    queueStatus: QueueStatusTab;
  }) {
    try {

      if (params.completeWorkflow) {
        const finalPraktikaPatientId =
          params.payload.praktikaPatientId ||
          params.draft.praktika_patient_id ||
          "";

        if (!finalPraktikaPatientId) {
          await updateWorkflowStatus(params.draft.id, {
            workflowStatus: "failed",
            praktikaUploadStatus: "failed",
            message: "Missing Praktika patient ID.",
            workflowError: "Missing Praktika patient ID.",
          });

          throw new Error("Missing Praktika patient ID.");
        }

        await updateWorkflowStatus(params.draft.id, {
          praktikaUploadStatus: "running",
          message: "Uploading PDF to Praktika.",
        });

        const uploadResponse = await fetch(
          "/api/report-writing/upload-to-praktika",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              draftId: params.draft.id,
              praktikaPatientId: finalPraktikaPatientId,
            }),
          },
        );

        const uploadData = await uploadResponse.json().catch(() => ({}));

        if (!uploadResponse.ok || !uploadData.success) {
          await updateWorkflowStatus(params.draft.id, {
            workflowStatus: "failed",
            praktikaUploadStatus: "failed",
            message: "Praktika upload failed.",
            workflowError:
              uploadData.error || "Failed to upload PDF to Praktika.",
          });

          throw new Error(
            uploadData.error || "Failed to upload PDF to Praktika.",
          );
        }


        await updateWorkflowStatus(params.draft.id, {
          praktikaUploadStatus: "completed",
          iconUpdateStatus: "running",
          message: "PDF uploaded to Praktika. Updating appointment icon.",
        });

        try {
          const iconResponse = await fetch(
            "/api/report-writing/update-praktika-letter-icons",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                queueId: params.activeQueueItemId,
                draftId: params.draft.id,
                praktikaPatientId: finalPraktikaPatientId,
              }),
            },
          );

          const iconData = await iconResponse.json().catch(() => ({}));

          if (!iconResponse.ok || !iconData.success) {
            await updateWorkflowStatus(params.draft.id, {
              iconUpdateStatus: "failed",
              message:
                "PDF uploaded to Praktika, but appointment icon update failed.",
              workflowError:
                iconData.error ||
                "PDF uploaded to Praktika, but appointment icon update failed.",
            });
          } else if (iconData.iconUpdated === false || iconData.skipped) {
            await updateWorkflowStatus(params.draft.id, {
              iconUpdateStatus: "skipped",
              message:
                iconData.reason ||
                "PDF uploaded to Praktika. No pending appointment icon needed updating.",
            });
          } else {
            await updateWorkflowStatus(params.draft.id, {
              iconUpdateStatus: "completed",
              message: "Praktika icon updated. Queuing MediRef send.",
            });
          }
        } catch (iconError) {
          console.warn("Praktika icon update request failed:", iconError);

          await updateWorkflowStatus(params.draft.id, {
            iconUpdateStatus: "failed",
            message:
              "PDF uploaded to Praktika, but appointment icon update request failed.",
            workflowError:
              iconError instanceof Error
                ? iconError.message
                : "Appointment icon update request failed.",
          });
        }
      }

      await updateWorkflowStatus(params.draft.id, {
        medirefStatus: "running",
        periodontalChartStatus: params.payload.attachPeriodontalChart
          ? "running"
          : "not_requested",
        message: params.payload.attachPeriodontalChart
          ? "Preparing periodontal chart and queuing MediRef send."
          : "Queuing MediRef send.",
      });

      const response = await fetch("/api/report-writing/send-via-mediref", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...params.payload,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        await updateWorkflowStatus(params.draft.id, {
          workflowStatus: "failed",
          medirefStatus: "failed",
          periodontalChartStatus: params.payload.attachPeriodontalChart
            ? data.periodontalChartAttached
              ? "completed"
              : "failed"
            : "not_requested",
          message: "MediRef queue failed.",
          workflowError: data.error || "Failed to queue MediRef send.",
        });

        throw new Error(data.error || "Failed to queue MediRef send.");
      }

      await updateWorkflowStatus(params.draft.id, {
        workflowStatus: "running",
        medirefStatus: "pending",
        periodontalChartStatus: params.payload.attachPeriodontalChart
          ? data.periodontalChartAttached
            ? "completed"
            : "skipped"
          : "not_requested",
        message: "MediRef send queued. Waiting for the helper.",
      });

      console.log("Background workflow queued:", data);

      /*
       * The API response only confirms that the MediRef helper job was queued.
       * Poll the existing drafts endpoint so this letter stays visible as
       * Completing and changes to Completed or Failed only after the helper
       * updates report_drafts.
       */
      let finalWorkflowStatus: string | null = null;

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));

        const draftsResponse = await fetch(
          `/api/report-writing/get-drafts?providerId=${params.providerId}`,
        );

        const draftsData = await draftsResponse.json().catch(() => ({}));

        if (!draftsResponse.ok || !draftsData.success) {
          continue;
        }

        const refreshedDrafts: Draft[] = draftsData.drafts || [];
        const refreshedDraft = refreshedDrafts.find(
          (draft) => draft.id === params.draft.id,
        );

        setDrafts(refreshedDrafts);

        if (refreshedDraft) {
          setSelectedDraft((current) =>
            current?.id === refreshedDraft.id ? refreshedDraft : current,
          );

          if (
            refreshedDraft.workflow_status === "completed" ||
            refreshedDraft.workflow_status === "failed"
          ) {
            finalWorkflowStatus = refreshedDraft.workflow_status;
            break;
          }
        }
      }

      await loadDrafts(params.providerId);
      await loadQueue(params.providerId, params.queueStatus);

      if (
        finalWorkflowStatus === "completed" &&
        selectedDraftIdRef.current === params.draft.id
      ) {
        clearForm();
      }
    } catch (error) {
      console.error("Background workflow failed:", error);

      alert(
        error instanceof Error
          ? `Background workflow failed: ${error.message}`
          : "Background workflow failed.",
      );

      await loadDrafts(params.providerId).catch(console.warn);
      await loadQueue(params.providerId, params.queueStatus).catch(
        console.warn,
      );
    }
  }

  async function hydrateQueueInBackground(
    providerId: string,
    status: QueueStatusTab = queueStatusTab,
  ) {
    if (!providerId) return null;

    try {
      const response = await fetch("/api/report-writing/hydrate-letter-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          status,
          limit: 50,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        console.warn("Queue background hydration failed:", data);
        return data;
      }

      if (data.enqueued > 0) {
        console.log(`Queued ${data.enqueued} Praktika queue hydration job(s).`);
      }

      return data;
    } catch (error) {
      console.warn("Queue background hydration request failed:", error);
      return null;
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
      setReportTypes(formatReportTypeOptions(data.types || []));

      if (
        data.types?.length > 0 &&
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

  async function loadDrafts(providerId: string, requestToken?: number) {
    const activeRequestToken = requestToken ?? providerDataRequestRef.current;

    const response = await fetch(
      `/api/report-writing/get-drafts?providerId=${providerId}`,
    );

    const data = await response.json();

    if (!isCurrentProviderDataRequest(providerId, activeRequestToken)) {
      return;
    }

    if (data.success) {
      setDrafts(data.drafts);
    }
  }

  async function loadQueue(
    providerId: string,
    status: QueueStatusTab = queueStatusTab,
    requestToken?: number,
  ) {
    const activeRequestToken = requestToken ?? providerDataRequestRef.current;

    const params = new URLSearchParams();
    params.set("providerId", providerId);
    params.set("status", status);

    const response = await fetch(
      `/api/report-writing/letter-queue?${params.toString()}`,
    );

    const data = await response.json();

    if (!isCurrentProviderDataRequest(providerId, activeRequestToken)) {
      return;
    }

    if (data.success) {
      setQueue(data.queue);

      const hydrationResult = await hydrateQueueInBackground(
        providerId,
        status,
      );

      if (!isCurrentProviderDataRequest(providerId, activeRequestToken)) {
        return;
      }

      if (hydrationResult?.enqueued > 0) {
        window.setTimeout(() => {
          if (isCurrentProviderDataRequest(providerId, activeRequestToken)) {
            loadQueue(providerId, status, activeRequestToken);
          }
        }, 15000);
      }
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!selectedProviderId) return;

    loadReportTypesForProvider(selectedProviderId);
  }, [selectedProviderId]);

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
    selectedProviderIdRef.current = selectedProviderId;

    if (selectedProviderId) {
      const requestToken = providerDataRequestRef.current + 1;
      providerDataRequestRef.current = requestToken;

      loadDrafts(selectedProviderId, requestToken);
      loadReportTypes(selectedProviderId);
      loadQueue(selectedProviderId, queueStatusTab, requestToken);
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
            typistQueries,
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
            ? {
                ...current,
                edited_text: finalLetterTextForSave,
                typist_queries: typistQueries || null,
              }
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
  }, [letterText, pdfCcText, pdfLetterDate, typistQueries, selectedDraft]);

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

  useEffect(() => {
    if (!selectedDraft) return;

    const currentPatientName = cleanString(patientName);
    const currentPatientDob = cleanString(patientDob);

    const savedPatientName = cleanString(selectedDraft.patient_name);
    const savedPatientDob = cleanString(selectedDraft.patient_dob);

    if (
      currentPatientName === savedPatientName &&
      currentPatientDob === savedPatientDob
    ) {
      return;
    }

    setSaveStatus("unsaved");

    if (patientDetailsAutosaveTimerRef.current) {
      clearTimeout(patientDetailsAutosaveTimerRef.current);
    }

    patientDetailsAutosaveTimerRef.current = setTimeout(() => {
      persistCurrentPatientDetails({ quiet: true });
    }, 700);

    return () => {
      if (patientDetailsAutosaveTimerRef.current) {
        clearTimeout(patientDetailsAutosaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraft?.id, patientName, patientDob]);

  function clearForm() {
    queueSelectionTokenRef.current += 1;
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
    setTypistQueries("");
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
    queueSelectionTokenRef.current += 1;
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
    setTypistQueries(draft.typist_queries || "");

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
    queueIdForCache?: string | null,
  ) {
    if (!praktikaPatientId) {
      console.warn("Auto-referrer lookup skipped: no Praktika patient ID", {
        activeQueueItemId,
        selectedDraftId: selectedDraft?.id,
        selectedDraftPraktikaPatientId: selectedDraft?.praktika_patient_id,
        patientName,
      });
      setLatestPraktikaReferral(null);
      setReferralAutoFillError(
        "No Praktika patient ID is linked to this queue item or draft.",
      );
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

      const queueId = queueIdForCache || activeQueueItemId;

      if (queueId) {
        try {
          await fetch("/api/report-writing/letter-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              queueId,
              status: "started",
              referrerName: referral.referrerName,
              referrerAddress: referral.referrerAddress || "",
            }),
          });

          setQueue((current) =>
            current.map((queueItem) => {
              if (queueItem.id !== queueId) return queueItem;

              return {
                ...queueItem,
                status:
                  queueItem.status === "completed" ? "completed" : "started",
                referrer_name: referral.referrerName,
                referrer_address:
                  referral.referrerAddress || queueItem.referrer_address,
                raw_json: {
                  ...(queueItem.raw_json || {}),
                  latest_referral: referral,
                  referral_autofill_at: new Date().toISOString(),
                },
              };
            }),
          );
        } catch (cacheError) {
          console.warn(
            "Could not cache referrer details to queue:",
            cacheError,
          );
        }
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

  async function loadReportTypesForProvider(providerId: string) {
    if (!providerId) return;

    const response = await fetch(
      `/api/report-writing/correspondence-types?providerId=${providerId}`,
    );

    const data = await response.json();

    if (data.success) {
      const types = data.types || [];

      setReportTypes(types);

      if (types.length > 0) {
        setReportType(types[0].value);
      }
    }
  }

  async function startLetterFromQueue(item: QueueItem) {
    const selectionToken = queueSelectionTokenRef.current + 1;
    queueSelectionTokenRef.current = selectionToken;

    const isCurrentQueueSelection = () =>
      queueSelectionTokenRef.current === selectionToken;

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

    const appointmentDate = item.appointment_time?.slice(0, 10) || "";

    setAutoGenerateStatus("selecting_report_type");

    const inferredReportType = inferReportTypeFromQueueItem(item, reportTypes);

    const appointmentNotes = getQueueAppointmentNotes(item);
    const cachedClinicalNotes = getQueueSyncedClinicalNotes(item);
    const cachedReferrerName = getQueueReferrerName(item);
    const cachedReferrerAddress = getQueueReferrerAddress(item);
    const latestReferral = asPlainObject(
      raw.latest_referral || raw.latestReferral,
    );
    const latestReferralForState =
      Object.keys(latestReferral).length > 0
        ? (latestReferral as unknown as LatestPraktikaReferral)
        : null;

    const hasCachedReferrer = Boolean(
      cachedReferrerName.trim() && cachedReferrerAddress.trim(),
    );
    const hasCachedClinicalNotes = Boolean(cachedClinicalNotes.trim());

    setPatientFirstName(firstName);
    setPatientLastName(lastName);
    setPatientDob(dob);
    setPatientGender(item.patient_gender || "neutral");
    setReferrerName(cachedReferrerName);
    setReferrerAddress(cachedReferrerAddress);
    setLatestPraktikaReferral(latestReferralForState);
    setReferralAutoFillError("");
    setReferralAutoFillStatus(hasCachedReferrer ? "found" : "idle");
    setReportType(inferredReportType);
    setPreferredExampleId("");
    setLetterText("");
    setGeneratedAiLetterText("");
    setPdfCcText("");
    setPdfLetterDate(
      item.appointment_time?.slice(0, 10) ||
        new Date().toISOString().slice(0, 10),
    );
    setPraktikaCandidates([]);
    setSelectedPraktikaPatientId(linkedPraktikaPatientId);

    // Mark the row started without forcing a live referral/notes reload.
    if (item.status !== "completed") {
      void fetch("/api/report-writing/letter-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          queueId: item.id,
          status: "started",
        }),
      }).catch((error) => {
        console.warn("Could not mark queue item as started:", error);
      });

      setQueue((current) =>
        current.map((queueItem) =>
          queueItem.id === item.id
            ? { ...queueItem, status: "started" }
            : queueItem,
        ),
      );
    }

    if (hasCachedReferrer) {
      setReferralAutoFillStatus("found");
    } else if (linkedPraktikaPatientId) {
      void autoFillReferrerFromLatestPraktikaReferral(
        linkedPraktikaPatientId,
        item.id,
      );
    } else {
      setLatestPraktikaReferral(null);
      setReferralAutoFillError(
        "No Praktika patient ID is linked to this queue item.",
      );
      setReferralAutoFillStatus("not_found");
    }

    if (hasCachedClinicalNotes) {
      const combinedCachedClinicalNotes = [
        appointmentNotes,
        appointmentNotes ? "Same-day Praktika clinical notes:" : "",
        cachedClinicalNotes,
      ]
        .filter(Boolean)
        .join("\n\n");

      setClinicalNotes(combinedCachedClinicalNotes || cachedClinicalNotes);

      const aiReportType = await classifyReportTypeWithAi({
        providerId: selectedProviderId,
        clinicalNotes: combinedCachedClinicalNotes || cachedClinicalNotes,
        appointmentNotes,
        reportTypes,
        fallbackReportType: inferredReportType,
      });

      if (!isCurrentQueueSelection()) return;

      setReportType(aiReportType);
      setAutoGenerateStatus("ready");
      return;
    }

    const initialClinicalNotes = [
      appointmentNotes,
      linkedPraktikaPatientId && appointmentDate
        ? "Loading same-day Praktika clinical notes..."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    setClinicalNotes(initialClinicalNotes || appointmentNotes);

    let sameDayClinicalNotes = "";

    if (linkedPraktikaPatientId && appointmentDate) {
      try {
        sameDayClinicalNotes = await pullSameDayClinicalNotes({
          patientId: linkedPraktikaPatientId,
          appointmentDate,
          appointmentId,
        });

        if (!isCurrentQueueSelection()) return;

        sameDayClinicalNotes = cleanClinicalNoteText(sameDayClinicalNotes);

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

          if (!isCurrentQueueSelection()) return;

          setQueue((current) =>
            current.map((queueItem) => {
              if (queueItem.id !== item.id) return queueItem;

              return {
                ...queueItem,
                status: item.status === "completed" ? "completed" : "started",
                source_clinical_notes: sameDayClinicalNotes,
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
        if (!isCurrentQueueSelection()) return;

        console.error("Failed to pull Praktika clinical notes:", error);

        const fallbackCachedNotes = cleanClinicalNoteText(
          raw.cached_clinical_notes,
        );
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Unknown clinical notes lookup error.";

        if (fallbackCachedNotes) {
          const fallbackCombinedNotes = [
            appointmentNotes,
            "Same-day Praktika clinical notes:",
            fallbackCachedNotes,
            `Clinical notes live refresh warning: ${errorMessage}`,
          ]
            .filter(Boolean)
            .join("\n\n");

          setClinicalNotes(fallbackCombinedNotes);
        } else {
          const fallbackNotes = [
            appointmentNotes,
            `Same-day Praktika clinical notes could not be loaded: ${errorMessage}`,
            "Existing appointment notes have been preserved.",
          ]
            .filter(Boolean)
            .join("\n\n");

          setClinicalNotes(fallbackNotes);
        }

        setAutoGenerateStatus("error");
        return;
      }
    }

    if (!isCurrentQueueSelection()) return;

    const combinedClinicalNotes = [
      appointmentNotes,
      sameDayClinicalNotes ? "Same-day Praktika clinical notes:" : "",
      sameDayClinicalNotes,
    ]
      .filter(Boolean)
      .join("\n\n");

    setClinicalNotes(combinedClinicalNotes || appointmentNotes);

    const aiReportType = await classifyReportTypeWithAi({
      providerId: selectedProviderId,
      clinicalNotes: combinedClinicalNotes || appointmentNotes,
      appointmentNotes,
      reportTypes,
      fallbackReportType: inferredReportType,
    });

    if (!isCurrentQueueSelection()) return;

    setReportType(aiReportType);
    setAutoGenerateStatus("ready");
  }

  useEffect(() => {
    if (!activeQueueItemId) return;
    if (selectedDraft || imageDraftId || imageDraftCreating) return;
    if (!patientFirstName.trim() || !patientLastName.trim()) return;

    // Prevent creating the temporary image/draft workspace while live clinical
    // notes or referral details are still loading. This is the race-condition fix.
    if (autoGenerateStatus !== "ready" && autoGenerateStatus !== "error")
      return;
    if (referralAutoFillStatus === "loading") return;
    if (clinicalNotes.includes("Loading same-day Praktika clinical notes"))
      return;

    if (autoImageDraftQueueIdRef.current === activeQueueItemId) return;

    autoImageDraftQueueIdRef.current = activeQueueItemId;
    void ensureImageDraftForCurrentWork({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeQueueItemId,
    selectedDraft?.id,
    imageDraftId,
    imageDraftCreating,
    patientFirstName,
    patientLastName,
    autoGenerateStatus,
    referralAutoFillStatus,
    clinicalNotes,
  ]);

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

  async function deleteQueueItem(item: QueueItem) {
    const displayName =
      [item.patient_first_name, item.patient_last_name]
        .filter(Boolean)
        .join(" ") || "this queue item";

    const confirmed = window.confirm(
      `Delete ${displayName} from the typist queue? This will only remove the item from DocuDental. It will not delete anything from Praktika.`,
    );

    if (!confirmed) return;

    setLoading(true);

    try {
      const response = await fetch("/api/report-writing/letter-queue", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          queueId: item.id,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to delete queue item.");
        return;
      }

      if (activeQueueItemId === item.id) {
        clearForm();
      }

      await loadQueue(selectedProviderId, queueStatusTab);
    } catch (error) {
      console.error("Failed to delete queue item:", error);
      alert("Failed to delete queue item.");
    } finally {
      setLoading(false);
    }
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
      const response = await fetch(
        "/api/report-writing/referrers/sync-praktika",
        {
          method: "POST",
        },
      );

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

  // Replace only the existing syncQueueRange() function in TypistPage.tsx with this version.
  // It keeps appointment sync fast, then enriches a small batch of saved queue rows.

  // Replace only the existing syncQueueRange() function in TypistPage.tsx with this version.
  // It syncs appointments quickly, then automatically enriches queue rows one-at-a-time
  // so staff do not need to keep clicking Sync.

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
              "Praktika needs to be reconnected before the queue can be synced.",
          );
        }

        if (!needsReconnect) {
          alert(data?.error || "Failed to sync Praktika letter queue.");
        }
        return;
      }

      setPraktikaNeedsReconnect(false);
      setPraktikaPreSyncMessage(
        `Queue synced. ${data.queued || 0} item(s) found. Background hydration has been queued where needed, so referral details and same-day clinical notes can load before you click each item.`,
      );

      await loadQueue(selectedProviderId, queueStatusTab);
    } catch (error) {
      console.error("Failed to sync Praktika queue:", error);

      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "Queue sync is taking too long. The helper may still be running in the background. Wait a minute, then refresh and check the queue."
          : error instanceof Error
            ? error.message
            : "Failed to sync Praktika queue.";

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
            typistQueries,
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
              : status === "edited_by_typist"
                ? "Draft saved for typist."
                : "Draft saved.",
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
          typistQueries,
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
            : status === "edited_by_typist"
              ? "Draft saved for typist."
              : "Draft saved.",
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
          typistQueries,
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
        typist_queries: typistQueries || null,
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
          alert(
            "Could not save the referrer details before generating the PDF. Please try again.",
          );
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
          alert(
            "Could not save the referrer details before previewing the PDF. Please try again.",
          );
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

            {selectedProviderId ? (
              <div className="mt-4">
                <TypistProviderSmsBox selectedProviderId={selectedProviderId} />
              </div>
            ) : null}

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
                <div
                  key={item.id}
                  className={[
                    "w-full rounded-xl border bg-white p-3 text-left",
                    item.status === "completed" ? "opacity-90" : "",
                    activeQueueItemId === item.id
                      ? "border-blue-600 ring-2 ring-blue-100"
                      : "border-slate-200",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={async () => {
                      if (item.status === "completed") return;

                      await startLetterFromQueue(item);
                      await markQueueItemStarted(item);
                    }}
                    className={[
                      "w-full text-left",
                      item.status === "completed"
                        ? "cursor-default"
                        : "rounded-lg hover:bg-slate-50",
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
                          {formatAppointmentDateTime(item.appointment_time)}
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

                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteQueueItem(item);
                      }}
                      disabled={loading}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Delete ${
                        [item.patient_first_name, item.patient_last_name]
                          .filter(Boolean)
                          .join(" ") || "queue item"
                      }`}
                      title="Delete queue item"
                    >
                      <TrashBinIcon />
                    </button>
                  </div>
                </div>
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
                        {formatReportType(draft.report_type)}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        {draft.status}
                      </div>

                      {draft.workflow_status === "running" ? (
                        <div className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Completing...
                        </div>
                      ) : null}

                      {draft.workflow_status === "failed" ? (
                        <div className="mt-2 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Needs attention
                        </div>
                      ) : null}

                      {draft.workflow_last_message &&
                      draft.workflow_status !== "completed" ? (
                        <div className="mt-1 text-xs text-slate-500">
                          {draft.workflow_last_message}
                        </div>
                      ) : null}

                      {draft.workflow_error &&
                      draft.workflow_status === "failed" ? (
                        <div className="mt-1 text-xs text-red-600">
                          {draft.workflow_error}
                        </div>
                      ) : null}

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
            <div className="rounded-2xl border border-sky-300 bg-sky-50 p-4 text-sm shadow-sm">
              <label className="block text-sm font-bold text-sky-950">
                Queries for provider
              </label>
              <p className="mt-1 text-xs text-sky-700">
                Internal notes from the typist for the provider. These will not
                be included in the letter. This can be written before the letter
                is saved or approved.
              </p>
              <textarea
                className="mt-3 h-28 w-full rounded-xl border border-sky-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                placeholder="Examples: please confirm tooth number, check whether PA X-ray should be attached, confirm wording..."
                value={typistQueries}
                onChange={(e) => handleTypistQueriesChange(e.target.value)}
              />
            </div>
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
                  selectedName={referrerName}
                  selectedAddress={referrerAddress}
                  onClear={() => {
                    setReferrerName("");
                    setReferrerAddress("");
                    setReferralAutoFillError("");
                    setReferralAutoFillStatus("idle");
                  }}
                  onSelect={(referrer) => {
                    setReferrerName(referrer.name);
                    setReferrerAddress(formatManualReferrerAddress(referrer));
                    setReferralAutoFillError("");
                    setReferralAutoFillStatus("found");
                  }}
                />

                {referralAutoFillStatus === "loading" ? (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    Looking up latest Praktika referral...
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
                    Saved queue data did not include full referrer details. Use
                    manual referrer search.
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
                      {[referrerName, referrerAddress]
                        .filter(Boolean)
                        .join("\n")}
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
                          Internal action notes only — do not include this text
                          in the letter.
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
              <div className="mb-3">
                <div className="text-sm font-bold text-slate-900">
                  Letter text
                </div>
                <div className="text-xs text-slate-500">
                  Highlight text, then use the toolbar for bold, italic,
                  underline, bullets, or numbered lists.
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-blue-950">
                      Place an image in the letter
                    </div>
                    <div className="mt-1 text-xs text-blue-800">
                      Click in the letter where the image should appear, then
                      choose an image number. Image size, crop and alignment are
                      still controlled in the image panel below.
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

              <RichTextLetterEditor
                ref={letterEditorRef}
                value={letterText}
                onChange={handleLetterTextChange}
                placeholder="Letter text..."
                minHeightClassName="min-h-96"
              />

              <label className="mt-4 block rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                <div className="text-sm font-bold text-indigo-950">
                  PDF cc line after signature, optional
                </div>
                <div className="mt-1 text-xs text-indigo-900">
                  Search for a referrer to add a CC line, or type/edit the CC
                  text manually. The PDF will show this under the signature as
                  italic.
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
                  placeholder={
                    "Dr Smith\nBrisbane Dental Clinic\n111 Brisbane Rd, Brisbane."
                  }
                  value={pdfCcText}
                  onChange={(e) => setPdfCcText(e.target.value)}
                />
              </label>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-950">
                    Images for this letter
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload images before or after the formal draft is saved.
                    When you are working from the queue, a temporary draft
                    workspace is prepared automatically so images can be
                    attached straight away.
                  </p>
                </div>

                {!currentImageDraftId ? (
                  <button
                    type="button"
                    onClick={() => ensureImageDraftForCurrentWork()}
                    disabled={imageDraftCreating || loading}
                    className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {imageDraftCreating
                      ? "Preparing..."
                      : "Enable image uploads"}
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
                  Select a queue item or enter patient details, then click
                  Enable image uploads. You do not need to manually save the
                  letter first.
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
                  onClick={() => saveNewDraft("edited_by_typist")}
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
                      type="button"
                      onClick={previewHtmlPdf}
                      disabled={loading || !selectedDraft}
                      className="rounded-xl border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-semibold text-purple-800 hover:bg-purple-100 disabled:opacity-50"
                    >
                      Test HTML PDF
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
                <h2 className="text-lg font-bold text-slate-950">
                  Preview PDF
                </h2>
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
                This will queue the branded PDF for the Cloud MediRef helper.
                The helper will prepare the letter in the shared practice
                MediRef session.
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
                  {reportTypes.find(
                    (type) => type.value === selectedDraft?.report_type,
                  )?.label ||
                    reportTypes.find((type) => type.value === reportType)
                      ?.label ||
                    selectedDraft?.report_type ||
                    reportType}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                <div className="font-semibold">MediRef draft preparation</div>
                <p className="mt-1 text-sm">
                  The helper will open the shared practice MediRef session,
                  enter the patient details, attach the branded PDF, add the
                  message below, and leave the prepared draft open in MediRef.
                </p>
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
                  This fills the patient email field in MediRef. It is separate
                  from doctor/referrer CC recipients.
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
                    !(
                      selectedPraktikaPatientId ||
                      selectedDraft?.praktika_patient_id
                    )
                  }
                  onChange={(event) =>
                    setAttachPeriodontalChart(event.target.checked)
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">
                    Attach periodontal chart
                  </span>
                  <br />
                  Optional. Only available when a Praktika patient is linked.
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <input
                  type="checkbox"
                  checked={medirefConfirmed}
                  onChange={(event) =>
                    setMedirefConfirmed(event.target.checked)
                  }
                  className="mt-1"
                />
                <span>
                  I have checked the patient details, patient email, message,
                  and attachments before preparing the MediRef draft.
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
                {loading
                  ? medirefCompleteWorkflow
                    ? "Completing..."
                    : "Queuing..."
                  : medirefCompleteWorkflow
                    ? "Complete Workflow + Prepare MediRef Draft"
                    : "Prepare MediRef Draft"}
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
