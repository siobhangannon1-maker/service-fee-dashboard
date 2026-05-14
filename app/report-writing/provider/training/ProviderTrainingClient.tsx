"use client"

import { useEffect, useState } from "react"

const defaultCorrespondenceTypes = [
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

type Rule = {
  id: string
  report_type: string
  rule_text: string
}

type Example = {
  id: string
  report_type: string
  title: string | null
  example_text: string
}

type Terminology = {
  id: string
  spoken_or_written_text: string
  preferred_text: string
}

type CorrespondenceType = {
  id: string
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

export default function ProviderTrainingClient() {
  const [providerId, setProviderId] = useState("")
  const [providerName, setProviderName] = useState("")

  const [rules, setRules] = useState<Rule[]>([])
  const [examples, setExamples] = useState<Example[]>([])
  const [terminology, setTerminology] = useState<Terminology[]>([])
  const [customTypes, setCustomTypes] = useState<CorrespondenceType[]>([])

  const [reportType, setReportType] = useState("consultation_report")
  const [newTypeLabel, setNewTypeLabel] = useState("")

  const [ruleText, setRuleText] = useState("")
  const [exampleTitle, setExampleTitle] = useState("")
  const [exampleText, setExampleText] = useState("")
  const [spokenText, setSpokenText] = useState("")
  const [preferredText, setPreferredText] = useState("")

  const [loading, setLoading] = useState(false)
  const deidentifiedPreview = exampleText
    ? deidentifyText(exampleText)
    : "De-identified preview will appear here."

  async function loadCurrentProvider() {
    const response = await fetch("/api/report-writing/current-provider")
    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Could not find provider.")
      return
    }

    setProviderId(data.provider.id)
    setProviderName(data.provider.name || "")
  }

  async function loadTraining(providerIdToLoad = providerId) {
    if (!providerIdToLoad) return

    const response = await fetch(
      `/api/report-writing/provider-training?providerId=${providerIdToLoad}`
    )

    const data = await response.json()

    if (data.success) {
      setRules(data.rules)
      setExamples(data.examples)
      setTerminology(data.terminology)
      setCustomTypes(data.correspondenceTypes || [])
      setProviderName(data.provider?.name || "")
    }
  }

  useEffect(() => {
    loadCurrentProvider()
  }, [])

  useEffect(() => {
    if (providerId) {
      loadTraining(providerId)
    }
  }, [providerId])

  async function addCorrespondenceType() {
    if (!newTypeLabel.trim()) {
      alert("Enter a correspondence type name.")
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
        alert(data.error || "Failed to add correspondence type.")
        return
      }

      setNewTypeLabel("")
      await loadTraining()
    } finally {
      setLoading(false)
    }
  }

  async function addRule() {
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
      await loadTraining()
    } finally {
      setLoading(false)
    }
  }

  async function addExample() {
    if (!exampleText.trim()) {
      alert("Paste or upload an example first.")
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
          type: "example",
          reportType,
          title: exampleTitle,
          exampleText: deidentifyText(exampleText),
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to save example.")
        return
      }

      setExampleTitle("")
      setExampleText("")
      await loadTraining()
    } finally {
      setLoading(false)
    }
  }

  async function addTerminology() {
    if (!spokenText.trim() || !preferredText.trim()) {
      alert("Enter both terminology fields.")
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
          type: "terminology",
          spokenOrWrittenText: spokenText,
          preferredText,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to save terminology.")
        return
      }

      setSpokenText("")
      setPreferredText("")
      await loadTraining()
    } finally {
      setLoading(false)
    }
  }

  async function deleteItem(
    type: "rule" | "example" | "terminology",
    id: string
  ) {
    const confirmed = confirm("Delete this training item?")

    if (!confirmed) return

    const response = await fetch(
      "/api/report-writing/provider-training/delete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type, id }),
      }
    )

    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Failed to delete item.")
      return
    }

    await loadTraining()
  }

  async function handleTextFileUpload(file: File) {
    const text = await file.text()
    setExampleText(text)

    if (!exampleTitle.trim()) {
      setExampleTitle(file.name.replace(/\.[^/.]+$/, ""))
    }
  }

  if (!providerId) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold">Report Writing Training</h1>
        <p className="mt-2 text-slate-600">
          Loading provider training page...
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Report Writing Training</h1>
        <p className="mt-2 text-slate-600">
          Provider-specific training for {providerName || "this provider"}.
        </p>
      </div>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        These rules and examples are only used for this provider. Examples are
        de-identified before saving, but you should still check the preview.
      </div>

      <section className="rounded-2xl border bg-white p-5">
        <h2 className="text-xl font-bold">Correspondence Type</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <select
            className="rounded-xl border p-3"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
          >
            {defaultCorrespondenceTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}

            {customTypes.map((type) => (
              <option key={type.type_key} value={type.type_key}>
                {type.label}
              </option>
            ))}
          </select>

          <div className="flex gap-3">
            <input
              className="flex-1 rounded-xl border p-3"
              placeholder="New type, e.g. TMJ Report"
              value={newTypeLabel}
              onChange={(e) => setNewTypeLabel(e.target.value)}
            />

            <button
              onClick={addCorrespondenceType}
              disabled={loading}
              className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              Add Type
            </button>
          </div>
        </div>

        <p className="mt-2 text-sm text-slate-500">
          Current training category:{" "}
          <span className="font-semibold">{reportType}</span>
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Rules</h2>

          <textarea
            className="h-40 w-full rounded-xl border p-3"
            placeholder="Example: Always start consultation reports with: Thank you for referring [patient first name]."
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
          />

          <button
            onClick={addRule}
            disabled={loading}
            className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            Add Rule
          </button>
        </section>

        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Example Correspondence</h2>

          <input
            className="w-full rounded-xl border p-3"
            placeholder="Example title"
            value={exampleTitle}
            onChange={(e) => setExampleTitle(e.target.value)}
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
                  await handleTextFileUpload(file)
                }
              }}
            />
          </label>

          <textarea
            className="h-40 w-full rounded-xl border p-3"
            placeholder="Or paste an example letter here..."
            value={exampleText}
            onChange={(e) => setExampleText(e.target.value)}
          />

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            This preview is what will be saved.
          </div>

          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-xs text-slate-700">
            {deidentifiedPreview}
          </div>

          <button
            onClick={addExample}
            disabled={loading}
            className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            Add Example
          </button>
        </section>

        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Terminology Preferences</h2>

          <input
            className="w-full rounded-xl border p-3"
            placeholder="Spoken/written text, e.g. one six"
            value={spokenText}
            onChange={(e) => setSpokenText(e.target.value)}
          />

          <input
            className="w-full rounded-xl border p-3"
            placeholder="Preferred text, e.g. 16"
            value={preferredText}
            onChange={(e) => setPreferredText(e.target.value)}
          />

          <button
            onClick={addTerminology}
            disabled={loading}
            className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            Add Terminology
          </button>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Saved Rules</h2>

          <div className="mt-4 space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border p-3">
                <div className="text-xs font-semibold text-slate-500">
                  {rule.report_type}
                </div>
                <div className="mt-1 text-sm">{rule.rule_text}</div>

                <button
                  onClick={() => deleteItem("rule", rule.id)}
                  className="mt-2 text-xs font-semibold text-red-600"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Saved Examples</h2>

          <div className="mt-4 space-y-3">
            {examples.map((example) => (
              <div key={example.id} className="rounded-xl border p-3">
                <div className="text-xs font-semibold text-slate-500">
                  {example.report_type}
                </div>
                <div className="mt-1 font-semibold">
                  {example.title || "Untitled"}
                </div>
                <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-slate-600">
                  {example.example_text}
                </div>

                <button
                  onClick={() => deleteItem("example", example.id)}
                  className="mt-2 text-xs font-semibold text-red-600"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Saved Terminology</h2>

          <div className="mt-4 space-y-3">
            {terminology.map((item) => (
              <div key={item.id} className="rounded-xl border p-3 text-sm">
                <div>
                  <span className="font-semibold">Replace: </span>
                  {item.spoken_or_written_text}
                </div>
                <div>
                  <span className="font-semibold">With: </span>
                  {item.preferred_text}
                </div>

                <button
                  onClick={() => deleteItem("terminology", item.id)}
                  className="mt-2 text-xs font-semibold text-red-600"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}