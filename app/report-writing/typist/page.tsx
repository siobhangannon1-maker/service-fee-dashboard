"use client"

import { useEffect, useMemo, useState } from "react"
import JSZip from "jszip"
import ReferrerSearchBox from "@/components/report-writing/ReferrerSearchBox"
import SyncReferrersButton from "@/components/report-writing/SyncReferrersButton"
import DraftImagePanel from "@/components/report-writing/DraftImagePanel"
import PraktikaSessionPanel from "@/components/PraktikaSessionPanel"
import LetterAuditTrail from "@/components/report-writing/LetterAuditTrail"

type Provider = { id: string; name: string }

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

type ListTab = "drafts" | "awaiting" | "approved" | "all"

type PraktikaCandidate = {
  id: string
  firstName: string
  lastName: string
  dob: string
  matchScore: number | null
  matchReason: string
}

function splitPatientName(name: string | null) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean)

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  }
}

function getFilenameFromResponse(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition") || ""
  const match = disposition.match(/filename="(.+?)"/)

  if (match?.[1]) return match[1]

  return fallback
}

function safeFileName(name: string | null | undefined) {
  return String(name || "Patient")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
}

export default function TypistPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState("")
  const [reportTypes, setReportTypes] = useState<ReportTypeOption[]>([
    { value: "consultation_report", label: "Consultation Report" },
  ])

  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null)
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([])
  const [listTab, setListTab] = useState<ListTab>("drafts")

  const [patientFirstName, setPatientFirstName] = useState("")
  const [patientLastName, setPatientLastName] = useState("")
  const [patientDob, setPatientDob] = useState("")
  const [referrerName, setReferrerName] = useState("")
  const [referrerAddress, setReferrerAddress] = useState("")
  const [reportType, setReportType] = useState("consultation_report")
  const [clinicalNotes, setClinicalNotes] = useState("")
  const [letterText, setLetterText] = useState("")

  const [praktikaCandidates, setPraktikaCandidates] = useState<
    PraktikaCandidate[]
  >([])
  const [selectedPraktikaPatientId, setSelectedPraktikaPatientId] =
    useState("")
  const [matchingPatient, setMatchingPatient] = useState(false)

  const [loading, setLoading] = useState(false)

  const patientName = `${patientFirstName} ${patientLastName}`.trim()

  const filteredDrafts = useMemo(() => {
    if (listTab === "all") return drafts

    if (listTab === "drafts") {
      return drafts.filter((draft) =>
        ["draft", "edited_by_typist"].includes(draft.status)
      )
    }

    if (listTab === "awaiting") {
      return drafts.filter(
        (draft) => draft.status === "awaiting_provider_approval"
      )
    }

    if (listTab === "approved") {
      return drafts.filter((draft) => draft.status === "approved")
    }

    return drafts
  }, [drafts, listTab])

  const visibleDraftIds = filteredDrafts.map((draft) => draft.id)

  const allVisibleSelected =
    visibleDraftIds.length > 0 &&
    visibleDraftIds.every((id) => selectedDraftIds.includes(id))

  const countDrafts = drafts.filter((draft) =>
    ["draft", "edited_by_typist"].includes(draft.status)
  ).length

  const countAwaiting = drafts.filter(
    (draft) => draft.status === "awaiting_provider_approval"
  ).length

  const countApproved = drafts.filter(
    (draft) => draft.status === "approved"
  ).length

  const selectedProvider = providers.find(
    (provider) => provider.id === selectedProviderId
  )

  async function loadProviders() {
    const response = await fetch("/api/report-writing/get-providers")
    const data = await response.json()

    if (data.success) {
      setProviders(data.providers)

      if (data.providers.length > 0 && !selectedProviderId) {
        setSelectedProviderId(data.providers[0].id)
      }
    }
  }

  async function loadReportTypes(providerIdToLoad: string) {
    const response = await fetch(
      `/api/report-writing/correspondence-types?providerId=${providerIdToLoad}`
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

  async function loadDrafts(providerId: string) {
    const response = await fetch(
      `/api/report-writing/get-drafts?providerId=${providerId}`
    )

    const data = await response.json()

    if (data.success) {
      setDrafts(data.drafts)
    }
  }

  useEffect(() => {
    loadProviders()
  }, [])

  useEffect(() => {
    if (selectedProviderId) {
      loadDrafts(selectedProviderId)
      loadReportTypes(selectedProviderId)
      clearForm()
      setSelectedDraftIds([])
    }
  }, [selectedProviderId])

  function clearForm() {
    setSelectedDraft(null)
    setPatientFirstName("")
    setPatientLastName("")
    setPatientDob("")
    setReferrerName("")
    setReferrerAddress("")
    setReportType("consultation_report")
    setClinicalNotes("")
    setLetterText("")
    setPraktikaCandidates([])
    setSelectedPraktikaPatientId("")
  }

  function selectDraft(draft: Draft) {
    const splitName = splitPatientName(draft.patient_name)

    setSelectedDraft(draft)
    setPatientFirstName(splitName.firstName)
    setPatientLastName(splitName.lastName)
    setPatientDob(draft.patient_dob || "")
    setReferrerName(draft.referrer_name || "")
    setReferrerAddress(draft.referrer_address || "")
    setReportType(draft.report_type)
    setClinicalNotes("")
    setLetterText(draft.edited_text || draft.ai_generated_text || "")
    setPraktikaCandidates([])
    setSelectedPraktikaPatientId("")
  }

  function toggleDraftSelection(draftId: string) {
    setSelectedDraftIds((current) =>
      current.includes(draftId)
        ? current.filter((id) => id !== draftId)
        : [...current, draftId]
    )
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedDraftIds((current) =>
        current.filter((id) => !visibleDraftIds.includes(id))
      )
    } else {
      setSelectedDraftIds((current) =>
        Array.from(new Set([...current, ...visibleDraftIds]))
      )
    }
  }

  async function generateLetter() {
    if (!selectedProviderId) {
      alert("Please select a provider first.")
      return
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first name and last name are required.")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProviderId,
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
        alert(data.error || "Failed to generate letter")
        return
      }

      setLetterText(data.report)
    } finally {
      setLoading(false)
    }
  }

  async function saveNewDraft() {
    if (!selectedProviderId) {
      alert("Please select a provider first.")
      return
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first name and last name are required.")
      return
    }

    if (!letterText.trim()) {
      alert("Generate or write a letter first.")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProviderId,
          patientName,
          patientDob,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes,
          generatedReport: letterText,
          status: "draft",
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to save draft")
        return
      }

      alert("Draft saved for provider.")
      await loadDrafts(selectedProviderId)
      clearForm()
    } finally {
      setLoading(false)
    }
  }

  async function updateExistingDraft(status: string) {
    if (!selectedDraft) return

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/update-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          editedText: letterText,
          status,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to update draft")
        return
      }

      alert("Draft updated.")
      await loadDrafts(selectedProviderId)

      setSelectedDraft({
        ...selectedDraft,
        patient_name: patientName,
        patient_dob: patientDob,
        edited_text: letterText,
        status,
      })
    } finally {
      setLoading(false)
    }
  }

  async function deleteDraftById(draftId: string) {
    const response = await fetch("/api/report-writing/delete-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    })

    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || "Failed to delete draft")
    }
  }

  async function deleteSelectedDraft() {
    if (!selectedDraft) return

    const confirmed = confirm(
      `Delete this temporary letter for ${
        selectedDraft.patient_name || "this patient"
      }?`
    )

    if (!confirmed) return

    setLoading(true)

    try {
      await deleteDraftById(selectedDraft.id)
      alert("Letter deleted.")
      await loadDrafts(selectedProviderId)
      clearForm()
      setSelectedDraftIds((current) =>
        current.filter((id) => id !== selectedDraft.id)
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete letter")
    } finally {
      setLoading(false)
    }
  }

  async function deleteCheckedDrafts() {
    if (selectedDraftIds.length === 0) {
      alert("Select at least one letter to delete.")
      return
    }

    const confirmed = confirm(
      `Delete ${selectedDraftIds.length} selected letter(s)? This cannot be undone.`
    )

    if (!confirmed) return

    setLoading(true)

    try {
      for (const draftId of selectedDraftIds) {
        await deleteDraftById(draftId)
      }

      alert("Selected letters deleted.")
      await loadDrafts(selectedProviderId)

      if (selectedDraft && selectedDraftIds.includes(selectedDraft.id)) {
        clearForm()
      }

      setSelectedDraftIds([])
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Failed to delete selected letters"
      )
    } finally {
      setLoading(false)
    }
  }

  async function generatePdf(draft: Draft) {
    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      })

      if (!response.ok) {
        alert("Failed to generate PDF")
        return
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const fileName = getFilenameFromResponse(
        response,
        `${safeFileName(draft.patient_name)} Letter.pdf`
      )

      const link = document.createElement("a")
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()

      window.URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  async function bulkGenerateApprovedPdfs() {
    const selectedDrafts = drafts.filter((draft) =>
      selectedDraftIds.includes(draft.id)
    )

    const approvedDrafts = selectedDrafts.filter(
      (draft) => draft.status === "approved"
    )

    if (approvedDrafts.length === 0) {
      alert("Select at least one approved letter to bulk generate PDFs.")
      return
    }

    setLoading(true)

    try {
      const zip = new JSZip()

      for (const draft of approvedDrafts) {
        const response = await fetch("/api/report-writing/generate-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: draft.id }),
        })

        if (!response.ok) {
          throw new Error(
            `Failed to generate PDF for ${draft.patient_name || "patient"}`
          )
        }

        const blob = await response.blob()
        const fileName = getFilenameFromResponse(
          response,
          `${safeFileName(draft.patient_name)} Letter.pdf`
        )

        zip.file(fileName, blob)
      }

      const zipBlob = await zip.generateAsync({ type: "blob" })
      const url = window.URL.createObjectURL(zipBlob)

      const link = document.createElement("a")
      link.href = url
      link.download = `branded_letters_${new Date()
        .toISOString()
        .slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()

      window.URL.revokeObjectURL(url)
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Failed to bulk generate PDFs."
      )
    } finally {
      setLoading(false)
    }
  }

  async function searchPraktikaPatientMatch() {
    if (!patientName.trim()) {
      alert("Patient name is required before matching.")
      return
    }

    setMatchingPatient(true)
    setPraktikaCandidates([])
    setSelectedPraktikaPatientId("")

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

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to search Praktika.")
        return
      }

      setPraktikaCandidates(data.candidates || [])

      if ((data.candidates || []).length === 1) {
        setSelectedPraktikaPatientId(data.candidates[0].id)
      }
    } finally {
      setMatchingPatient(false)
    }
  }

  async function uploadToPraktika() {
    if (!selectedDraft) return

    if (selectedDraft.status !== "approved") {
      alert("Only approved reports can be uploaded to Praktika.")
      return
    }

    if (!selectedPraktikaPatientId) {
      alert("Please search and select the correct Praktika patient first.")
      return
    }

    const confirmed = confirm(
      `Upload this approved report to Praktika patient ID ${selectedPraktikaPatientId}?`
    )

    if (!confirmed) return

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/upload-to-praktika", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftId: selectedDraft.id,
          praktikaPatientId: selectedPraktikaPatientId,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to upload to Praktika.")
        console.error("Praktika upload error:", data)
        return
      }

      alert("Report uploaded to Praktika communications.")
      await loadDrafts(selectedProviderId)
      clearForm()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid h-screen grid-cols-12 bg-slate-100">
      <div className="col-span-3 overflow-y-auto border-r bg-white">
        <div className="border-b p-4">
          <h1 className="text-2xl font-bold">Typist Portal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Create, edit, approve workflow, image-format, and upload reports.
          </p>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
              Praktika Session
            </div>
            <PraktikaSessionPanel />
          </div>

          <div className="mt-3">
            <SyncReferrersButton />
          </div>
        </div>

        <div className="space-y-2 p-3">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => setSelectedProviderId(provider.id)}
              className={[
                "w-full rounded-xl border p-3 text-left text-sm font-semibold",
                selectedProviderId === provider.id
                  ? "border-blue-600 bg-blue-50 text-blue-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
              ].join(" ")}
            >
              {provider.name}
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-3 overflow-y-auto border-r bg-slate-50">
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

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[
              ["drafts", `Drafts (${countDrafts})`],
              ["awaiting", `Awaiting (${countAwaiting})`],
              ["approved", `Approved (${countApproved})`],
              ["all", `All (${drafts.length})`],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setListTab(key as ListTab)
                  setSelectedDraftIds([])
                }}
                className={[
                  "rounded-xl border px-3 py-2 text-xs font-semibold",
                  listTab === key
                    ? "border-blue-600 bg-blue-50 text-blue-900"
                    : "bg-white text-slate-600",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

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
        </div>

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
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="col-span-6 flex flex-col bg-white">
        <div className="border-b p-4">
          <h2 className="text-xl font-bold">
            {selectedDraft ? "Edit Existing Letter" : "Create New Letter"}
          </h2>

          <p className="text-sm text-slate-500">
            Provider: {selectedProvider?.name || "None selected"}
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Patient First Name
              </label>
              <input
                className="w-full rounded-xl border p-3"
                placeholder="Patient First Name"
                value={patientFirstName}
                onChange={(e) => setPatientFirstName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Patient Last Name
              </label>
              <input
                className="w-full rounded-xl border p-3"
                placeholder="Patient Last Name"
                value={patientLastName}
                onChange={(e) => setPatientLastName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Patient DOB
              </label>
              <input
                className="w-full rounded-xl border p-3"
                type="date"
                value={patientDob}
                onChange={(e) => setPatientDob(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Report Type
              </label>
              <select
                className="w-full rounded-xl border p-3"
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
              >
                {reportTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <ReferrerSearchBox
              onSelect={(referrer) => {
                setReferrerName(referrer.name)
                setReferrerAddress(referrer.address || "")
              }}
            />

            <input
              className="rounded-xl border p-3"
              placeholder="Referrer Name"
              value={referrerName}
              onChange={(e) => setReferrerName(e.target.value)}
            />

            <textarea
              className="rounded-xl border p-3 md:col-span-2"
              placeholder="Referrer address"
              value={referrerAddress}
              onChange={(e) => setReferrerAddress(e.target.value)}
            />
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

          <textarea
            className="h-96 w-full rounded-xl border p-4"
            placeholder="Letter text..."
            value={letterText}
            onChange={(e) => setLetterText(e.target.value)}
          />

          {selectedDraft ? (
            <DraftImagePanel reportDraftId={selectedDraft.id} />
          ) : null}

          {selectedDraft ? (
            <LetterAuditTrail draftId={selectedDraft.id} />
          ) : null}

          {selectedDraft?.status === "approved" ? (
            <section className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
              <div>
                <h3 className="text-lg font-bold text-indigo-950">
                  Praktika Patient Match
                </h3>
                <p className="text-sm text-indigo-900">
                  Search using the entered patient name and DOB, then select the
                  correct patient before uploading.
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
                            setSelectedPraktikaPatientId(candidate.id)
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
            <button
              onClick={saveNewDraft}
              disabled={loading}
              className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              Save Draft For Provider
            </button>
          ) : (
            <>
              <button
                onClick={() => updateExistingDraft("edited_by_typist")}
                disabled={loading}
                className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Save Edit
              </button>

              <button
                onClick={() =>
                  updateExistingDraft("awaiting_provider_approval")
                }
                disabled={loading}
                className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Send To Provider Approval
              </button>

              {selectedDraft.status === "approved" ? (
                <>
                  <button
                    onClick={() => generatePdf(selectedDraft)}
                    disabled={loading}
                    className="rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    {loading ? "Generating PDF..." : "Generate Branded PDF"}
                  </button>

                  <button
                    onClick={uploadToPraktika}
                    disabled={loading || !selectedPraktikaPatientId}
                    className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Upload Approved PDF To Praktika
                  </button>
                </>
              ) : null}

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
  )
}