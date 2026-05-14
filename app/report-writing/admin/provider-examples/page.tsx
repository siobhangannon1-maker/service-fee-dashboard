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
  providers?: {
    name: string
  }
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
  const [defaultTypes, setDefaultTypes] = useState<ReportType[]>([])
  const [customTypes, setCustomTypes] = useState<CustomType[]>([])

  const [providerId, setProviderId] = useState("")
  const [reportType, setReportType] = useState("consultation_report")
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

  async function loadPage() {
    const response = await fetch("/api/report-writing/admin/provider-examples")
    const data = await response.json()

    if (data.success) {
      setProviders(data.providers)
      setExamples(data.examples)
      setDefaultTypes(data.defaultTypes)
      setCustomTypes(data.customTypes)

      if (data.providers.length > 0 && !providerId) {
        setProviderId(data.providers[0].id)
      }
    }
  }

  useEffect(() => {
    loadPage()
  }, [])

  async function handleFileUpload(file: File) {
    const text = await file.text()
    setExampleText(text)

    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ""))
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
          exampleText,
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

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">
          Admin Provider Example Training
        </h1>
        <p className="mt-2 text-slate-600">
          Upload de-identified correspondence examples for individual providers.
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

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <h2 className="text-xl font-bold">Add Provider Example</h2>

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

        <AuditTrail providerId={providerId || undefined} />
      </div>

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