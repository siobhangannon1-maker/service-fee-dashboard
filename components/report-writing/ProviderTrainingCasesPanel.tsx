"use client"

import { useEffect, useState } from "react"

type ReportTypeOption = {
  value: string
  label: string
}

type ExtractedBehaviour = {
  category: string
  difference: string
  provider_behaviour_rule: string
  reason: string
  confidence: "high" | "medium" | "low"
}

type TrainingAttempt = {
  attempt_number: number
  generated_letter: string
  score: number
  strengths: string[]
  missing_from_generated: string[]
  should_remove_from_generated: string[]
  suggested_rule: string
  comparison_summary: string
  extracted_behaviours?: ExtractedBehaviour[]
  do_not_learn?: string[]
}

type TrainingCase = {
  id: string
  report_type: string
  clinical_notes: string
  ai_draft: string | null
  final_letter: string
  suggested_rule_text: string | null
  approved_rule_text: string | null
  best_generated_letter: string | null
  training_attempts: TrainingAttempt[] | null
  status: string
  created_at: string
}

type ProviderAnalysisRule = {
  report_type: string
  rule_text: string
  reason: string
  confidence: "high" | "medium" | "low"
  supporting_case_count: number
}

type ProviderAnalysis = {
  provider_summary: string
  recommended_rules: ProviderAnalysisRule[]
  possible_duplicate_rules: Array<{
    rule_ids: string[]
    summary: string
  }>
  possible_conflicting_rules: Array<{
    rule_ids: string[]
    summary: string
  }>
  example_recommendations: Array<{
    example_id: string
    recommendation: string
    reason: string
  }>
  training_observations: string[]
}

type Props = {
  providerId: string
  reportType: string
  availableReportTypes: ReportTypeOption[]
  onRulePromoted?: () => Promise<void> | void
}

