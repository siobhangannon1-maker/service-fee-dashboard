"use client"

import { useEffect, useMemo, useState } from "react"

type Provider = {
  id: string
  name: string
}

type Draft = {
  id: string
  provider_id?: string | null
  provider_name?: string | null
  patient_name: string | null
  patient_dob: string | null
  referrer_name: string | null
  report_type: string
  edited_text: string | null
  ai_generated_text: string | null
  status: string
  created_at: string
  uploaded_to_praktika?: boolean | null
  uploaded_to_praktika_at?: string | null
  emailed_to_referrer_at?: string | null
  emailed_to_referrer_email?: string | null
  emailed_to_referrer_resend_id?: string | null
  drafted_by_initials?: string | null
  drafted_by_name?: string | null
  approved_by_initials?: string | null
  approved_by_name?: string | null
  uploaded_by_initials?: string | null
  uploaded_by_name?: string | null
  emailed_by_initials?: string | null
  emailed_by_name?: string | null
  completed_at?: string | null
  sensitive_source_deleted_at?: string | null
  ai_text_deleted_at?: string | null
  final_text_deleted_at?: string | null
  retention_status?: string | null
}

type StatusFilter =
  | "all"
  | "draft"
  | "awaiting"
  | "approved"
  | "uploaded"
  | "emailed"
  | "completed"

const reportTypeLabels: Record<string, string> = {
  consultation_report: "Consultation Report",
  treatment_report: "Treatment Report",
  review: "Review",
  SPT_report: "SPT Report",
  osseointegration_letter: "Osseointegration Letter",
  surgery_report: "Surgery Report",
  referral_reply: "Referral Reply",
  post_op_letter: "Post-operative Letter",
  medico_legal_report: "Medico-legal Report",
  patient_letter: "Patient Letter",
  gp_letter: "GP Letter",
  dictated_letter: "Dictated Letter",
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"

  try {
    return new Date(value).toLocaleString("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Australia/Brisbane",
    })
  } catch {
    return value
  }
}

function safeFileName(name: string | null | undefined) {
  return String(name || "Patient")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
}

function getFilenameFromResponse(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition") || ""
  const match = disposition.match(/filename="(.+?)"/)

  if (match?.[1]) return match[1]

  return fallback
}

function getStatusLabel(draft: Draft) {
  if (draft.emailed_to_referrer_at) return "Emailed"
  if (draft.uploaded_to_praktika_at || draft.uploaded_to_praktika) {
    return "Uploaded"
  }
  if (draft.status === "awaiting_provider_approval") return "Awaiting approval"
  if (draft.status === "approved") return "Approved"
  if (draft.status === "edited_by_typist") return "Edited"
  return draft.status || "Draft"
}

function getStatusClass(draft: Draft) {
  if (draft.emailed_to_referrer_at) return "bg-emerald-100 text-emerald-700"
  if (draft.uploaded_to_praktika_at || draft.uploaded_to_praktika) {
    return "bg-indigo-100 text-indigo-700"
  }
  if (draft.status === "approved") return "bg-green-100 text-green-700"
  if (draft.status === "awaiting_provider_approval") {
    return "bg-amber-100 text-amber-700"
  }
  return "bg-slate-200 text-slate-700"
}

function hasFinalText(draft: Draft) {
  return Boolean((draft.edited_text || draft.ai_generated_text || "").trim())
}

function RetentionBadge({
  label,
  title,
  tone = "slate",
}: {
  label: string
  title?: string
  tone?: "slate" | "amber" | "red" | "emerald"
}) {
  const classes =
    tone === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : tone === "emerald"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-slate-50 text-slate-600 border-slate-200"

  return (
    <span
      title={title || label}
      className={["inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", classes].join(" ")}
    >
      {label}
    </span>
  )
}

function RetentionBadges({ draft }: { draft: Draft }) {
  const badges = []

  if (draft.sensitive_source_deleted_at) {
    badges.push(
      <RetentionBadge
        key="source"
        label="Source deleted"
        title={`Raw source notes deleted ${formatDateTime(draft.sensitive_source_deleted_at)}`}
        tone="emerald"
      />
    )
  }

  if (draft.ai_text_deleted_at) {
    badges.push(
      <RetentionBadge
        key="ai"
        label="AI draft deleted"
        title={`AI generated text deleted ${formatDateTime(draft.ai_text_deleted_at)}`}
        tone="emerald"
      />
    )
  }

  if (draft.final_text_deleted_at) {
    badges.push(
      <RetentionBadge
        key="final"
        label="Final text deleted"
        title={`Final letter text deleted ${formatDateTime(draft.final_text_deleted_at)}`}
        tone="red"
      />
    )
  }

  if (!hasFinalText(draft)) {
    badges.push(
      <RetentionBadge
        key="no-pdf"
        label="PDF unavailable"
        title="Letter text is no longer stored in Supabase, so the PDF cannot be regenerated here."
        tone="amber"
      />
    )
  }

  if (badges.length === 0) return null

  return <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>
}


