"use client"

import { useEffect, useMemo, useState } from "react"
import ProviderKnowledgeTrainerPanel from "@/components/report-writing/ProviderKnowledgeTrainerPanel"

const fallbackDefaultTypes = [
  { value: "consultation_report", label: "Consultation Report" },
  { value: "treatment_report", label: "Treatment Report" },
  { value: "review", label: "Review" },
  { value: "SPT_report", label: "SPT Report" },
  { value: "osseointegration_letter", label: "Osseointegration Letter" },
  { value: "surgery_report", label: "Surgery Report" },
  { value: "referral_reply", label: "Referral Reply" },
  { value: "post_op_letter", label: "Post-operative Letter" },
  { value: "medico_legal_report", label: "Medico-legal Report" },
  { value: "patient_letter", label: "Patient Letter" },
  { value: "gp_letter", label: "GP Letter" },
]

type Provider = { id: string; name: string }

type Example = {
  id: string
  provider_id: string
  report_type: string
  title: string | null
  example_text: string
  scenario_tags?: string[] | null
  scenario_summary?: string | null
  is_preferred?: boolean | null
  providers?: { name: string }
}

type Rule = { id: string; report_type: string; rule_text: string }
type ReportType = { value: string; label: string }
type CustomType = { provider_id: string; type_key: string; label: string }

type ReportTypeSetting = {
  id?: string
  provider_id: string
  report_type: string
  label: string
  is_enabled: boolean
  display_order?: number | null
}

function deidentifyText(text: string) {
  return text
    .replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, "[DATE]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[DATE]")
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "[PERSON NAME]")
    .replace(
      /\b\d{1,5}\s+[A-Za-z0-9\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Lane|Ln|Place|Pl)\b/gi,
      "[ADDRESS]"
    )
    .replace(/\b04\d{2}\s?\d{3}\s?\d{3}\b/g, "[PHONE]")
    .replace(/\b0\d\s?\d{4}\s?\d{4}\b/g, "[PHONE]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\bDOB[:\s]*[^\n,]+/gi, "DOB: [DOB]")
}

