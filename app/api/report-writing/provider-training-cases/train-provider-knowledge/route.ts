import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing Supabase environment variables.")
  return createClient(url, key)
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.trim().replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim()
    return JSON.parse(cleaned) as T
  } catch {
    return fallback
  }
}

function makeKnowledgeKey(reportType: string, knowledgeType: string, category: string, text: string) {
  return `${reportType}_${knowledgeType}_${category}_${text}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 150)
}

async function generateLetter(origin: string, payload: Record<string, unknown>) {
  const response = await fetch(`${origin}/api/report-writing/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  const data = await response.json()
  if (!data.success) throw new Error(data.error || "Letter generation failed.")
  return clean(data.report)
}

type KnowledgeSuggestion = {
  knowledge_type: "behaviour" | "preferred_phrase" | "template_block" | "manual_rule" | "other"
  report_type: string
  category: string
  knowledge_text: string
  evidence_summary: string
  confidence: number
  applies_to_future_letters: boolean
}

type Analysis = {
  match_score: number
  summary: string
  generated_strengths: string[]
  important_differences: string[]
  knowledge_items: KnowledgeSuggestion[]
}

async function getExistingKnowledgeText(supabase: ReturnType<typeof getSupabase>, providerId: string, reportType: string) {
  const { data } = await supabase
    .from("provider_knowledge")
    .select("report_type, knowledge_type, category, knowledge_text, confidence, evidence_count")
    .eq("provider_id", providerId)
    .eq("status", "active")
    .in("report_type", [reportType, "all"])
    .order("confidence", { ascending: false })
    .limit(100)

  return (data || [])
    .map(
      (item: any, index: number) =>
        `${index + 1}. [${item.knowledge_type} / ${item.report_type} / ${item.category} / confidence ${item.confidence} / seen ${item.evidence_count}] ${item.knowledge_text}`
    )
    .join("\n")
}

function formatKnowledgeForPrompt(items: KnowledgeSuggestion[]) {
  const active = items.filter((item) => item.applies_to_future_letters && item.knowledge_text)
  if (active.length === 0) return ""

  return active
    .map((item, index) => `${index + 1}. [${item.knowledge_type} / ${item.category}] ${item.knowledge_text}`)
    .join("\n")
}

