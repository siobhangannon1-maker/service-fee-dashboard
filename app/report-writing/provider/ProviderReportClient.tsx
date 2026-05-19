"use client"

import { useEffect, useMemo, useState } from "react"
import ReferrerSearchBox from "@/components/report-writing/ReferrerSearchBox"
import SyncReferrersButton from "@/components/report-writing/SyncReferrersButton"
import PraktikaSessionPanel from "@/components/PraktikaSessionPanel"
import OpenAIDictationBox from "@/components/report-writing/OpenAIDictationBox"
import SmartDictateBox from "@/components/report-writing/SmartDictateBox"

// Drop-in replacement for:
// app/report-writing/provider/ProviderReportClient.tsx
//
// Adds:
// - cleaner provider approval inbox
// - clear status/action cards
// - original AI vs current edited comparison
// - provider approval learning saved through /api/report-writing/update-draft
// - safer API JSON handling
// - better empty states and counters

type ReportTypeOption = {
  value: string
  label: string
}

type Draft = {
  id: string
  patient_name: string | null
  patient_dob: string | null
  referrer_name: string | null
  referrer_address: string | null
  report_type: string
  edited_text: string | null
  ai_generated_text: string | null
  status: string
  created_at: string
  provider_approved_at?: string | null
  uploaded_to_praktika?: boolean | null
  uploaded_to_praktika_at?: string | null
  emailed_to_referrer_at?: string | null
  emailed_to_referrer_email?: string | null
  praktika_patient_id?: string | null
}

type ProviderReportClientProps = {
  providerId: string
}

type PraktikaCandidate = {
  id: string
  firstName: string
  lastName: string
  dob: string
  matchScore: number | null
  matchReason: string
}

type PatientAndReferrerFieldsProps = {
  patientFirstName: string
  setPatientFirstName: (value: string) => void
  patientLastName: string
  setPatientLastName: (value: string) => void
  patientDob: string
  setPatientDob: (value: string) => void
  reportType: string
  setReportType: (value: string) => void
  reportTypes: ReportTypeOption[]
  referrerName: string
  setReferrerName: (value: string) => void
  referrerAddress: string
  setReferrerAddress: (value: string) => void
  selectedPraktikaPatientId: string
  setSelectedPraktikaPatientId: (value: string) => void
  praktikaCandidates: PraktikaCandidate[]
  setPraktikaCandidates: (value: PraktikaCandidate[]) => void
  matchingPatient: boolean
  onSearchPraktikaPatient: () => void
}

type ActiveTab = "smart" | "dictate" | "notes" | "approval" | "approved"

function PatientAndReferrerFields({
  patientFirstName,
  setPatientFirstName,
  patientLastName,
  setPatientLastName,
  patientDob,
  setPatientDob,
  reportType,
  setReportType,
  reportTypes,
  referrerName,
  setReferrerName,
  referrerAddress,
  setReferrerAddress,
  selectedPraktikaPatientId,
  setSelectedPraktikaPatientId,
  praktikaCandidates,
  setPraktikaCandidates,
  matchingPatient,
  onSearchPraktikaPatient,
}: PatientAndReferrerFieldsProps) {
  const [dobFocused, setDobFocused] = useState(false)

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
            "w-full rounded-xl border border-slate-300 p-3",
            !patientDob && !dobFocused ? "text-transparent" : "text-slate-900",
          ].join(" ")}
          type="date"
          value={patientDob}
          onFocus={() => setDobFocused(true)}
          onBlur={() => setDobFocused(false)}
          onChange={(e) => setPatientDob(e.target.value)}
        />
      </div>

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
        onSelect={(referrer) => {
          setReferrerName(referrer.name)
          setReferrerAddress(referrer.address || "")
        }}
      />

      <input
        className="rounded-xl border border-slate-300 p-3"
        placeholder="Referrer Name"
        value={referrerName}
        onChange={(e) => setReferrerName(e.target.value)}
      />

      <textarea
        className="rounded-xl border border-slate-300 p-3 md:col-span-2"
        placeholder="Referrer address"
        value={referrerAddress}
        onChange={(e) => setReferrerAddress(e.target.value)}
      />

      <section className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 md:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-indigo-950">Praktika Patient Match</h3>
            <p className="mt-1 text-sm text-indigo-900">
              Search Praktika and select the patient this letter applies to.
              This ID is saved with the draft for the typist upload workflow.
            </p>
          </div>

          <button
            type="button"
            onClick={onSearchPraktikaPatient}
            disabled={matchingPatient || !patientFirstName.trim() || !patientLastName.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {matchingPatient ? "Searching..." : "Search Praktika"}
          </button>
        </div>

        {selectedPraktikaPatientId ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="font-semibold">Selected Praktika patient</div>
            <div className="mt-1">Patient ID: {selectedPraktikaPatientId}</div>
            <button
              type="button"
              onClick={() => {
                setSelectedPraktikaPatientId("")
                setPraktikaCandidates([])
              }}
              className="mt-2 rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-800"
            >
              Clear match
            </button>
          </div>
        ) : null}

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
                    name="providerPraktikaPatient"
                    checked={selectedPraktikaPatientId === candidate.id}
                    onChange={() => setSelectedPraktikaPatientId(candidate.id)}
                    className="mt-1"
                  />

                  <div>
                    <div className="font-semibold text-slate-950">
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
        ) : null}
      </section>
    </div>
  )
}

