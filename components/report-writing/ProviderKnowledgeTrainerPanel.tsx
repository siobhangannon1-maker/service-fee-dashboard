"use client"

import { useEffect, useMemo, useState } from "react"

type ReportTypeOption = { value: string; label: string }

type KnowledgeItem = {
  id: string
  report_type: string
  knowledge_type: string
  category: string
  knowledge_text: string
  evidence_summary: string | null
  confidence: number
  evidence_count: number
  status: string
  updated_at: string
}

type TrainingAnalysis = {
  match_score: number
  summary: string
  generated_strengths: string[]
  important_differences: string[]
  knowledge_items: Array<{
    knowledge_type: string
    report_type: string
    category: string
    knowledge_text: string
    evidence_summary: string
    confidence: number
    applies_to_future_letters: boolean
  }>
}

type Props = {
  providerId: string
  reportType: string
  availableReportTypes: ReportTypeOption[]
  onTrainingChanged?: () => Promise<void> | void
}

function displayScore(score: number | null | undefined) {
  const raw = Number(score || 0)
  const percent = raw <= 1 ? raw * 100 : raw <= 10 ? raw * 10 : raw
  return `${(percent / 10).toFixed(1)}/10`
}

function displayConfidence(value: number | null | undefined) {
  const raw = Number(value || 0)
  const percent = raw <= 1 ? raw * 100 : raw
  return `${Math.round(percent)}%`
}