export default function AdminProviderExamplesPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [examples, setExamples] = useState<Example[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [defaultTypes, setDefaultTypes] = useState<ReportType[]>([])
  const [customTypes, setCustomTypes] = useState<CustomType[]>([])
  const [reportTypeSettings, setReportTypeSettings] = useState<ReportTypeSetting[]>([])

  const [providerId, setProviderId] = useState("")
  const [reportType, setReportType] = useState("consultation_report")
  const [newTypeLabel, setNewTypeLabel] = useState("")
  const [ruleText, setRuleText] = useState("")
  const [title, setTitle] = useState("")
  const [exampleText, setExampleText] = useState("")
  const [showAdvancedManualTools, setShowAdvancedManualTools] = useState(false)
  const [showReportTypeManager, setShowReportTypeManager] = useState(false)
  const [loading, setLoading] = useState(false)

  const allProviderReportTypes = useMemo(() => {
    const baseTypes = defaultTypes.length > 0 ? defaultTypes : fallbackDefaultTypes
    const providerCustomTypes = customTypes
      .filter((type) => type.provider_id === providerId)
      .map((type) => ({ value: type.type_key, label: type.label }))

    const seen = new Set<string>()

    return [...baseTypes, ...providerCustomTypes].filter((type) => {
      if (seen.has(type.value)) return false
      seen.add(type.value)
      return true
    })
  }, [defaultTypes, customTypes, providerId])

  function getSetting(reportTypeValue: string) {
    return reportTypeSettings.find((setting) => setting.report_type === reportTypeValue)
  }

  function isReportTypeEnabled(type: ReportType) {
    const setting = getSetting(type.value)
    return setting ? setting.is_enabled : true
  }

  const availableTypes = useMemo(() => {
    return allProviderReportTypes.filter((type) => isReportTypeEnabled(type))
  }, [allProviderReportTypes, reportTypeSettings])

  const selectedProviderName =
    providers.find((provider) => provider.id === providerId)?.name || "Provider"

  const filteredExamples = examples.filter(
    (example) => !providerId || example.provider_id === providerId
  )

  async function loadPage() {
    const response = await fetch("/api/report-writing/admin/provider-examples")
    const data = await response.json()

    if (data.success) {
      setProviders(data.providers || [])
      setExamples(data.examples || [])
      setDefaultTypes(data.defaultTypes || [])
      setCustomTypes(data.customTypes || [])

      if (data.providers?.length > 0 && !providerId) {
        setProviderId(data.providers[0].id)
      }
    }
  }

  async function loadProviderRules(providerIdToLoad = providerId) {
    if (!providerIdToLoad) return

    const response = await fetch(
      `/api/report-writing/provider-training?providerId=${providerIdToLoad}`
    )
    const data = await response.json()

    if (data.success) setRules(data.rules || [])
  }

  async function loadReportTypeSettings(providerIdToLoad = providerId) {
    if (!providerIdToLoad) return

    const response = await fetch(
      `/api/report-writing/provider-report-type-settings?providerId=${providerIdToLoad}`
    )
    const data = await response.json()

    if (data.success) setReportTypeSettings(data.settings || [])
  }

  async function refreshTrainingData() {
    await loadProviderRules(providerId)
    await loadReportTypeSettings(providerId)
    await loadPage()
  }

  useEffect(() => {
    loadPage()
  }, [])

  useEffect(() => {
    if (providerId) {
      loadProviderRules(providerId)
      loadReportTypeSettings(providerId)
    }
  }, [providerId])

  useEffect(() => {
    if (availableTypes.length === 0) return
    const currentTypeStillEnabled = availableTypes.some((type) => type.value === reportType)
    if (!currentTypeStillEnabled) {
      setReportType(availableTypes[0].value)
    }
  }, [availableTypes, reportType])

  async function handleFileUpload(file: File) {
    const text = await file.text()
    setExampleText(text)
    if (!title.trim()) setTitle(file.name.replace(/\.[^/.]+$/, ""))
  }

  async function addCorrespondenceType() {
    if (!providerId) return alert("Select a provider.")
    if (!newTypeLabel.trim()) return alert("Enter a report type name.")

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/provider-training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          type: "correspondence_type",
          label: newTypeLabel,
        }),
      })
      const data = await response.json()

      if (!data.success) return alert(data.error || "Failed to add report type.")

      setNewTypeLabel("")
      await refreshTrainingData()
    } finally {
      setLoading(false)
    }
  }

  async function toggleReportType(type: ReportType, enabled: boolean) {
    if (!providerId) return alert("Select a provider first.")

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/provider-report-type-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          reportType: type.value,
          label: type.label,
          isEnabled: enabled,
          displayOrder: allProviderReportTypes.findIndex((item) => item.value === type.value) + 1,
        }),
      })

      const data = await response.json()
      if (!data.success) return alert(data.error || "Failed to update report type.")

      await loadReportTypeSettings(providerId)
    } finally {
      setLoading(false)
    }
  }

  async function addRule() {
    if (!providerId) return alert("Select a provider.")
    if (!ruleText.trim()) return alert("Enter a rule first.")

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/provider-training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, type: "rule", reportType, ruleText }),
      })
      const data = await response.json()

      if (!data.success) return alert(data.error || "Failed to save rule.")

      setRuleText("")
      await refreshTrainingData()
    } finally {
      setLoading(false)
    }
  }

  async function addExample() {
    if (!providerId) return alert("Select a provider.")
    if (!exampleText.trim()) return alert("Paste or upload an example first.")

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/admin/provider-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          reportType,
          title,
          exampleText: deidentifyText(exampleText),
        }),
      })
      const data = await response.json()

      if (!data.success) return alert(data.error || "Failed to add example.")

      setTitle("")
      setExampleText("")
      await loadPage()
    } finally {
      setLoading(false)
    }
  }

  async function deleteRule(ruleId: string) {
    if (!confirm("Delete this rule?")) return

    const response = await fetch("/api/report-writing/provider-training/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "rule", id: ruleId }),
    })
    const data = await response.json()

    if (!data.success) return alert(data.error || "Failed to delete rule.")
    await loadProviderRules(providerId)
  }

  async function deleteExample(exampleId: string) {
    if (!confirm("Delete this example?")) return

    const response = await fetch("/api/report-writing/admin/provider-examples/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exampleId }),
    })
    const data = await response.json()

    if (!data.success) return alert(data.error || "Failed to delete example.")
    await loadPage()
  }

  async function autoTagExamples() {
    if (!providerId) return alert("Select a provider first.")
    if (!confirm("Auto-tag this provider's examples?")) return

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/admin/auto-tag-provider-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      })
      const data = await response.json()

      if (!data.success) return alert(data.error || "Failed to auto-tag examples.")

      alert(`Auto-tagged ${data.updated || 0} example(s).`)
      await loadPage()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Provider Letter Knowledge</h1>
        <p className="mt-2 text-slate-600">
          Simple staff training at the top. Manual rules and examples remain
          available for advanced admin control.
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-bold">Provider and Correspondence Type</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <select
            className="w-full rounded-xl border p-3"
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value)
              setReportType("consultation_report")
            }}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>

          <select
            className="w-full rounded-xl border p-3"
            value={reportType}
            onChange={(event) => setReportType(event.target.value)}
          >
            {availableTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-500">
            Current provider: <span className="font-semibold">{selectedProviderName}</span>
          </p>

          <button
            onClick={autoTagExamples}
            disabled={loading || !providerId}
            className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Auto-tag Provider Examples
          </button>

          <button
            type="button"
            onClick={() => setShowReportTypeManager((value) => !value)}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold"
          >
            {showReportTypeManager ? "Hide Report Types" : "Manage Report Types"}
          </button>
        </div>

        {showReportTypeManager ? (
          <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
            <div>
              <h3 className="font-bold">Manage report types for this provider</h3>
              <p className="mt-1 text-sm text-slate-600">
                Unticking a report type hides it for this provider only. Existing examples,
                manual rules and provider knowledge are kept safely in the database.
              </p>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {allProviderReportTypes.map((type) => (
                <label
                  key={type.value}
                  className="flex items-center gap-3 rounded-xl border bg-white p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={isReportTypeEnabled(type)}
                    onChange={(event) => toggleReportType(type, event.target.checked)}
                  />
                  <span>
                    <span className="font-semibold">{type.label}</span>
                    <span className="ml-2 text-xs text-slate-400">{type.value}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 rounded-xl border bg-white p-4">
              <h4 className="font-semibold">Add a provider-specific report type</h4>
              <p className="mt-1 text-sm text-slate-500">
                Custom report types are only visible for the selected provider.
              </p>
              <div className="mt-3 flex flex-col gap-3 md:flex-row">
                <input
                  className="flex-1 rounded-xl border p-3"
                  placeholder="New type, e.g. Implant Review Letter"
                  value={newTypeLabel}
                  onChange={(event) => setNewTypeLabel(event.target.value)}
                />
                <button
                  onClick={addCorrespondenceType}
                  disabled={loading || !providerId}
                  className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Add Report Type
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {providerId ? (
        <ProviderKnowledgeTrainerPanel
          providerId={providerId}
          reportType={reportType}
          availableReportTypes={availableTypes}
          onTrainingChanged={refreshTrainingData}
        />
      ) : null}

      <section className="rounded-2xl border bg-slate-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Advanced Manual Training</h2>
            <p className="mt-1 text-sm text-slate-600">
              For admin use only. Existing manual rules and examples are kept and
              still used by generation.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedManualTools((value) => !value)}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold"
          >
            {showAdvancedManualTools ? "Hide Manual Tools" : "Show Manual Tools"}
          </button>
        </div>

        {showAdvancedManualTools ? (
          <div className="mt-5 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-4 rounded-2xl border bg-white p-5">
                <h3 className="text-lg font-bold">Add Provider Rule</h3>
                <textarea
                  className="h-40 w-full rounded-xl border p-3"
                  placeholder="Manual provider rule..."
                  value={ruleText}
                  onChange={(event) => setRuleText(event.target.value)}
                />
                <button
                  onClick={addRule}
                  disabled={loading || !providerId}
                  className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Add Rule To Provider
                </button>
              </section>

              <section className="space-y-4 rounded-2xl border bg-white p-5">
                <h3 className="text-lg font-bold">Add Provider Example</h3>
                <input
                  className="w-full rounded-xl border p-3"
                  placeholder="Example title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:bg-slate-50">
                  Upload a plain text example letter
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0]
                      if (file) await handleFileUpload(file)
                    }}
                  />
                </label>
                <textarea
                  className="h-52 w-full rounded-xl border p-3"
                  placeholder="Or paste example correspondence here..."
                  value={exampleText}
                  onChange={(event) => setExampleText(event.target.value)}
                />
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-xs text-slate-700">
                  {exampleText
                    ? deidentifyText(exampleText)
                    : "De-identified preview will appear here."}
                </div>
                <button
                  onClick={addExample}
                  disabled={loading || !providerId}
                  className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Add Example To Provider
                </button>
              </section>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Saved Manual Rules</h2>
          <div className="mt-4 space-y-3">
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                No manual rules saved for this provider.
              </div>
            ) : null}
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border p-4">
                <div className="text-xs font-semibold text-slate-500">
                  {rule.report_type}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {rule.rule_text}
                </div>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="mt-3 text-sm font-semibold text-red-600"
                >
                  Delete Rule
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Saved Examples</h2>
          <div className="mt-4 space-y-3">
            {filteredExamples.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                No examples saved for this provider.
              </div>
            ) : null}
            {filteredExamples.map((example) => (
              <div key={example.id} className="rounded-xl border p-4">
                <div className="text-xs font-semibold text-slate-500">
                  {example.providers?.name || "Provider"} · {example.report_type}
                </div>
                <div className="mt-1 font-semibold">
                  {example.title || "Untitled example"}
                </div>
                {example.scenario_summary ? (
                  <div className="mt-2 rounded-lg bg-purple-50 p-2 text-xs text-purple-900">
                    {example.scenario_summary}
                  </div>
                ) : null}
                {example.scenario_tags?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {example.scenario_tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">
                  {example.example_text}
                </div>
                <button
                  onClick={() => deleteExample(example.id)}
                  className="mt-3 text-sm font-semibold text-red-600"
                >
                  Delete Example
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