function getInitials(value?: string | null) {
  if (!value) return "?"

  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase()
}

function ActorBadge({
  initials,
  name,
  label,
}: {
  initials?: string | null
  name?: string | null
  label: string
}) {
  if (!initials && !name) return null

  const displayInitials =
    initials?.trim() || getInitials(name)

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}:</span>

      <div className="group relative">
        <span
          className="inline-flex h-7 min-w-7 cursor-default items-center justify-center rounded-full bg-slate-900 px-2 text-[11px] font-bold tracking-wide text-white"
        >
          {displayInitials}
        </span>

        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg group-hover:block">
          {name || "Unknown user"}
        </div>
      </div>
    </div>
  )
}

export default function ReportWritingHistoryPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingPdfId, setLoadingPdfId] = useState<string | null>(null)

  const [providerId, setProviderId] = useState("all")
  const [patientSearch, setPatientSearch] = useState("")
  const [reportType, setReportType] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")

  const reportTypeOptions = useMemo(() => {
    const keys = Array.from(new Set(drafts.map((draft) => draft.report_type)))
      .filter(Boolean)
      .sort()

    return keys.map((key) => ({
      value: key,
      label: reportTypeLabels[key] || key.replace(/_/g, " "),
    }))
  }, [drafts])

  const filteredDrafts = useMemo(() => {
    const search = patientSearch.trim().toLowerCase()

    return drafts
      .filter((draft) => {
        if (providerId !== "all" && draft.provider_id !== providerId) {
          return false
        }

        if (search) {
          const haystack = [
            draft.patient_name,
            draft.patient_dob,
            draft.referrer_name,
            draft.emailed_to_referrer_email,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()

          if (!haystack.includes(search)) return false
        }

        if (reportType !== "all" && draft.report_type !== reportType) {
          return false
        }

        if (fromDate && draft.created_at.slice(0, 10) < fromDate) {
          return false
        }

        if (toDate && draft.created_at.slice(0, 10) > toDate) {
          return false
        }

        if (statusFilter === "draft") {
          return ["draft", "edited_by_typist"].includes(draft.status)
        }

        if (statusFilter === "awaiting") {
          return draft.status === "awaiting_provider_approval"
        }

        if (statusFilter === "approved") {
          return draft.status === "approved"
        }

        if (statusFilter === "uploaded") {
          return Boolean(draft.uploaded_to_praktika_at || draft.uploaded_to_praktika)
        }

        if (statusFilter === "emailed") {
          return Boolean(draft.emailed_to_referrer_at)
        }

        if (statusFilter === "completed") {
          return Boolean(
            draft.emailed_to_referrer_at ||
              draft.uploaded_to_praktika_at ||
              draft.uploaded_to_praktika
          )
        }

        return true
      })
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
  }, [drafts, providerId, patientSearch, reportType, statusFilter, fromDate, toDate])

  const summary = useMemo(() => {
    return {
      total: filteredDrafts.length,
      emailed: filteredDrafts.filter((draft) => draft.emailed_to_referrer_at)
        .length,
      uploaded: filteredDrafts.filter(
        (draft) => draft.uploaded_to_praktika_at || draft.uploaded_to_praktika
      ).length,
      awaiting: filteredDrafts.filter(
        (draft) => draft.status === "awaiting_provider_approval"
      ).length,
    }
  }, [filteredDrafts])

  async function loadProvidersAndDrafts() {
    setLoading(true)

    try {
      const providerResponse = await fetch("/api/report-writing/get-providers")
      const providerData = await providerResponse.json()

      if (!providerData.success) {
        alert(providerData.error || "Failed to load providers.")
        return
      }

      const loadedProviders: Provider[] = providerData.providers || []
      setProviders(loadedProviders)

      const allDrafts: Draft[] = []

      for (const provider of loadedProviders) {
        const draftsResponse = await fetch(
          `/api/report-writing/get-drafts?providerId=${provider.id}`
        )
        const draftsData = await draftsResponse.json()

        if (draftsData.success) {
          allDrafts.push(
            ...(draftsData.drafts || []).map((draft: Draft) => ({
              ...draft,
              provider_id: draft.provider_id || provider.id,
              provider_name: provider.name,
            }))
          )
        }
      }

      setDrafts(allDrafts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProvidersAndDrafts()
  }, [])

  async function downloadPdf(draft: Draft) {
    setLoadingPdfId(draft.id)

    try {
      const response = await fetch("/api/report-writing/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      })

      if (!response.ok) {
        alert("Failed to generate PDF.")
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
      setLoadingPdfId(null)
    }
  }

  function resetFilters() {
    setProviderId("all")
    setPatientSearch("")
    setReportType("all")
    setStatusFilter("all")
    setFromDate("")
    setToDate("")
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">
              Letter History / Archive
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Search completed, uploaded, emailed, approved, and draft letters.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/report-writing/typist"
              }}
              className="rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to Typist Portal
            </button>

            <button
              type="button"
              onClick={loadProvidersAndDrafts}
              disabled={loading}
              className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">
              Results
            </div>
            <div className="mt-1 text-2xl font-bold">{summary.total}</div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">
              Emailed
            </div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">
              {summary.emailed}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">
              Uploaded
            </div>
            <div className="mt-1 text-2xl font-bold text-indigo-700">
              {summary.uploaded}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">
              Awaiting
            </div>
            <div className="mt-1 text-2xl font-bold text-amber-700">
              {summary.awaiting}
            </div>
          </div>
        </div>

        <section className="rounded-2xl border bg-white p-5">
          <div className="grid gap-4 lg:grid-cols-6">
            <label className="block lg:col-span-2">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Search patient / referrer / email
              </div>
              <input
                className="w-full rounded-xl border p-3"
                placeholder="Search..."
                value={patientSearch}
                onChange={(event) => setPatientSearch(event.target.value)}
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Provider
              </div>
              <select
                className="w-full rounded-xl border p-3"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
              >
                <option value="all">All providers</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Report type
              </div>
              <select
                className="w-full rounded-xl border p-3"
                value={reportType}
                onChange={(event) => setReportType(event.target.value)}
              >
                <option value="all">All types</option>
                {reportTypeOptions.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Status
              </div>
              <select
                className="w-full rounded-xl border p-3"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft / edited</option>
                <option value="awaiting">Awaiting approval</option>
                <option value="approved">Approved</option>
                <option value="uploaded">Uploaded</option>
                <option value="emailed">Emailed</option>
                <option value="completed">Completed</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                className="w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Created from
              </div>
              <input
                type="date"
                className="w-full rounded-xl border p-3"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Created to
              </div>
              <input
                type="date"
                className="w-full rounded-xl border p-3"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border bg-white">
          <div className="border-b p-4">
            <h2 className="text-lg font-bold">Letters</h2>
            <p className="text-sm text-slate-500">
              Showing {filteredDrafts.length} of {drafts.length} letters.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-sm text-slate-500">Loading history...</div>
          ) : null}

          {!loading && filteredDrafts.length === 0 ? (
            <div className="p-8 text-sm text-slate-500">
              No letters match the current filters.
            </div>
          ) : null}

          <div className="space-y-2 p-3">
            {filteredDrafts.map((draft) => (
              <div
                key={draft.id}
                className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-slate-950">
                        {draft.patient_name || "Unnamed patient"}
                      </div>
                      <span
                        className={[
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          getStatusClass(draft),
                        ].join(" ")}
                      >
                        {getStatusLabel(draft)}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>DOB: {draft.patient_dob || "Not available"}</span>
                      <span>
                        {reportTypeLabels[draft.report_type] ||
                          draft.report_type?.replace(/_/g, " ") ||
                          "Report"}
                      </span>
                      <span>Provider: {draft.provider_name || draft.provider_id || "—"}</span>
                      <span>Created: {formatDateTime(draft.created_at)}</span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Referrer: {draft.referrer_name || "Not recorded"}</span>
                      {draft.emailed_to_referrer_email ? (
                        <span className="text-emerald-700">
                          Email: {draft.emailed_to_referrer_email}
                        </span>
                      ) : null}
                      {draft.uploaded_to_praktika_at ? (
                        <span>Uploaded: {formatDateTime(draft.uploaded_to_praktika_at)}</span>
                      ) : null}
                      {draft.emailed_to_referrer_at ? (
                        <span>Emailed: {formatDateTime(draft.emailed_to_referrer_at)}</span>
                      ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <ActorBadge
                        label={
                          draft.report_type === "dictated_letter" ||
                          draft.report_type === "patient_letter"
                            ? "Dictated"
                            : "Generated"
                        }
                        initials={draft.drafted_by_initials}
                        name={draft.drafted_by_name}
                      />
                      <ActorBadge
                        label="Approved"
                        initials={draft.approved_by_initials}
                        name={draft.approved_by_name}
                      />
                      <ActorBadge
                        label="Uploaded"
                        initials={draft.uploaded_by_initials}
                        name={draft.uploaded_by_name}
                      />
                      <ActorBadge
                        label="Emailed"
                        initials={draft.emailed_by_initials}
                        name={draft.emailed_by_name}
                      />
                    </div>

                    <RetentionBadges draft={draft} />
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => downloadPdf(draft)}
                      disabled={loadingPdfId === draft.id || !hasFinalText(draft)}
                      title={
                        hasFinalText(draft)
                          ? "Download PDF"
                          : "PDF unavailable because final letter text has been deleted by retention cleanup."
                      }
                      className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {loadingPdfId === draft.id ? "Generating..." : "PDF"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = `/report-writing/typist?draftId=${draft.id}`
                      }}
                      className="rounded-lg border bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Open
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
