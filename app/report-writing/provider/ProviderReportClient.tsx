"use client"

import { useEffect, useState } from "react"
import ReferrerSearchBox from "@/components/report-writing/ReferrerSearchBox"
import SyncReferrersButton from "@/components/report-writing/SyncReferrersButton"
import PraktikaSessionPanel from "@/components/PraktikaSessionPanel"
import OpenAIDictationBox from "@/components/report-writing/OpenAIDictationBox"

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
}

type ProviderReportClientProps = {
  providerId: string
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
}

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
    </div>
  )
}

export default function ProviderReportClient({
  providerId,
}: ProviderReportClientProps) {
  const [activeTab, setActiveTab] =
    useState<"dictate" | "notes" | "approval" | "approved">("dictate")

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
  const [dictatedLetter, setDictatedLetter] = useState("")

  const [approvalDrafts, setApprovalDrafts] = useState<Draft[]>([])
  const [approvedDrafts, setApprovedDrafts] = useState<Draft[]>([])
  const [selectedApprovalDraft, setSelectedApprovalDraft] =
    useState<Draft | null>(null)
  const [selectedApprovedDraft, setSelectedApprovedDraft] =
    useState<Draft | null>(null)

  const [loading, setLoading] = useState(false)
  const [savedMessage, setSavedMessage] = useState("")

  const patientName = `${patientFirstName} ${patientLastName}`.trim()

  async function loadReportTypes() {
    const response = await fetch(
      `/api/report-writing/correspondence-types?providerId=${providerId}`
    )

    const data = await response.json()

    if (data.success) {
      setReportTypes(data.types)

      if (
        data.types.length > 0 &&
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

    const data = await response.json()

    if (data.success) {
      setApprovalDrafts(
        data.drafts.filter(
          (draft: Draft) => draft.status === "awaiting_provider_approval"
        )
      )

      setApprovedDrafts(
        data.drafts.filter((draft: Draft) => draft.status === "approved")
      )
    }
  }

  useEffect(() => {
    loadDrafts()
    loadReportTypes()
  }, [])

  function validatePatientName() {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first name and last name are required.")
      return false
    }

    return true
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

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to generate report")
        return
      }

      setGeneratedReport(data.report)
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
          generatedReport,
          sourceType: "clinical_notes",
          status: "approved",
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to save draft")
        return
      }

      setSavedMessage("Report saved and automatically approved.")
      setGeneratedReport("")
      setClinicalNotes("")
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
          sourceType: "dictation",
          status: "approved",
        }),
      })

      const data = await response.json()

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

    setLoading(true)

    const response = await fetch("/api/report-writing/approve-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: selectedApprovalDraft.id }),
    })

    const data = await response.json()
    setLoading(false)

    if (!data.success) {
      alert(data.error || "Failed to approve draft")
      return
    }

    alert("Letter approved.")
setSelectedApprovalDraft(null)
setActiveTab("approved")
await loadDrafts()
  }

  async function returnToTypist() {
    if (!selectedApprovalDraft) return

    setLoading(true)

    const response = await fetch("/api/report-writing/update-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftId: selectedApprovalDraft.id,
        editedText: selectedApprovalDraft.edited_text || "",
        status: "edited_by_typist",
      }),
    })

    const data = await response.json()
    setLoading(false)

    if (!data.success) {
      alert(data.error || "Failed to return draft")
      return
    }

    alert("Returned to typist.")
    setSelectedApprovalDraft(null)
    await loadDrafts()
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

      const data = await response.json()

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
    />
  )

  return (
    <div className="space-y-6">
      <PraktikaSessionPanel />

      <div className="flex justify-end">
        <SyncReferrersButton />
      </div>

      <div className="flex flex-wrap gap-3">
        {[
          ["dictate", "Dictate Letter"],
          ["notes", "Generate From Clinical Notes"],
          ["approval", `Awaiting Approval (${approvalDrafts.length})`],
          ["approved", `Approved Letters (${approvedDrafts.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setActiveTab(key as typeof activeTab)
              loadDrafts()
              loadReportTypes()
            }}
            className={[
              "rounded-xl px-5 py-3 font-semibold",
              activeTab === key
                ? "bg-slate-950 text-white"
                : "border bg-white text-slate-700",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {savedMessage ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {savedMessage}
        </div>
      ) : null}

      {activeTab === "dictate" ? (
        <div className="space-y-6">
          {sharedPatientFields}

          <OpenAIDictationBox
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
        <div className="space-y-6">
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
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3">
            {approvalDrafts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                No letters awaiting approval.
              </div>
            ) : null}

            {approvalDrafts.map((draft) => (
              <button
                key={draft.id}
                onClick={() => setSelectedApprovalDraft(draft)}
                className="w-full rounded-xl border bg-white p-4 text-left hover:bg-slate-50"
              >
                <div className="font-semibold">
                  {draft.patient_name || "Unnamed patient"}
                </div>
                <div className="text-sm text-slate-500">
                  {draft.report_type}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selectedApprovalDraft ? (
              <div className="space-y-4">
                <textarea
                  className="h-96 w-full rounded-xl border border-slate-300 p-4"
                  value={selectedApprovalDraft.edited_text || ""}
                  onChange={(e) =>
                    setSelectedApprovalDraft({
                      ...selectedApprovalDraft,
                      edited_text: e.target.value,
                    })
                  }
                />

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={approveDraft}
                    disabled={loading}
                    className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Approve Letter
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
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-sm text-slate-500">
                Select a letter to review.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === "approved" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3">
            {approvedDrafts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                No approved letters yet.
              </div>
            ) : null}

            {approvedDrafts.map((draft) => (
              <button
                key={draft.id}
                onClick={() => setSelectedApprovedDraft(draft)}
                className="w-full rounded-xl border bg-white p-4 text-left hover:bg-slate-50"
              >
                <div className="font-semibold">
                  {draft.patient_name || "Unnamed patient"}
                </div>
                <div className="text-sm text-green-600">Approved</div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {selectedApprovedDraft ? (
              <div className="space-y-4">
                <textarea
                  className="h-96 w-full rounded-xl border border-slate-300 bg-slate-50 p-4"
                  readOnly
                  value={
                    selectedApprovedDraft.edited_text ||
                    selectedApprovedDraft.ai_generated_text ||
                    ""
                  }
                />

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                  This letter is approved. The typist portal is used to add
                  images and generate the branded PDF.
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
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-sm text-slate-500">
                Select an approved letter.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}