"use client"

import { useEffect, useState } from "react"

const reportTypes = [
  { value: "all", label: "All Report Types" },
  { value: "consultation_report", label: "Consultation Report" },
  { value: "treatment_report", label: "Treatment Report" },
  { value: "review", label: "Review" },
  { value: "SPT_report", label: "SPT Report" },
  { value: "osseointegration_letter", label: "Osseointegration Letter" },
  { value: "surgery_report", label: "Surgery Report" },
]

type UniversalRule = {
  id: string
  report_type: string
  rule_text: string
  created_at: string
}

export default function UniversalRulesPage() {
  const [rules, setRules] = useState<UniversalRule[]>([])
  const [reportType, setReportType] = useState("all")
  const [ruleText, setRuleText] = useState("")
  const [loading, setLoading] = useState(false)

  async function loadRules() {
    const response = await fetch("/api/report-writing/universal-rules")
    const data = await response.json()

    if (data.success) {
      setRules(data.rules)
    }
  }

  useEffect(() => {
    loadRules()
  }, [])

  async function addRule() {
    if (!ruleText.trim()) {
      alert("Enter a rule first.")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/universal-rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reportType,
          ruleText,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to save universal rule.")
        return
      }

      setRuleText("")
      setReportType("all")
      await loadRules()
    } finally {
      setLoading(false)
    }
  }

  async function deleteRule(ruleId: string) {
    const confirmed = confirm("Delete this universal rule?")

    if (!confirmed) return

    const response = await fetch("/api/report-writing/universal-rules/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ruleId }),
    })

    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Failed to delete universal rule.")
      return
    }

    await loadRules()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">Universal Report Rules</h1>
        <p className="mt-2 text-slate-600">
          These rules apply to all providers unless provider-specific rules add
          extra instructions.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <h2 className="text-xl font-bold">Add Universal Rule</h2>

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

        <textarea
          className="h-36 w-full rounded-xl border p-3"
          placeholder="Example: Use Australian English. Do not include a signature block. Use FDI tooth numbering such as 16, 26, 36, 46."
          value={ruleText}
          onChange={(e) => setRuleText(e.target.value)}
        />

        <button
          onClick={addRule}
          disabled={loading}
          className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          Add Universal Rule
        </button>
      </section>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="text-xl font-bold">Saved Universal Rules</h2>

        <div className="mt-4 space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
              No universal rules saved yet.
            </div>
          ) : null}

          {rules.map((rule) => (
            <div key={rule.id} className="rounded-xl border p-4">
              <div className="text-xs font-semibold uppercase text-slate-500">
                {rule.report_type}
              </div>

              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {rule.rule_text}
              </div>

              <button
                onClick={() => deleteRule(rule.id)}
                className="mt-3 text-sm font-semibold text-red-600"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}