"use client"

import { useEffect, useState } from "react"

type ReportTypeOption = {
  value: string
  label: string
}

type ProviderBehaviour = {
  id: string
  report_type: string
  category: string
  behaviour_text: string
  reason: string | null
  confidence: string
  evidence_count: number
  is_active: boolean
  created_at: string
  updated_at: string
}

type LearntBehaviour = {
  report_type: string
  category: string
  behaviour_text: string
  reason: string
  confidence: "high" | "medium" | "low"
  evidence_quote: string
}

type Props = {
  providerId: string
  reportType: string
  availableReportTypes: ReportTypeOption[]
  onTrainingChanged?: () => Promise<void> | void
}

function truncate(text: string, maxLength = 500) {
  if (!text) return ""
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

export default function ProviderBehaviourTrainerPanel({
  providerId,
  reportType,
  availableReportTypes,
  onTrainingChanged,
}: Props) {
  const [selectedReportType, setSelectedReportType] = useState(reportType)
  const [patientFirstName, setPatientFirstName] = useState("")
  const [patientGender, setPatientGender] = useState("neutral")
  const [referrerName, setReferrerName] = useState("")
  const [clinicalNotes, setClinicalNotes] = useState("")
  const [idealLetter, setIdealLetter] = useState("")

  const [behaviours, setBehaviours] = useState<ProviderBehaviour[]>([])
  const [learntBehaviours, setLearntBehaviours] = useState<LearntBehaviour[]>([])
  const [baselineLetter, setBaselineLetter] = useState("")
  const [behaviourTrainedLetter, setBehaviourTrainedLetter] = useState("")
  const [comparisonScore, setComparisonScore] = useState<number | null>(null)
  const [comparisonSummary, setComparisonSummary] = useState("")

  const [expandedBehaviourId, setExpandedBehaviourId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadBehaviours() {
    if (!providerId) return

    const response = await fetch(
      `/api/report-writing/provider-behaviours?providerId=${providerId}`
    )
    const data = await response.json()

    if (data.success) {
      setBehaviours(data.behaviours || [])
    }
  }

  useEffect(() => {
    setSelectedReportType(reportType)
  }, [reportType])

  useEffect(() => {
    loadBehaviours()
  }, [providerId])

  async function trainProviderBehaviours() {
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
    setLearntBehaviours([])
    setBaselineLetter("")
    setBehaviourTrainedLetter("")
    setComparisonScore(null)
    setComparisonSummary("")

    try {
      const response = await fetch(
        "/api/report-writing/provider-training-cases/train-provider-behaviours",
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
          }),
        }
      )

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Provider behaviour training failed.")
        return
      }

      setLearntBehaviours(data.learntBehaviours || [])
      setBaselineLetter(data.baselineLetter || "")
      setBehaviourTrainedLetter(data.behaviourTrainedLetter || "")
      setComparisonScore(
        typeof data.comparisonScore === "number" ? data.comparisonScore : null
      )
      setComparisonSummary(data.comparisonSummary || "")

      await loadBehaviours()

      if (onTrainingChanged) {
        await onTrainingChanged()
      }
    } finally {
      setLoading(false)
    }
  }

  async function toggleBehaviour(behaviour: ProviderBehaviour) {
    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/provider-behaviours", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: behaviour.id,
          isActive: !behaviour.is_active,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to update behaviour.")
        return
      }

      await loadBehaviours()

      if (onTrainingChanged) {
        await onTrainingChanged()
      }
    } finally {
      setLoading(false)
    }
  }

  async function deleteBehaviour(id: string) {
    const confirmed = confirm("Delete this learnt provider behaviour?")
    if (!confirmed) return

    setLoading(true)

    try {
      const response = await fetch("/api/report-writing/provider-behaviours/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      })

      const data = await response.json()

      if (!data.success) {
        alert(data.error || "Failed to delete behaviour.")
        return
      }

      await loadBehaviours()

      if (onTrainingChanged) {
        await onTrainingChanged()
      }
    } finally {
      setLoading(false)
    }
  }

  const activeBehaviours = behaviours.filter((item) => item.is_active)
  const inactiveBehaviours = behaviours.filter((item) => !item.is_active)

  return (
    <section className="rounded-2xl border bg-white p-5">
      <div>
        <h2 className="text-xl font-bold">Provider Behaviour Trainer</h2>
        <p className="mt-1 text-sm text-slate-500">
          Paste clinical notes and an ideal provider-approved letter. The system
          generates a baseline draft, compares it with the ideal, extracts reusable
          provider behaviours, saves them, then regenerates once using the newly
          learnt behaviours.
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <select
            className="w-full rounded-xl border p-3"
            value={selectedReportType}
            onChange={(event) => setSelectedReportType(event.target.value)}
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
              onChange={(event) => setPatientFirstName(event.target.value)}
            />

            <select
              className="rounded-xl border p-3"
              value={patientGender}
              onChange={(event) => setPatientGender(event.target.value)}
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
            onChange={(event) => setReferrerName(event.target.value)}
          />

          <textarea
            className="h-56 w-full rounded-xl border p-3"
            placeholder="Paste clinical notes here..."
            value={clinicalNotes}
            onChange={(event) => setClinicalNotes(event.target.value)}
          />

          <textarea
            className="h-56 w-full rounded-xl border p-3"
            placeholder="Paste ideal provider-approved letter here..."
            value={idealLetter}
            onChange={(event) => setIdealLetter(event.target.value)}
          />

          <button
            onClick={trainProviderBehaviours}
            disabled={loading}
            className="rounded-xl bg-purple-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Training Provider..." : "Train Provider Behaviours"}
          </button>
        </div>

        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-950">
          <div className="font-bold">What this does</div>
          <div className="mt-2 space-y-2">
            <p>1. Generates a baseline letter using current training.</p>
            <p>2. Compares the baseline to the ideal provider letter.</p>
            <p>3. Extracts reusable provider behaviours.</p>
            <p>4. Saves those behaviours as active provider training.</p>
            <p>5. Regenerates once using the newly learnt behaviours.</p>
          </div>

          <div className="mt-4 rounded-xl bg-white p-3 text-xs text-slate-600">
            This is designed to replace manual rule-writing over time. You can
            deactivate or delete learnt behaviours below if one is not helpful.
          </div>
        </div>
      </div>

      {learntBehaviours.length > 0 || baselineLetter || behaviourTrainedLetter ? (
        <div className="mt-8 space-y-5">
          <h3 className="text-lg font-bold">Latest Training Result</h3>

          {comparisonScore !== null ? (
            <div className="rounded-xl border bg-slate-50 p-3 text-sm">
              <div className="font-semibold">Baseline comparison</div>
              <div className="mt-1">
                Score: {(comparisonScore / 10).toFixed(1)}/10 ({comparisonScore}/100)
              </div>
              {comparisonSummary ? (
                <div className="mt-1 text-slate-600">{comparisonSummary}</div>
              ) : null}
            </div>
          ) : null}

          {learntBehaviours.length > 0 ? (
            <div className="rounded-xl border bg-blue-50 p-4">
              <div className="font-semibold text-blue-900">
                Learnt provider behaviours from this case
              </div>
              <div className="mt-3 space-y-3">
                {learntBehaviours.map((behaviour, index) => (
                  <div key={index} className="rounded-xl border bg-white p-3 text-sm">
                    <div className="text-xs font-semibold uppercase text-slate-500">
                      {behaviour.report_type} · {behaviour.category} · {behaviour.confidence} confidence
                    </div>
                    <div className="mt-2 whitespace-pre-wrap">
                      {behaviour.behaviour_text}
                    </div>
                    {behaviour.reason ? (
                      <div className="mt-2 text-xs text-slate-500">
                        {behaviour.reason}
                      </div>
                    ) : null}
                    {behaviour.evidence_quote ? (
                      <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                        Evidence: {behaviour.evidence_quote}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-bold uppercase text-slate-500">
                Baseline generated letter
              </div>
              <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-sm">
                {baselineLetter || "No baseline letter generated."}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold uppercase text-emerald-700">
                Regenerated with learnt behaviours
              </div>
              <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-emerald-50 p-3 text-sm">
                {behaviourTrainedLetter || "No behaviour-trained letter generated."}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold">Active Provider Behaviours</h3>
          <button
            onClick={loadBehaviours}
            disabled={loading}
            className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {activeBehaviours.length === 0 ? (
          <div className="rounded-xl border border-dashed p-5 text-sm text-slate-500">
            No active learnt behaviours yet.
          </div>
        ) : null}

        {activeBehaviours.map((behaviour) => {
          const expanded = expandedBehaviourId === behaviour.id

          return (
            <div key={behaviour.id} className="rounded-2xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    {behaviour.report_type} · {behaviour.category} · {behaviour.confidence} confidence · seen {behaviour.evidence_count} time(s)
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm">
                    {expanded
                      ? behaviour.behaviour_text
                      : truncate(behaviour.behaviour_text, 260)}
                  </div>
                  {expanded && behaviour.reason ? (
                    <div className="mt-2 text-xs text-slate-500">
                      {behaviour.reason}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      setExpandedBehaviourId(expanded ? null : behaviour.id)
                    }
                    className="rounded-lg border px-3 py-2 text-xs font-semibold"
                  >
                    {expanded ? "Collapse" : "Review"}
                  </button>

                  <button
                    onClick={() => toggleBehaviour(behaviour)}
                    disabled={loading}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Deactivate
                  </button>

                  <button
                    onClick={() => deleteBehaviour(behaviour.id)}
                    disabled={loading}
                    className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {inactiveBehaviours.length > 0 ? (
          <div className="mt-8 space-y-3">
            <h3 className="text-lg font-bold">Inactive Behaviours</h3>
            {inactiveBehaviours.map((behaviour) => (
              <div key={behaviour.id} className="rounded-2xl border bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {behaviour.report_type} · {behaviour.category}
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                  {truncate(behaviour.behaviour_text, 260)}
                </div>
                <button
                  onClick={() => toggleBehaviour(behaviour)}
                  disabled={loading}
                  className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Reactivate
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