async function extractKnowledge(input: {
  reportType: string
  patientFirstName: string
  clinicalNotes: string
  generatedLetter: string
  idealLetter: string
  existingKnowledgeText: string
}) {
  const fallback: Analysis = {
    match_score: 0,
    summary: "Could not analyse training case.",
    generated_strengths: [],
    important_differences: [],
    knowledge_items: [],
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a dental provider knowledge trainer. You compare clinical notes, AI drafts and ideal letters, then extract reusable provider knowledge. Return JSON only.",
      },
      {
        role: "user",
        content: `
Analyse this provider training case.

Extract reusable provider knowledge from the difference between the generated letter and the ideal provider-approved letter.

There are three main useful knowledge types:
1. behaviour: a general reusable provider preference, e.g. mention unchanged medical history in SPT opening when documented.
2. preferred_phrase: an exact or near-exact phrase the provider commonly uses, e.g. "I am happy to report that overall, her periodontal status is stable."
3. template_block: a reusable paragraph or section structure, e.g. a preferred SPT closing paragraph.

Only extract knowledge that should apply to future letters.
Do not extract patient-specific clinical facts as provider knowledge.
Do not invent facts.
If the generated letter includes unwanted procedural details that are absent from the ideal, extract a content_exclusion behaviour.
If the ideal uses a distinctive sentence or paragraph, extract it as a preferred_phrase or template_block.

Return JSON only with this exact shape:
{
  "match_score": number,
  "summary": "short summary",
  "generated_strengths": ["..."],
  "important_differences": ["..."],
  "knowledge_items": [
    {
      "knowledge_type": "behaviour|preferred_phrase|template_block|other",
      "report_type": "${input.reportType} or all",
      "category": "opening|structure|content_inclusion|content_exclusion|wording|closing|referrer_communication|clinical_reasoning|formatting|treatment_summary",
      "knowledge_text": "reusable provider knowledge",
      "evidence_summary": "why this is supported by the ideal letter",
      "confidence": number,
      "applies_to_future_letters": true
    }
  ]
}

Important patient name rule:
The patient first name is "${input.patientFirstName}". Using the surname instead of first name is a significant error.

Existing active provider knowledge:
${input.existingKnowledgeText || "No existing knowledge."}

Report type:
${input.reportType}

Clinical notes:
${input.clinicalNotes}

Generated letter:
${input.generatedLetter}

Ideal provider-approved letter:
${input.idealLetter}
`,
      },
    ],
  })

  return safeJsonParse(completion.choices[0]?.message?.content || "", fallback)
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY.")

    const supabase = getSupabase()
    const origin = new URL(req.url).origin
    const body = await req.json()

    const providerId = clean(body.providerId)
    const reportType = clean(body.reportType) || "consultation_report"
    const patientFirstName = clean(body.patientFirstName)
    const patientGender = clean(body.patientGender) || "neutral"
    const referrerName = clean(body.referrerName)
    const clinicalNotes = clean(body.clinicalNotes)
    const idealLetter = clean(body.idealLetter)
    const regeneratePreview = Boolean(body.regeneratePreview ?? true)

    if (!providerId || !patientFirstName || !clinicalNotes || !idealLetter) {
      return NextResponse.json(
        { success: false, error: "Provider, patient first name, clinical notes and ideal letter are required." },
        { status: 400 }
      )
    }

    const existingKnowledgeText = await getExistingKnowledgeText(supabase, providerId, reportType)

    const generatedLetter = await generateLetter(origin, {
      providerId,
      reportType,
      patientName: patientFirstName,
      patientFirstName,
      patientGender,
      referrerName,
      clinicalNotes,
    })

    const analysis = await extractKnowledge({
      reportType,
      patientFirstName,
      clinicalNotes,
      generatedLetter,
      idealLetter,
      existingKnowledgeText,
    })

    const knowledgeItems = (analysis.knowledge_items || []).filter(
      (item) => item.knowledge_text && item.applies_to_future_letters
    )

    const savedKnowledge: any[] = []
    const reinforcedKnowledge: any[] = []

    for (const item of knowledgeItems) {
      const safeReportType = clean(item.report_type) || reportType
      const knowledgeType = clean(item.knowledge_type) || "behaviour"
      const category = clean(item.category) || "general"
      const knowledgeText = clean(item.knowledge_text)
      const evidenceSummary = clean(item.evidence_summary)
      const confidence = Math.max(1, Math.min(100, Number(item.confidence || 70)))
      const knowledgeKey = makeKnowledgeKey(safeReportType, knowledgeType, category, knowledgeText)

      const existing = await supabase
        .from("provider_knowledge")
        .select("id, confidence, evidence_count")
        .eq("provider_id", providerId)
        .eq("report_type", safeReportType)
        .eq("knowledge_type", knowledgeType)
        .eq("knowledge_key", knowledgeKey)
        .maybeSingle()

      if (existing.data) {
        const updatedConfidence = Math.min(100, Math.max(Number(existing.data.confidence || 50), confidence) + 1)
        const updatedEvidenceCount = Number(existing.data.evidence_count || 1) + 1

        const { data, error } = await supabase
          .from("provider_knowledge")
          .update({
            confidence: updatedConfidence,
            evidence_count: updatedEvidenceCount,
            evidence_summary: evidenceSummary || null,
            status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.data.id)
          .select()
          .maybeSingle()

        if (error) throw new Error(error.message)
        reinforcedKnowledge.push(data)
      } else {
        const { data, error } = await supabase
          .from("provider_knowledge")
          .insert({
            provider_id: providerId,
            report_type: safeReportType,
            knowledge_type: knowledgeType,
            category,
            knowledge_key: knowledgeKey,
            knowledge_text: knowledgeText,
            evidence_summary: evidenceSummary || null,
            source: "training_case",
            confidence,
            evidence_count: 1,
            status: confidence >= 65 ? "active" : "needs_review",
          })
          .select()
          .maybeSingle()

        if (error) throw new Error(error.message)
        savedKnowledge.push(data)
      }
    }

    let regeneratedLetter = ""
    if (regeneratePreview && knowledgeItems.length > 0) {
      regeneratedLetter = await generateLetter(origin, {
        providerId,
        reportType,
        patientName: patientFirstName,
        patientFirstName,
        patientGender,
        referrerName,
        clinicalNotes,
        temporaryRulesText: formatKnowledgeForPrompt(knowledgeItems),
      })
    }

    const { data: example } = await supabase
      .from("provider_report_examples")
      .insert({
        provider_id: providerId,
        report_type: reportType,
        title: `Ideal ${reportType} - ${new Date().toLocaleDateString("en-AU")}`,
        example_text: idealLetter,
      })
      .select()
      .maybeSingle()

    const { data: trainingCase, error: trainingCaseError } = await supabase
      .from("provider_training_cases")
      .insert({
        provider_id: providerId,
        report_type: reportType,
        patient_name: patientFirstName,
        patient_first_name: patientFirstName,
        patient_gender: patientGender,
        referrer_name: referrerName || null,
        clinical_notes: clinicalNotes,
        ai_draft: generatedLetter,
        generated_letter: generatedLetter,
        best_generated_letter: regeneratedLetter || generatedLetter,
        final_letter: idealLetter,
        behaviour_analysis: analysis,
        behaviours_learned: savedKnowledge,
        behaviours_reinforced: reinforcedKnowledge,
        v4_knowledge_items: knowledgeItems,
        match_score: Number(analysis.match_score || 0),
        status: "v4_knowledge_trained",
      })
      .select()
      .maybeSingle()

    if (trainingCaseError) throw new Error(trainingCaseError.message)

    return NextResponse.json({
      success: true,
      trainingCase,
      savedExample: example || null,
      generatedLetter,
      regeneratedLetter,
      analysis,
      savedKnowledge,
      reinforcedKnowledge,
      knowledgeCount: knowledgeItems.length,
    })
  } catch (error) {
    console.error("Train provider knowledge V4 failed:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Provider knowledge training failed." },
      { status: 500 }
    )
  }
}
