"use client"

import { useEffect, useMemo, useState } from "react"
import AuditTrail from "@/components/report-writing/AuditTrail"

type Provider = {
  id: string
  name: string
}

type Example = {
  id: string
  provider_id: string
  report_type: string
  title: string | null
  example_text: string
  scenario_tags?: string[] | null
  scenario_summary?: string | null
  is_preferred?: boolean | null
  providers?: {
    name: string
  }
}

type Rule = {
  id: string
  report_type: string
  rule_text: string
}

type ReportType = {
  value: string
  label: string
}

type CustomType = {
  provider_id: string
  type_key: string
  label: string
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

  const [providerId, setProviderId] = useState("")
  const [reportType, setReportType] = useState("consultation_report")

  const [newTypeLabel, setNewTypeLabel] = useState("")
  const [ruleText, setRuleText] = useState("")
  const [title, setTitle] = useState("")
  const [exampleText, setExampleText] = useState("")

  const [actorFullName, setActorFullName] = useState("")
  const [actorEmail, setActorEmail] = useState("")

  const [loading, setLoading] = useState(false)

  const availableTypes = useMemo(() => {
    const providerCustomTypes = customTypes
      .filter((type) => type.provider_id === providerId)
      .map((type) => ({
        value: type.type_key,
        label: type.label,
      }))

    return [...defaultTypes, ...providerCustomTypes]
  }, [defaultTypes, customTypes, providerId])

  const filteredExamples = examples.filter((example) => {
    if (!providerId) return true
    return example.provider_id === providerId
  })

  const selectedProviderName =
    providers.find((provider) => provider.id === providerId)?.name || "Provider"

  async function loadPage() {
    const response = await fetch("/api/report-writing/admin/provider-examples")
    const data = await response.json()

    if (data.success) {
      setProviders(data.providers || [])
      setExamples(data.examples || [])
      setDefaultTypes(data.defaultTypes || [])
      setCustomTypes(data.customTypes || [])

      if (data.providers.length > 0 && !providerId) {
        setProviderId(data.providers[0].id)
      }
    }
  }

  async function loadProviderRules(providerIdToLoad: string) {
    if (!providerIdToLoad) return

    const response = await fetch(
      `/api/report-writing/provider-training?providerId=${providerIdToLoad}`
    )

    const data = await response.json()

    if (data.success) {
      setRules(data.rules || [])
    }
  }

  useEffect(() => {
    loadPage()
  }, [])

  useEffect(() => {
    if (providerId) {
      loadProviderRules(providerId)
    }
  }, [providerId])

  async function handleFileUpload(file: File) {
    const text = await file.text()
    setExampleText(text)

    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ""))
    }
  }

  async function addCorrespondenceType() {
    if (!providerId) {
      alert("Select a provider.")
      return
    }

    if (!newTypeLabel.trim()) {
      alert("Enter a report type name.")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/provider-training", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          type: "correspondence_type",
          label: newTypeLabel,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to add report type.")
        return
      }

      setNewTypeLabel("")
      await loadPage()
    } finally {
      setLoading(false)
    }
  }

  async function addRule() {
    if (!providerId) {
      alert("Select a provider.")
      return
    }

    if (!ruleText.trim()) {
      alert("Enter a rule first.")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/provider-training", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          type: "rule",
          reportType,
          ruleText,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to save rule.")
        return
      }

      setRuleText("")
      await loadProviderRules(providerId)
      await loadPage()
    } finally {
      setLoading(false)
    }
  }

  async function addExample() {
    if (!providerId) {
      alert("Select a provider.")
      return
    }

    if (!exampleText.trim()) {
      alert("Paste or upload an example first.")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/admin/provider-examples", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          reportType,
          title,
          exampleText: deidentifyText(exampleText),
          actorFullName,
          actorEmail,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to add example.")
        return
      }

      setTitle("")
      setExampleText("")
      await loadPage()
    } finally {
      setLoading(false)
    }
  }

  async function deleteExample(exampleId: string) {
    const confirmed = confirm("Delete this example?")

    if (!confirmed) return

    const response = await fetch(
      "/api/report-writing/admin/provider-examples/delete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          exampleId,
          actorFullName,
          actorEmail,
        }),
      }
    )

    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Failed to delete example.")
      return
    }

    await loadPage()
  }

  async function deleteRule(ruleId: string) {
    const confirmed = confirm("Delete this rule?")

    if (!confirmed) return

    const response = await fetch(
      "/api/report-writing/provider-training/delete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "rule",
          id: ruleId,
        }),
      }
    )

    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Failed to delete rule.")
      return
    }

    await loadProviderRules(providerId)
  }


  async function autoTagExamples() {
    if (!providerId) {
      alert("Select a provider first.")
      return
    }

    const confirmed = confirm(
      "Auto-tag this provider's examples? This helps AI choose the best matching examples when generating letters."
    )

    if (!confirmed) return

    setLoading(true)

    try {
      const response = await fetch(
        "/api/report-writing/admin/auto-tag-provider-examples",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            providerId,
          }),
        }
      )

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to auto-tag examples.")
        return
      }

      alert(`Auto-tagged ${data.updated || 0} example(s).`)
      await loadPage()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Admin Provider Letter Training</h1>
        <p className="mt-2 text-slate-600">
          Centrally manage provider-specific report types, rules, and examples
          for AI letter writing.
        </p>
      </div>

      <section className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-2">
        <input
          className="rounded-xl border p-3"
          placeholder="Your full name for audit trail"
          value={actorFullName}
          onChange={(e) => setActorFullName(e.target.value)}
        />

        <input
          className="rounded-xl border p-3"
          placeholder="Your email for audit trail"
          value={actorEmail}
          onChange={(e) => setActorEmail(e.target.value)}
        />
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-bold">Provider and Correspondence Type</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <select
            className="w-full rounded-xl border p-3"
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value)
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
            onChange={(e) => setReportType(e.target.value)}
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
            Current provider:{" "}
            <span className="font-semibold">{selectedProviderName}</span>
          </p>

          <button
            onClick={autoTagExamples}
            disabled={loading || !providerId}
            className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Auto-tag Provider Examples
          </button>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-bold">
          Add Provider-Specific Report Type
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          This report type will only be available for the selected provider.
        </p>

        <div className="mt-4 flex flex-col gap-3 md:flex-row">
          <input
            className="flex-1 rounded-xl border p-3"
            placeholder="New type, e.g. Implant Review Letter"
            value={newTypeLabel}
            onChange={(e) => setNewTypeLabel(e.target.value)}
          />

          <button
            onClick={addCorrespondenceType}
            disabled={loading}
            className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            Add Report Type
          </button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border bg-white p-5">
            <h2 className="text-xl font-bold">Add Provider Rule</h2>

            <textarea
              className="h-40 w-full rounded-xl border p-3"
              placeholder="Example: For this provider, always start consultation reports with: Thank you for referring [patient first name]."
              value={ruleText}
              onChange={(e) => setRuleText(e.target.value)}
            />

            <button
              onClick={addRule}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              Add Rule To Provider
            </button>
          </section>

          <section className="space-y-4 rounded-2xl border bg-white p-5">
            <h2 className="text-xl font-bold">Add Provider Example</h2>

            <input
              className="w-full rounded-xl border p-3"
              placeholder="Example title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:bg-slate-50">
              Upload a plain text example letter
              <input
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) {
                    await handleFileUpload(file)
                  }
                }}
              />
            </label>

            <textarea
              className="h-52 w-full rounded-xl border p-3"
              placeholder="Or paste example correspondence here..."
              value={exampleText}
              onChange={(e) => setExampleText(e.target.value)}
            />

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Preview below is de-identified and is what will be saved.
            </div>

            <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-xs text-slate-700">
              {exampleText
                ? deidentifyText(exampleText)
                : "De-identified preview will appear here."}
            </div>

            <button
              onClick={addExample}
              disabled={loading}
              className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              Add Example To Provider
            </button>
          </section>
        </div>

        <AuditTrail providerId={providerId || undefined} />
      </div>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-bold">Saved Provider Rules</h2>

        <div className="mt-4 space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              No rules saved for this provider.
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
        <h2 className="text-xl font-bold">Saved Provider Examples</h2>

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

              {example.scenario_tags && example.scenario_tags.length > 0 ? (
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
  )
}