function truncate(text: string, max = 350) {
  if (!text) return ""
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function labelForKnowledgeType(type: string) {
  const labels: Record<string, string> = {
    manual_rule: "Manual Rules",
    behaviour: "Learnt Behaviours",
    preferred_phrase: "Preferred Phrases",
    template_block: "Template Blocks",
    terminology: "Terminology",
    other: "Other Knowledge",
  }
  return labels[type] || type.replace(/_/g, " ")
}

export default function ProviderKnowledgeTrainerPanel({
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
  const [regeneratePreview, setRegeneratePreview] = useState(true)

  const [loading, setLoading] = useState(false)
  const [knowledgeLoading, setKnowledgeLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [activeTab, setActiveTab] = useState("all")

  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([])
  const [analysis, setAnalysis] = useState<TrainingAnalysis | null>(null)
  const [generatedLetter, setGeneratedLetter] = useState("")
  const [regeneratedLetter, setRegeneratedLetter] = useState("")
  const [savedKnowledgeCount, setSavedKnowledgeCount] = useState(0)
  const [reinforcedKnowledgeCount, setReinforcedKnowledgeCount] = useState(0)
  const [exampleSaved, setExampleSaved] = useState(false)

  const [manualRuleText, setManualRuleText] = useState("")
  const [manualKnowledgeType, setManualKnowledgeType] = useState("manual_rule")
  const [manualCategory, setManualCategory] = useState("manual_rule")

  useEffect(() => setSelectedReportType(reportType), [reportType])

  async function loadKnowledge() {
    if (!providerId) return
    setKnowledgeLoading(true)
    try {
      const params = new URLSearchParams({ providerId, reportType: selectedReportType })
      const response = await fetch(`/api/report-writing/provider-knowledge?${params.toString()}`)
      const data = await response.json()
      if (data.success) setKnowledge(data.knowledge || [])
    } finally {
      setKnowledgeLoading(false)
    }
  }

  useEffect(() => {
    loadKnowledge()
  }, [providerId, selectedReportType])

  const knowledgeSummary = useMemo(() => {
    return knowledge.reduce((acc: Record<string, number>, item) => {
      acc[item.knowledge_type] = (acc[item.knowledge_type] || 0) + 1
      return acc
    }, {})
  }, [knowledge])

  const filteredKnowledge = useMemo(() => {
    if (activeTab === "all") return knowledge
    return knowledge.filter((item) => item.knowledge_type === activeTab)
  }, [knowledge, activeTab])

  async function trainProvider() {
    if (!providerId) return alert("Select a provider first.")
    if (!patientFirstName.trim()) return alert("Enter the patient first name.")
    if (!clinicalNotes.trim()) return alert("Paste the clinical notes.")
    if (!idealLetter.trim()) return alert("Paste the provider-approved ideal letter.")

    setLoading(true)
    setAnalysis(null)
    setGeneratedLetter("")
    setRegeneratedLetter("")
    setSavedKnowledgeCount(0)
    setReinforcedKnowledgeCount(0)
    setExampleSaved(false)

    try {
      const response = await fetch("/api/report-writing/provider-training-cases/train-provider-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          reportType: selectedReportType,
          patientFirstName,
          patientGender,
          referrerName,
          clinicalNotes,
          idealLetter,
          regeneratePreview,
        }),
      })
      const data = await response.json()
      if (!data.success) return alert(data.error || "Provider knowledge training failed.")

      setAnalysis(data.analysis || null)
      setGeneratedLetter(data.generatedLetter || "")
      setRegeneratedLetter(data.regeneratedLetter || "")
      setSavedKnowledgeCount((data.savedKnowledge || []).length)
      setReinforcedKnowledgeCount((data.reinforcedKnowledge || []).length)
      setExampleSaved(Boolean(data.savedExample))
      await loadKnowledge()
      if (onTrainingChanged) await onTrainingChanged()
    } finally {
      setLoading(false)
    }
  }

  async function addManualKnowledge() {
    if (!manualRuleText.trim()) return alert("Enter knowledge text first.")
    setLoading(true)
    try {
      const response = await fetch("/api/report-writing/provider-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          reportType: selectedReportType,
          knowledgeType: manualKnowledgeType,
          category: manualCategory,
          knowledgeText: manualRuleText,
          confidence: 100,
          source: "manual",
        }),
      })
      const data = await response.json()
      if (!data.success) return alert(data.error || "Failed to add knowledge.")
      setManualRuleText("")
      await loadKnowledge()
      if (onTrainingChanged) await onTrainingChanged()
    } finally {
      setLoading(false)
    }
  }

  async function archiveKnowledge(id: string) {
    if (!confirm("Archive this knowledge item?")) return
    const response = await fetch("/api/report-writing/provider-knowledge/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    const data = await response.json()
    if (!data.success) return alert(data.error || "Failed to archive knowledge.")
    await loadKnowledge()
  }

  return (
    <section className="rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Improve Provider Knowledge</h2>
          <p className="mt-1 text-sm text-slate-500">
            Staff paste clinical notes and the provider-approved ideal letter. DocuDental learns behaviours, preferred phrases and template blocks automatically.
          </p>
        </div>
        <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="rounded-xl border px-4 py-2 text-sm font-semibold">
          {showAdvanced ? "Hide Advanced" : "Show Advanced"}
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <select className="w-full rounded-xl border p-3" value={selectedReportType} onChange={(e) => setSelectedReportType(e.target.value)}>
            {availableReportTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>

          <div className="grid gap-3 md:grid-cols-2">
            <input className="rounded-xl border p-3" placeholder="Patient name" value={patientFirstName} onChange={(e) => setPatientFirstName(e.target.value)} />
            <select className="rounded-xl border p-3" value={patientGender} onChange={(e) => setPatientGender(e.target.value)}>
              <option value="neutral">Neutral pronouns</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>

          <input className="w-full rounded-xl border p-3" placeholder="Referrer name (optional)" value={referrerName} onChange={(e) => setReferrerName(e.target.value)} />
          <textarea className="h-64 w-full rounded-xl border p-3" placeholder="Paste clinical notes here..." value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} />
          <textarea className="h-64 w-full rounded-xl border p-3" placeholder="Paste provider-approved ideal letter here..." value={idealLetter} onChange={(e) => setIdealLetter(e.target.value)} />

          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={regeneratePreview} onChange={(e) => setRegeneratePreview(e.target.checked)} />
            Generate preview after learning
          </label>

          <button onClick={trainProvider} disabled={loading} className="rounded-xl bg-purple-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {loading ? "Improving Provider Knowledge..." : "Improve Provider Knowledge"}
          </button>
        </div>

        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-950">
          <div className="font-bold">Simple staff workflow</div>
          <div className="mt-2 space-y-2">
            <p>1. Select provider and report type.</p>
            <p>2. Paste clinical notes.</p>
            <p>3. Paste the ideal provider-approved letter.</p>
            <p>4. Click Improve Provider Knowledge.</p>
            <p>The ideal example and learnt knowledge are saved automatically.</p>
          </div>
          <div className="mt-4 rounded-xl bg-white p-3">
            <div className="font-semibold">Knowledge summary</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>Manual rules: {knowledgeSummary.manual_rule || 0}</div>
              <div>Behaviours: {knowledgeSummary.behaviour || 0}</div>
              <div>Phrases: {knowledgeSummary.preferred_phrase || 0}</div>
              <div>Blocks: {knowledgeSummary.template_block || 0}</div>
            </div>
          </div>
        </div>
      </div>

      {analysis ? (
        <div className="mt-8 space-y-5">
          <div className="rounded-2xl border bg-emerald-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-emerald-950">Provider Knowledge Updated</h3>
                <p className="mt-1 text-sm text-emerald-900">{analysis.summary}</p>
              </div>
              <div className="rounded-full bg-white px-4 py-2 text-sm font-bold text-emerald-900">Match: {displayScore(analysis.match_score)}</div>
            </div>
            <div className="mt-3 text-sm text-emerald-900">
              Example saved: <span className="font-bold">{exampleSaved ? "yes" : "no"}</span> · New knowledge: <span className="font-bold">{savedKnowledgeCount}</span> · Reinforced: <span className="font-bold">{reinforcedKnowledgeCount}</span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-bold uppercase text-slate-500">Original AI draft</div>
              <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-sm">{generatedLetter}</div>
            </div>
            <div>
              <div className="mb-2 text-xs font-bold uppercase text-emerald-700">Preview after learning</div>
              <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-emerald-50 p-3 text-sm">{regeneratedLetter || "Preview not generated."}</div>
            </div>
          </div>

          {showAdvanced ? (
            <div className="rounded-xl border bg-white p-4">
              <h3 className="font-bold">Knowledge extracted this run</h3>
              <div className="mt-3 space-y-3">
                {(analysis.knowledge_items || []).map((item, index) => (
                  <div key={`${item.knowledge_text}-${index}`} className="rounded-xl border p-3 text-sm">
                    <div className="text-xs font-semibold uppercase text-slate-500">
                      {item.report_type} · {item.knowledge_type} · {item.category} · confidence {displayConfidence(item.confidence)}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap font-medium">{item.knowledge_text}</div>
                    <div className="mt-1 text-slate-500">{item.evidence_summary}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showAdvanced ? (
        <div className="mt-8 space-y-5 rounded-2xl border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-bold">Advanced Provider Knowledge</h3>
            <button onClick={loadKnowledge} disabled={knowledgeLoading} className="rounded-xl border px-3 py-2 text-sm font-semibold">
              {knowledgeLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="rounded-xl border bg-slate-50 p-4">
            <h4 className="font-bold">Add manual knowledge</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <select className="rounded-xl border p-3" value={manualKnowledgeType} onChange={(e) => setManualKnowledgeType(e.target.value)}>
                <option value="manual_rule">Manual rule</option>
                <option value="behaviour">Behaviour</option>
                <option value="preferred_phrase">Preferred phrase</option>
                <option value="template_block">Template block</option>
              </select>
              <input className="rounded-xl border p-3" placeholder="Category, e.g. closing" value={manualCategory} onChange={(e) => setManualCategory(e.target.value)} />
              <button onClick={addManualKnowledge} disabled={loading} className="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Add</button>
            </div>
            <textarea className="mt-3 h-28 w-full rounded-xl border p-3" placeholder="Manual rule, preferred phrase or template block..." value={manualRuleText} onChange={(e) => setManualRuleText(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2">
            {["all", "manual_rule", "behaviour", "preferred_phrase", "template_block"].map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`rounded-full px-3 py-2 text-xs font-semibold ${activeTab === tab ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>
                {tab === "all" ? "All" : labelForKnowledgeType(tab)}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredKnowledge.length === 0 ? <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No active knowledge items.</div> : null}
            {filteredKnowledge.map((item) => (
              <div key={item.id} className="rounded-xl border p-3 text-sm">
                <div className="text-xs font-semibold uppercase text-slate-500">
                  {item.report_type} · {item.knowledge_type} · {item.category} · confidence {displayConfidence(item.confidence)} · seen {item.evidence_count}
                </div>
                <div className="mt-2 whitespace-pre-wrap">{item.knowledge_text}</div>
                {item.evidence_summary ? <div className="mt-1 text-xs text-slate-500">{truncate(item.evidence_summary)}</div> : null}
                <button onClick={() => archiveKnowledge(item.id)} className="mt-2 text-xs font-semibold text-red-600">Archive</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