function truncate(text: string, maxLength = 300) {
  if (!text) return ""
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function scoreOutOfTen(score: number) {
  if (!Number.isFinite(score)) return "0.0"
  return (score / 10).toFixed(1)
}

export default function ProviderTrainingCasesPanel({
  providerId,
  reportType,
  availableReportTypes,
  onRulePromoted,
}: Props) {
  const [cases, setCases] = useState<TrainingCase[]>([])
  const [selectedReportType, setSelectedReportType] = useState(reportType)

  const [patientFirstName, setPatientFirstName] = useState("")
  const [patientGender, setPatientGender] = useState("neutral")
  const [referrerName, setReferrerName] = useState("")

  const [clinicalNotes, setClinicalNotes] = useState("")
  const [idealLetter, setIdealLetter] = useState("")
  const [maxAttempts, setMaxAttempts] = useState(2)

  const [lastAttempts, setLastAttempts] = useState<TrainingAttempt[]>([])
  const [lastSuggestedRules, setLastSuggestedRules] = useState("")
  const [lastBestLetter, setLastBestLetter] = useState("")

  const [providerAnalysis, setProviderAnalysis] =
    useState<ProviderAnalysis | null>(null)
  const [analyzingProvider, setAnalyzingProvider] = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadCases() {
    if (!providerId) return

    const response = await fetch(
      `/api/report-writing/provider-training-cases?providerId=${providerId}`
    )
    const data = await response.json()

    if (data.success) {
      setCases(data.cases || [])
    }
  }

  useEffect(() => {
    setSelectedReportType(reportType)
  }, [reportType])

  useEffect(() => {
    loadCases()
  }, [providerId])

  async function analyzeProviderTraining() {
    if (!providerId) {
      alert("Select a provider first.")
      return
    }

    setAnalyzingProvider(true)
    setProviderAnalysis(null)

    try {
      const response = await fetch(
        "/api/report-writing/provider-training-cases/analyze-provider",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ providerId }),
        }
      )

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Provider analysis failed.")
        return
      }

      setProviderAnalysis(data.analysis)
    } finally {
      setAnalyzingProvider(false)
    }
  }

  async function runTrainingLoop() {
    if (!providerId) {
      alert("Select a provider first.")
      return
    }

    if (!patientFirstName.trim()) {
      alert("Enter the patient first name.")
      return
    }

    if (!clinicalNotes.trim()) {
      alert("Paste clinical notes first.")
      return
    }

    if (!idealLetter.trim()) {
      alert("Paste the ideal provider-approved letter first.")
      return
    }

    setLoading(true)
    setLastAttempts([])
    setLastSuggestedRules("")
    setLastBestLetter("")

    try {
      const response = await fetch(
        "/api/report-writing/provider-training-cases/train-loop",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            providerId,
            reportType: selectedReportType,
            patientFirstName,
            patientGender,
            referrerName,
            clinicalNotes,
            idealLetter,
            maxAttempts,
          }),
        }
      )

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Training loop failed.")
        return
      }

      setLastAttempts(data.attempts || [])
      setLastSuggestedRules(data.suggestedRulesText || "")
      setLastBestLetter(data.bestAttempt?.generated_letter || "")

      await loadCases()
    } finally {
      setLoading(false)
    }
  }

  async function promoteRules(ruleText: string, caseReportType?: string) {
    if (!ruleText.trim()) {
      alert("No suggested rules to promote.")
      return
    }

    const confirmed = confirm("Add these suggested rules to provider rules?")
    if (!confirmed) return

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
          reportType: caseReportType || selectedReportType,
          ruleText,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to promote rules.")
        return
      }

      alert("Suggested rules added to provider rules.")

      if (onRulePromoted) {
        await onRulePromoted()
      }
    } finally {
      setLoading(false)
    }
  }

  async function promoteAnalysisRule(rule: ProviderAnalysisRule) {
    const confirmed = confirm("Add this recommended rule to provider rules?")
    if (!confirmed) return

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
          reportType: rule.report_type || "all",
          ruleText: rule.rule_text,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to add recommended rule.")
        return
      }

      alert("Recommended rule added.")

      if (onRulePromoted) {
        await onRulePromoted()
      }
    } finally {
      setLoading(false)
    }
  }

  async function saveIdealAsExample(trainingCase?: TrainingCase) {
    const exampleText = trainingCase?.final_letter || idealLetter
    const exampleReportType = trainingCase?.report_type || selectedReportType

    if (!exampleText.trim()) {
      alert("No ideal letter available to save.")
      return
    }

    const confirmed = confirm("Save this ideal letter as a provider example?")
    if (!confirmed) return

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
          reportType: exampleReportType,
          title: `Training case ideal letter - ${new Date().toLocaleDateString(
            "en-AU"
          )}`,
          exampleText,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to save example.")
        return
      }

      alert("Ideal letter saved as provider example.")

      if (onRulePromoted) {
        await onRulePromoted()
      }
    } finally {
      setLoading(false)
    }
  }

  async function deleteTrainingCase(id: string) {
    const confirmed = confirm("Delete this training case?")
    if (!confirmed) return

    const response = await fetch(
      "/api/report-writing/provider-training-cases/delete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      }
    )

    const data = await response.json()

    if (!data.success) {
      alert(data.error || "Failed to delete training case.")
      return
    }

    await loadCases()
  }

  return (
    <section className="rounded-2xl border bg-white p-5">
      <div>
        <h2 className="text-xl font-bold">AI Training Loop</h2>
        <p className="mt-1 text-sm text-slate-500">
          Paste clinical notes and the ideal provider-approved letter. The AI
          will generate a draft, compare it to the ideal, extract reusable
          provider behaviours, regenerate, and show the best result for approval.
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-purple-200 bg-purple-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-purple-950">Provider Analyzer</h3>
            <p className="mt-1 text-sm text-purple-900">
              Analyse this provider&apos;s rules, examples and training cases to
              find repeated patterns, missing rules, duplicate rules and
              conflicts.
            </p>
          </div>

          <button
            onClick={analyzeProviderTraining}
            disabled={analyzingProvider || loading}
            className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {analyzingProvider ? "Analysing..." : "Analyze Provider Training"}
          </button>
        </div>

        {providerAnalysis ? (
          <div className="mt-4 space-y-4">
            {providerAnalysis.provider_summary ? (
              <div className="rounded-xl bg-white p-3 text-sm">
                <div className="font-semibold text-purple-900">
                  Provider summary
                </div>
                <div className="mt-1 whitespace-pre-wrap">
                  {providerAnalysis.provider_summary}
                </div>
              </div>
            ) : null}

            {providerAnalysis.recommended_rules?.length > 0 ? (
              <div className="rounded-xl bg-white p-3">
                <div className="font-semibold text-purple-900">
                  Recommended rules
                </div>

                <div className="mt-3 space-y-3">
                  {providerAnalysis.recommended_rules.map((rule, index) => (
                    <div
                      key={`${rule.rule_text}-${index}`}
                      className="rounded-xl border p-3"
                    >
                      <div className="text-xs font-semibold uppercase text-slate-500">
                        {rule.report_type} · {rule.confidence} confidence ·
                        supported by {rule.supporting_case_count} case(s)
                      </div>

                      <div className="mt-2 whitespace-pre-wrap text-sm">
                        {rule.rule_text}
                      </div>

                      <div className="mt-2 text-xs text-slate-500">
                        {rule.reason}
                      </div>

                      <button
                        onClick={() => promoteAnalysisRule(rule)}
                        disabled={loading}
                        className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Add Rule
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {providerAnalysis.possible_duplicate_rules?.length > 0 ? (
              <div className="rounded-xl bg-white p-3 text-sm">
                <div className="font-semibold text-amber-800">
                  Possible duplicate rules
                </div>

                <div className="mt-2 space-y-2">
                  {providerAnalysis.possible_duplicate_rules.map(
                    (item, index) => (
                      <div key={index} className="rounded-lg border p-2">
                        <div className="text-xs text-slate-500">
                          Rule IDs: {item.rule_ids.join(", ")}
                        </div>
                        <div className="mt-1">{item.summary}</div>
                      </div>
                    )
                  )}
                </div>
              </div>
            ) : null}

            {providerAnalysis.possible_conflicting_rules?.length > 0 ? (
              <div className="rounded-xl bg-white p-3 text-sm">
                <div className="font-semibold text-red-700">
                  Possible conflicting rules
                </div>

                <div className="mt-2 space-y-2">
                  {providerAnalysis.possible_conflicting_rules.map(
                    (item, index) => (
                      <div key={index} className="rounded-lg border p-2">
                        <div className="text-xs text-slate-500">
                          Rule IDs: {item.rule_ids.join(", ")}
                        </div>
                        <div className="mt-1">{item.summary}</div>
                      </div>
                    )
                  )}
                </div>
              </div>
            ) : null}

            {providerAnalysis.training_observations?.length > 0 ? (
              <div className="rounded-xl bg-white p-3 text-sm">
                <div className="font-semibold text-purple-900">
                  Training observations
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {providerAnalysis.training_observations.map(
                    (item, index) => (
                      <li key={index}>{item}</li>
                    )
                  )}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <select
            className="w-full rounded-xl border p-3"
            value={selectedReportType}
            onChange={(e) => setSelectedReportType(e.target.value)}
          >
            {availableReportTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-xl border p-3"
              placeholder="Patient name"
              value={patientFirstName}
              onChange={(e) => setPatientFirstName(e.target.value)}
            />

            <select
              className="rounded-xl border p-3"
              value={patientGender}
              onChange={(e) => setPatientGender(e.target.value)}
            >
              <option value="neutral">Neutral pronouns</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>

          <input
            className="w-full rounded-xl border p-3"
            placeholder="Referrer name (optional)"
            value={referrerName}
            onChange={(e) => setReferrerName(e.target.value)}
          />

          <textarea
            className="h-60 w-full rounded-xl border p-3"
            placeholder="Paste clinical notes here..."
            value={clinicalNotes}
            onChange={(e) => setClinicalNotes(e.target.value)}
          />

          <textarea
            className="h-60 w-full rounded-xl border p-3"
            placeholder="Paste ideal provider-approved letter here..."
            value={idealLetter}
            onChange={(e) => setIdealLetter(e.target.value)}
          />

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600">
              Attempts:
              <select
                className="ml-2 rounded-xl border p-2"
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
              >
                <option value={1}>1 - compare only</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>

            <button
              onClick={runTrainingLoop}
              disabled={loading}
              className="rounded-xl bg-purple-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Running Training Loop..." : "Run Training Loop"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-bold">How this works</div>
          <div className="mt-2 space-y-2">
            <p>1. The system generates a letter using current provider rules.</p>
            <p>2. It compares the draft to the ideal letter.</p>
            <p>3. It extracts reusable provider behaviours.</p>
            <p>4. It regenerates using those temporary behaviours.</p>
            <p>5. It repeats and shows the best attempt.</p>
            <p>
              Suggested rules are not saved permanently until you approve them.
            </p>
          </div>
        </div>
      </div>

      {lastAttempts.length > 0 ? (
        <div className="mt-8 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold">Latest Training Result</h3>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => promoteRules(lastSuggestedRules)}
                disabled={loading || !lastSuggestedRules.trim()}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Approve Suggested Rules
              </button>

              <button
                onClick={() => saveIdealAsExample()}
                disabled={loading || !idealLetter.trim()}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                Save Ideal as Example
              </button>
            </div>
          </div>

          {lastBestLetter ? (
            <div>
              <div className="mb-2 text-xs font-bold uppercase text-emerald-700">
                Best generated letter
              </div>
              <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-emerald-50 p-3 text-sm">
                {lastBestLetter}
              </div>
            </div>
          ) : null}

          {lastSuggestedRules ? (
            <div>
              <div className="mb-2 text-xs font-bold uppercase text-blue-700">
                Extracted provider behaviours for approval
              </div>
              <div className="whitespace-pre-wrap rounded-xl border bg-blue-50 p-3 text-sm">
                {lastSuggestedRules}
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {lastAttempts.map((attempt) => (
              <div key={attempt.attempt_number} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-bold">
                    Attempt {attempt.attempt_number}
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                    Score: {scoreOutOfTen(attempt.score)}/10 ({attempt.score}
                    /100)
                  </div>
                </div>

                <div className="mt-3 whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-sm">
                  {attempt.generated_letter}
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl bg-green-50 p-3 text-sm">
                    <div className="font-semibold text-green-800">
                      Strengths
                    </div>
                    <ul className="mt-2 list-disc pl-5">
                      {attempt.strengths.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl bg-amber-50 p-3 text-sm">
                    <div className="font-semibold text-amber-800">
                      Missing
                    </div>
                    <ul className="mt-2 list-disc pl-5">
                      {attempt.missing_from_generated.map((item, index) => (
                        <li key={`${item}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl bg-red-50 p-3 text-sm">
                    <div className="font-semibold text-red-800">Remove</div>
                    <ul className="mt-2 list-disc pl-5">
                      {attempt.should_remove_from_generated.map(
                        (item, index) => (
                          <li key={`${item}-${index}`}>{item}</li>
                        )
                      )}
                    </ul>
                  </div>
                </div>

                {attempt.extracted_behaviours?.length ? (
                  <div className="mt-3 rounded-xl bg-purple-50 p-3 text-sm">
                    <div className="font-semibold text-purple-900">
                      Extracted behaviours
                    </div>
                    <div className="mt-2 space-y-2">
                      {attempt.extracted_behaviours.map((item, index) => (
                        <div key={index} className="rounded-lg border bg-white p-2">
                          <div className="text-xs font-semibold uppercase text-slate-500">
                            {item.category} · {item.confidence}
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            Difference: {item.difference}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap font-medium">
                            {item.provider_behaviour_rule}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {item.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {attempt.suggested_rule ? (
                  <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm">
                    <div className="font-semibold text-blue-800">
                      Suggested rule
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">
                      {attempt.suggested_rule}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-8 space-y-4">
        <h3 className="text-lg font-bold">Saved Training Cases</h3>

        {cases.length === 0 ? (
          <div className="rounded-xl border border-dashed p-5 text-sm text-slate-500">
            No training cases saved yet.
          </div>
        ) : null}

        {cases.map((trainingCase) => {
          const expanded = expandedId === trainingCase.id
          const attempts = trainingCase.training_attempts || []

          return (
            <div key={trainingCase.id} className="rounded-2xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    {trainingCase.report_type}
                  </div>

                  <div className="mt-1 text-xs text-slate-500">
                    {trainingCase.created_at
                      ? new Date(trainingCase.created_at).toLocaleString(
                          "en-AU"
                        )
                      : ""}
                  </div>

                  <div className="mt-1 text-sm text-slate-600">
                    Best score: {" "}
                    {attempts.length > 0
                      ? `${scoreOutOfTen(
                          Math.max(...attempts.map((item) => item.score))
                        )}/10`
                      : "Not scored"}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      setExpandedId(expanded ? null : trainingCase.id)
                    }
                    className="rounded-lg border px-3 py-2 text-xs font-semibold"
                  >
                    {expanded ? "Collapse" : "Review"}
                  </button>

                  <button
                    onClick={() =>
                      promoteRules(
                        trainingCase.approved_rule_text ||
                          trainingCase.suggested_rule_text ||
                          "",
                        trainingCase.report_type
                      )
                    }
                    disabled={
                      loading ||
                      !(
                        trainingCase.approved_rule_text ||
                        trainingCase.suggested_rule_text
                      )
                    }
                    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Promote Rule
                  </button>

                  <button
                    onClick={() => saveIdealAsExample(trainingCase)}
                    disabled={loading}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Save as Example
                  </button>

                  <button
                    onClick={() => deleteTrainingCase(trainingCase.id)}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {expanded ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div>
                      <div className="mb-2 text-xs font-bold uppercase text-slate-500">
                        Clinical notes
                      </div>
                      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-sm">
                        {trainingCase.clinical_notes}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-bold uppercase text-emerald-700">
                        Ideal letter
                      </div>
                      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-emerald-50 p-3 text-sm">
                        {trainingCase.final_letter}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-bold uppercase text-blue-700">
                        Best generated letter
                      </div>
                      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-blue-50 p-3 text-sm">
                        {trainingCase.best_generated_letter ||
                          trainingCase.ai_draft ||
                          "No generated letter saved."}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-bold uppercase text-blue-700">
                      Suggested rules
                    </div>
                    <div className="whitespace-pre-wrap rounded-xl border bg-blue-50 p-3 text-sm">
                      {trainingCase.approved_rule_text ||
                        trainingCase.suggested_rule_text ||
                        "No suggested rules saved."}
                    </div>
                  </div>

                  {attempts.length > 0 ? (
                    <div className="space-y-3">
                      <div className="text-sm font-bold">Attempts</div>
                      {attempts.map((attempt) => (
                        <div
                          key={attempt.attempt_number}
                          className="rounded-xl border p-3 text-sm"
                        >
                          <div className="font-semibold">
                            Attempt {attempt.attempt_number} · Score {" "}
                            {scoreOutOfTen(attempt.score)}/10 ({attempt.score}
                            /100)
                          </div>
                          <div className="mt-2 whitespace-pre-wrap">
                            {truncate(attempt.generated_letter, 800)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="text-xs font-semibold text-slate-500">
                      Clinical notes
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">
                      {truncate(trainingCase.clinical_notes)}
                    </div>
                  </div>

                  <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                    <div className="text-xs font-semibold text-slate-500">
                      Ideal letter
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">
                      {truncate(trainingCase.final_letter)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