function splitPatientName(name: string | null) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded"

  try {
    return new Date(value).toLocaleString("en-AU")
  } catch {
    return value
  }
}

function getReportText(draft: Draft | null) {
  return draft?.edited_text || draft?.ai_generated_text || ""
}

function learningWillBeSaved(draft: Draft | null) {
  if (!draft) return false

  const original = String(draft.ai_generated_text || "").trim()
  const final = String(draft.edited_text || "").trim()

  return Boolean(original && final && original !== final)
}

async function readJsonSafely(response: Response) {
  const text = await response.text()

  if (!text.trim()) {
    return { success: false, error: "Empty server response." }
  }

  try {
    return JSON.parse(text)
  } catch {
    return {
      success: false,
      error: "Server returned non-JSON response.",
      preview: text.slice(0, 500),
    }
  }
}

export default function ProviderReportClient({
  providerId,
}: ProviderReportClientProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("smart")

  const [reportTypes, setReportTypes] = useState<ReportTypeOption[]>([
    { value: "consultation_report", label: "Consultation Report" },
  ])

  const [patientFirstName, setPatientFirstName] = useState("")
  const [patientLastName, setPatientLastName] = useState("")
  const [patientDob, setPatientDob] = useState("")
  const [referrerName, setReferrerName] = useState("")
  const [referrerAddress, setReferrerAddress] = useState("")
  const [reportType, setReportType] = useState("consultation_report")
  const [clinicalNotes, setClinicalNotes] = useState("")
  const [generatedReport, setGeneratedReport] = useState("")
  const [originalGeneratedReport, setOriginalGeneratedReport] = useState("")
  const [dictatedLetter, setDictatedLetter] = useState("")
  const [selectedPraktikaPatientId, setSelectedPraktikaPatientId] =
    useState("")
  const [praktikaCandidates, setPraktikaCandidates] = useState<
    PraktikaCandidate[]
  >([])
  const [matchingPatient, setMatchingPatient] = useState(false)

  const [approvalDrafts, setApprovalDrafts] = useState<Draft[]>([])
  const [approvedDrafts, setApprovedDrafts] = useState<Draft[]>([])
  const [selectedApprovalDraft, setSelectedApprovalDraft] =
    useState<Draft | null>(null)
  const [selectedApprovedDraft, setSelectedApprovedDraft] =
    useState<Draft | null>(null)

  const [loading, setLoading] = useState(false)
  const [savedMessage, setSavedMessage] = useState("")
  const [approvalSearch, setApprovalSearch] = useState("")
  const [approvedSearch, setApprovedSearch] = useState("")
  const [showOriginal, setShowOriginal] = useState(false)

  const patientName = `${patientFirstName} ${patientLastName}`.trim()

  const filteredApprovalDrafts = useMemo(() => {
    const query = approvalSearch.trim().toLowerCase()
    if (!query) return approvalDrafts

    return approvalDrafts.filter((draft) => {
      return [draft.patient_name, draft.referrer_name, draft.report_type]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [approvalDrafts, approvalSearch])

  const filteredApprovedDrafts = useMemo(() => {
    const query = approvedSearch.trim().toLowerCase()
    if (!query) return approvedDrafts

    return approvedDrafts.filter((draft) => {
      return [draft.patient_name, draft.referrer_name, draft.report_type]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [approvedDrafts, approvedSearch])

  async function loadReportTypes() {
    const response = await fetch(
      `/api/report-writing/correspondence-types?providerId=${providerId}`
    )

    const data = await readJsonSafely(response)

    if (data.success) {
      setReportTypes(data.types || [])

      if (
        data.types?.length > 0 &&
        !data.types.some((type: ReportTypeOption) => type.value === reportType)
      ) {
        setReportType(data.types[0].value)
      }
    }
  }

  async function loadDrafts() {
    const response = await fetch(
      `/api/report-writing/get-drafts?providerId=${providerId}`
    )

    const data = await readJsonSafely(response)

    if (data.success) {
      const drafts: Draft[] = data.drafts || []

      setApprovalDrafts(
        drafts.filter(
          (draft: Draft) => draft.status === "awaiting_provider_approval"
        )
      )

      setApprovedDrafts(
        drafts.filter((draft: Draft) => draft.status === "approved")
      )
    }
  }

  useEffect(() => {
    loadDrafts()
    loadReportTypes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function validatePatientName() {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first name and last name are required.")
      return false
    }

    return true
  }

  async function searchPraktikaPatientMatch() {
    if (!validatePatientName()) return

    setMatchingPatient(true)
    setPraktikaCandidates([])
    setSelectedPraktikaPatientId("")
    setSavedMessage("")

    try {
      const response = await fetch("/api/report-writing/match-praktika-patient", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patientName,
          patientDob,
        }),
      })

      const data = await readJsonSafely(response)

      if (!data.success) {
        alert(data.error || "Failed to search Praktika.")
        return
      }

      const candidates: PraktikaCandidate[] = data.candidates || []
      setPraktikaCandidates(candidates)

      if (candidates.length === 1) {
        setSelectedPraktikaPatientId(candidates[0].id)
      }

      if (candidates.length === 0) {
        setSavedMessage("No Praktika patient matches found.")
      }
    } finally {
      setMatchingPatient(false)
    }
  }

  function clearPatientMatch() {
    setSelectedPraktikaPatientId("")
    setPraktikaCandidates([])
  }

  function clearGeneratedForm() {
    setGeneratedReport("")
    setOriginalGeneratedReport("")
    setClinicalNotes("")
    setSavedMessage("")
    clearPatientMatch()
  }

  async function handleGenerateFromNotes() {
    if (!validatePatientName()) return

    if (!clinicalNotes.trim()) {
      alert("Enter clinical notes first.")
      return
    }

    setLoading(true)
    setSavedMessage("")

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
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
        }),
      })

      const data = await readJsonSafely(response)

      if (!data.success) {
        alert(data.error || "Failed to generate report")
        return
      }

      setGeneratedReport(data.report)
      setOriginalGeneratedReport(data.report)
    } catch (error) {
      console.error(error)
      alert("Error generating report")
    } finally {
      setLoading(false)
    }
  }

  async function saveNotesDraft() {
    if (!validatePatientName()) return

    if (!generatedReport.trim()) {
      alert("Generate or write a report before saving.")
      return
    }

    const originalAiText = originalGeneratedReport || generatedReport
    const finalApprovedText = generatedReport
    const hasEditedAiText =
      originalAiText.trim() !== finalApprovedText.trim() &&
      Boolean(originalAiText.trim())

    setLoading(true)
    setSavedMessage("")

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
          generatedReport: originalAiText,
          editedText: finalApprovedText,
          originalAiText,
          finalApprovedText,
          learnFromEdits: hasEditedAiText,
          learningSource: "provider_direct_generation_approval",
          sourceType: "clinical_notes",
          status: "approved",
          praktikaPatientId: selectedPraktikaPatientId || null,
        }),
      })

      const data = await readJsonSafely(response)

      if (!data.success) {
        alert(data.error || "Failed to save draft")
        return
      }

      setSavedMessage(
        hasEditedAiText
          ? "Report saved, approved, and edits saved for learning."
          : "Report saved and automatically approved."
      )
      clearGeneratedForm()
      await loadDrafts()
    } finally {
      setLoading(false)
    }
  }

  async function saveDictatedLetter() {
    if (!validatePatientName()) return

    if (!dictatedLetter.trim()) {
      alert("Dictate or enter the letter first.")
      return
    }

    setLoading(true)
    setSavedMessage("")

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
          generatedReport: dictatedLetter,
          editedText: dictatedLetter,
          sourceType: "dictation",
          status: "approved",
          learnFromEdits: false,
          praktikaPatientId: selectedPraktikaPatientId || null,
        }),
      })

      const data = await readJsonSafely(response)

      if (!data.success) {
        alert(data.error || "Failed to save dictated letter")
        return
      }

      setSavedMessage("Dictated letter saved and automatically approved.")
      setDictatedLetter("")
      await loadDrafts()
    } finally {
      setLoading(false)
    }
  }

  async function approveDraft() {
    if (!selectedApprovalDraft) return

    const finalText = selectedApprovalDraft.edited_text || ""
    const originalAiText = selectedApprovalDraft.ai_generated_text || ""
    const hasEditedAiText =
      Boolean(originalAiText.trim()) && originalAiText.trim() !== finalText.trim()

    const confirmed = confirm(
      hasEditedAiText
        ? "Approve this letter and save the provider edits for future learning?"
        : "Approve this letter?"
    )

    if (!confirmed) return

    setLoading(true)

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
        }),
      })

      const data = await readJsonSafely(response)

      if (!data.success) {
        alert(data.error || "Failed to approve draft")
        return
      }

      alert(
        hasEditedAiText
          ? "Letter approved and learning saved."
          : "Letter approved."
      )

      setSelectedApprovalDraft(null)
      setActiveTab("approved")
      await loadDrafts()
    } finally {
      setLoading(false)
    }
  }

  async function returnToTypist() {
    if (!selectedApprovalDraft) return

    const confirmed = confirm("Return this letter to the typist for more edits?")
    if (!confirmed) return

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedApprovalDraft.id,
          editedText: selectedApprovalDraft.edited_text || "",
          status: "edited_by_typist",
          learnFromEdits: false,
        }),
      })

      const data = await readJsonSafely(response)

      if (!data.success) {
        alert(data.error || "Failed to return draft")
        return
      }

      alert("Returned to typist.")
      setSelectedApprovalDraft(null)
      await loadDrafts()
    } finally {
      setLoading(false)
    }
  }

  async function deleteDraft(draft: Draft | null) {
    if (!draft) return

    const confirmed = confirm(
      `Delete this temporary report for ${
        draft.patient_name || "this patient"
      }? This cannot be undone.`
    )

    if (!confirmed) return

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/delete-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      })

      const data = await readJsonSafely(response)

      if (!data.success) {
        alert(data.error || "Failed to delete report")
        return
      }

      alert("Report deleted.")

      if (selectedApprovalDraft?.id === draft.id) {
        setSelectedApprovalDraft(null)
      }

      if (selectedApprovedDraft?.id === draft.id) {
        setSelectedApprovedDraft(null)
      }

      await loadDrafts()
    } finally {
      setLoading(false)
    }
  }

  function selectApprovalDraft(draft: Draft) {
    setSelectedApprovalDraft(draft)
    setShowOriginal(false)
  }

  const sharedPatientFields = (
    <PatientAndReferrerFields
      patientFirstName={patientFirstName}
      setPatientFirstName={setPatientFirstName}
      patientLastName={patientLastName}
      setPatientLastName={setPatientLastName}
      patientDob={patientDob}
      setPatientDob={setPatientDob}
      reportType={reportType}
      setReportType={setReportType}
      reportTypes={reportTypes}
      referrerName={referrerName}
      setReferrerName={setReferrerName}
      referrerAddress={referrerAddress}
      setReferrerAddress={setReferrerAddress}
      selectedPraktikaPatientId={selectedPraktikaPatientId}
      setSelectedPraktikaPatientId={setSelectedPraktikaPatientId}
      praktikaCandidates={praktikaCandidates}
      setPraktikaCandidates={setPraktikaCandidates}
      matchingPatient={matchingPatient}
      onSearchPraktikaPatient={searchPraktikaPatientMatch}
    />
  )

  return (
    <div className="space-y-6">
      <PraktikaSessionPanel />

      <div className="flex justify-end">
        <SyncReferrersButton />
      </div>

<div className="space-y-4">
  <div className="rounded-2xl border bg-white p-4 shadow-sm">
    <h2 className="mb-3 text-lg font-bold text-slate-900">
      Create a Letter
    </h2>

    <div className="grid gap-3 md:grid-cols-3">
      {[
        ["dictate", "Dictate"],
        ["smart", "Smart Dictate"],
        ["notes", "Generate Letter From Notes"],
      ].map(([key, label]) => (
        <button
          key={key}
          onClick={() => {
            setActiveTab(key as ActiveTab)
            loadReportTypes()
          }}
          className={[
            "rounded-2xl px-5 py-4 text-sm font-semibold shadow-sm",
            activeTab === key
              ? "bg-slate-950 text-white"
              : "border bg-white text-slate-700 hover:bg-slate-50",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  </div>

  <div className="rounded-2xl border bg-slate-50 p-4 shadow-sm">
    <div className="mb-3">
      <h2 className="text-lg font-bold text-slate-900">
        Review Centre
      </h2>
      <p className="text-sm text-slate-500">
        Review letters awaiting approval or view recently approved letters.
      </p>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
      {[
        ["approval", `Approval Inbox (${approvalDrafts.length})`],
        ["approved", `Approved Letters (${approvedDrafts.length})`],
      ].map(([key, label]) => (
        <button
          key={key}
          onClick={() => {
            setActiveTab(key as ActiveTab)
            loadDrafts()
          }}
          className={[
            "rounded-2xl px-5 py-4 text-sm font-semibold shadow-sm",
            activeTab === key
              ? "bg-blue-600 text-white"
              : "border bg-white text-slate-700 hover:bg-slate-50",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  </div>
</div>

      {savedMessage ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {savedMessage}
        </div>
      ) : null}

      {activeTab === "smart" ? (
  <div className="space-y-6">
    {sharedPatientFields}

    <div className="space-y-6 rounded-2xl border bg-white p-5">
      <SmartDictateBox
        providerId={providerId}
        patientFirstName={patientFirstName}
        patientLastName={patientLastName}
        patientDob={patientDob}
        disabled={
          !patientFirstName.trim() || !patientLastName.trim()
        }
        reportTypes={reportTypes}
        selectedReportType={reportType}
        onReportTypeChange={setReportType}
        onResult={(result) => {
          setClinicalNotes(result.clinicalNotes || "")
          setGeneratedReport(result.report || "")
          setOriginalGeneratedReport(result.report || "")
          setSavedMessage("")
        }}
      />

      <textarea
        className="h-96 w-full rounded-xl border border-slate-300 p-4"
        placeholder="Smart Dictate generated report..."
        value={generatedReport}
        onChange={(e) => setGeneratedReport(e.target.value)}
      />

      <button
        onClick={saveNotesDraft}
        disabled={loading}
        className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
      >
        Save Smart Dictate Report As Approved Draft
      </button>
    </div>
  </div>
) : null}

      {activeTab === "dictate" ? (
        <div className="space-y-6 rounded-2xl border bg-white p-5">
          {sharedPatientFields}

          <OpenAIDictationBox
  providerId={providerId}
  patientFirstName={patientFirstName}
  patientLastName={patientLastName}
  disabled={!patientFirstName.trim() || !patientLastName.trim()}
  onFinished={(text) => {
    setDictatedLetter(text)
  }}
/>

          <textarea
            className="h-96 w-full rounded-xl border border-slate-300 p-4"
            placeholder="Dictated letter will appear here after dictation stops..."
            value={dictatedLetter}
            onChange={(e) => setDictatedLetter(e.target.value)}
          />

          <button
            onClick={saveDictatedLetter}
            disabled={loading}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            Save Dictated Letter As Approved Draft
          </button>
        </div>
      ) : null}

      {activeTab === "notes" ? (
        <div className="space-y-6 rounded-2xl border bg-white p-5">
          {sharedPatientFields}

          <textarea
            className="h-64 w-full rounded-xl border border-slate-300 p-4"
            placeholder="Paste clinical notes here..."
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

          <textarea
            className="h-96 w-full rounded-xl border border-slate-300 p-4"
            placeholder="Generated report..."
            value={generatedReport}
            onChange={(e) => setGeneratedReport(e.target.value)}
          />

          <button
            onClick={saveNotesDraft}
            disabled={loading}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white disabled:opacity-50"
          >
            Save As Approved Draft
          </button>
        </div>
      ) : null}

      {activeTab === "approval" ? (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-4">
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
                      {draft.report_type}
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

          <div className="lg:col-span-8">
            {selectedApprovalDraft ? (
              <div className="space-y-4 rounded-2xl border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                  <div>
                    <h2 className="text-2xl font-bold">
                      {selectedApprovalDraft.patient_name || "Unnamed patient"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedApprovalDraft.report_type} • Created {formatDateTime(selectedApprovalDraft.created_at)}
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

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="font-semibold text-slate-900">Step 1</div>
                    <div className="mt-1 text-slate-600">Review and edit the letter.</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="font-semibold text-slate-900">Step 2</div>
                    <div className="mt-1 text-slate-600">Approve or return to typist.</div>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="font-semibold text-slate-900">Step 3</div>
                    <div className="mt-1 text-slate-600">Approved edits improve future drafts.</div>
                  </div>
                </div>

                {selectedApprovalDraft.ai_generated_text ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowOriginal((current) => !current)}
                      className="rounded-xl border px-4 py-2 text-xs font-semibold text-slate-700"
                    >
                      {showOriginal ? "Show editable version" : "Compare original AI version"}
                    </button>
                  </div>
                ) : null}

                {showOriginal ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-700">
                        Original AI version
                      </div>
                      <textarea
                        className="h-[32rem] w-full rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm"
                        readOnly
                        value={selectedApprovalDraft.ai_generated_text || ""}
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-700">
                        Final edited version
                      </div>
                      <textarea
                        className="h-[32rem] w-full rounded-xl border border-slate-300 p-4 text-sm"
                        value={selectedApprovalDraft.edited_text || ""}
                        onChange={(e) =>
                          setSelectedApprovalDraft({
                            ...selectedApprovalDraft,
                            edited_text: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <textarea
                    className="h-[36rem] w-full rounded-xl border border-slate-300 p-4"
                    value={selectedApprovalDraft.edited_text || ""}
                    onChange={(e) =>
                      setSelectedApprovalDraft({
                        ...selectedApprovalDraft,
                        edited_text: e.target.value,
                      })
                    }
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
                    onClick={returnToTypist}
                    disabled={loading}
                    className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Return To Typist
                  </button>

                  <button
                    onClick={() => deleteDraft(selectedApprovalDraft)}
                    disabled={loading}
                    className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Delete Report
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
          <div className="space-y-4 lg:col-span-4">
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
                  {formatDateTime(draft.provider_approved_at || draft.created_at)}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-8">
            {selectedApprovedDraft ? (
              <div className="space-y-4 rounded-2xl border bg-white p-5">
                <div className="flex items-start justify-between gap-3 border-b pb-4">
                  <div>
                    <h2 className="text-2xl font-bold">
                      {selectedApprovedDraft.patient_name || "Unnamed patient"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Approved {formatDateTime(selectedApprovedDraft.provider_approved_at || selectedApprovedDraft.created_at)}
                    </p>
                  </div>
                  <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                    Approved
                  </span>
                </div>

                <textarea
                  className="h-[36rem] w-full rounded-xl border border-slate-300 bg-slate-50 p-4"
                  readOnly
                  value={getReportText(selectedApprovedDraft)}
                />

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                  This letter is approved. The typist portal is used to add
                  images, generate the branded PDF, upload to Praktika, and send
                  secure email correspondence.
                </div>

                <button
                  onClick={() => deleteDraft(selectedApprovedDraft)}
                  disabled={loading}
                  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Delete Report
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-500">
                Select an approved letter.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
