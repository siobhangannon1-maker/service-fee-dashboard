import { NextResponse } from "next/server"
import OpenAI from "openai"
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables.")
  }

  return createClient(url, key)
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    const cleaned = text
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim()

    return JSON.parse(cleaned) as T
  } catch {
    return fallback
  }
}

function makeBehaviourKey(reportType: string, behaviourText: string) {
  return crypto
    .createHash("sha256")
    .update(`${reportType}:${behaviourText.toLowerCase().replace(/\s+/g, " ").trim()}`)
    .digest("hex")
    .slice(0, 24)
}

async function generateLetter(origin: string, payload: Record<string, unknown>) {
  const response = await fetch(`${origin}/api/report-writing/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  const data = await response.json()

  if (!data.success) {
    throw new Error(data.error || "Letter generation failed.")
  }

  return clean(data.report)
}

type LearntBehaviour = {
  report_type: string
  category: string
  behaviour_text: string
  reason: string
  confidence: "high" | "medium" | "low"
  evidence_quote: string
}

async function extractBehaviours(params: {
  reportType: string
  patientFirstName: string
  clinicalNotes: string
  generatedLetter: string
  idealLetter: string
}) {
  const fallback: {
    score: number
    comparison_summary: string
    behaviours: LearntBehaviour[]
  } = {
    score: 0,
    comparison_summary: "Could not analyse training case.",
    behaviours: [],
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You analyse provider-approved dental letters and extract reusable provider writing behaviours. Return JSON only.",
      },
      {
        role: "user",
        content: `
Compare the AI-generated dental letter to the provider-approved ideal letter.

Your job is NOT to create one-off corrections.
Your job is to extract reusable provider behaviours that will improve future letters for this provider.

Rules:
- Only create behaviours supported by the ideal letter and clinical notes.
- Do not create behaviours based on patient-specific facts only.
- Prefer reusable behaviours about structure, sequencing, tone, content inclusion/exclusion, closing style, and wording preferences.
- Include behaviours that would prevent the generated letter from drifting away from the ideal style.
- The patient first name is "${params.patientFirstName}". Using surname/full name when the provider uses first name is a style error.
- Return JSON only. No markdown.

Return this exact JSON shape:
{
  "score": number,
  "comparison_summary": "brief summary",
  "behaviours": [
    {
      "report_type": "${params.reportType} or all",
      "category": "opening|structure|content_inclusion|content_exclusion|wording|closing|referrer_communication|tone|formatting|clinical_reasoning",
      "behaviour_text": "one reusable provider behaviour written as a clear instruction",
      "reason": "why this behaviour was learnt",
      "confidence": "high|medium|low",
      "evidence_quote": "short quote or paraphrase from the ideal letter"
    }
  ]
}

Report type:
${params.reportType}

Clinical notes:
${params.clinicalNotes}

AI-generated letter:
${params.generatedLetter}

Provider-approved ideal letter:
${params.idealLetter}
`,
      },
    ],
  })

  return safeJsonParse(completion.choices[0]?.message?.content || "", fallback)
}

async function upsertBehaviour(params: {
  providerId: string
  reportType: string
  behaviour: LearntBehaviour
}) {
  const supabase = getSupabase()
  const reportType = clean(params.behaviour.report_type) || params.reportType
  const behaviourText = clean(params.behaviour.behaviour_text)

  if (!behaviourText) return null

  const behaviourKey = makeBehaviourKey(reportType, behaviourText)

  const existingResult = await supabase
    .from("provider_style_behaviours")
    .select("id, evidence_count, evidence")
    .eq("provider_id", params.providerId)
    .eq("report_type", reportType)
    .eq("behaviour_key", behaviourKey)
    .maybeSingle()

  const evidenceItem = {
    reason: clean(params.behaviour.reason),
    evidence_quote: clean(params.behaviour.evidence_quote),
    trained_at: new Date().toISOString(),
  }

  if (existingResult.error) {
    throw new Error(existingResult.error.message)
  }

  if (existingResult.data) {
    const currentEvidence = Array.isArray(existingResult.data.evidence)
      ? existingResult.data.evidence
      : []

    const { data, error } = await supabase
      .from("provider_style_behaviours")
      .update({
        evidence_count: Number(existingResult.data.evidence_count || 1) + 1,
        evidence: [...currentEvidence, evidenceItem].slice(-20),
        updated_at: new Date().toISOString(),
        is_active: true,
      })
      .eq("id", existingResult.data.id)
      .select()
      .maybeSingle()

    if (error) throw new Error(error.message)
    return data
  }

  const { data, error } = await supabase
    .from("provider_style_behaviours")
    .insert({
      provider_id: params.providerId,
      report_type: reportType,
      behaviour_key: behaviourKey,
      category: clean(params.behaviour.category) || "style",
      behaviour_text: behaviourText,
      reason: clean(params.behaviour.reason) || null,
      confidence: clean(params.behaviour.confidence) || "medium",
      evidence_count: 1,
      evidence: [evidenceItem],
      is_active: true,
    })
    .select()
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

function formatTemporaryBehaviourRules(behaviours: LearntBehaviour[]) {
  if (behaviours.length === 0) return ""

  return [
    "Temporary provider behaviours learnt from the ideal letter for this training case:",
    ...behaviours.map((item, index) => {
      return `${index + 1}. ${item.behaviour_text}`
    }),
    "Follow these behaviours while preserving clinical accuracy and the provider's ideal letter structure.",
  ].join("\n")
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing OPENAI_API_KEY." },
        { status: 500 }
      )
    }

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

    if (!providerId || !patientFirstName || !clinicalNotes || !idealLetter) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Provider, patient first name, clinical notes and ideal letter are required.",
        },
        { status: 400 }
      )
    }

    const baselineLetter = await generateLetter(origin, {
      providerId,
      reportType,
      patientName: patientFirstName,
      patientFirstName,
      patientGender,
      referrerName,
      clinicalNotes,
      temporaryRulesText: `Use the patient first name "${patientFirstName}" throughout the letter. Do not use a surname or full name unless explicitly shown in the ideal provider letter.`,
    })

    const analysis = await extractBehaviours({
      reportType,
      patientFirstName,
      clinicalNotes,
      generatedLetter: baselineLetter,
      idealLetter,
    })

    const learntBehaviours: LearntBehaviour[] = Array.isArray(analysis.behaviours)
      ? analysis.behaviours
          .map((item) => ({
            report_type: clean(item.report_type) || reportType,
            category: clean(item.category) || "style",
            behaviour_text: clean(item.behaviour_text),
            reason: clean(item.reason),
            confidence:
              item.confidence === "high" ||
              item.confidence === "medium" ||
              item.confidence === "low"
                ? item.confidence
                : "medium",
            evidence_quote: clean(item.evidence_quote),
          }))
          .filter((item) => item.behaviour_text)
      : []

    const savedBehaviours = []

    for (const behaviour of learntBehaviours) {
      const saved = await upsertBehaviour({
        providerId,
        reportType,
        behaviour,
      })

      if (saved) savedBehaviours.push(saved)
    }

    const temporaryRulesText = formatTemporaryBehaviourRules(learntBehaviours)

    const behaviourTrainedLetter = await generateLetter(origin, {
      providerId,
      reportType,
      patientName: patientFirstName,
      patientFirstName,
      patientGender,
      referrerName,
      clinicalNotes,
      temporaryRulesText,
    })

    const { data, error } = await supabase
      .from("provider_training_cases")
      .insert({
        provider_id: providerId,
        report_type: reportType,
        patient_name: patientFirstName,
        patient_first_name: patientFirstName,
        patient_gender: patientGender,
        referrer_name: referrerName || null,
        clinical_notes: clinicalNotes,
        ai_draft: baselineLetter,
        final_letter: idealLetter,
        best_generated_letter: behaviourTrainedLetter,
        behaviour_trained_letter: behaviourTrainedLetter,
        learnt_behaviours: learntBehaviours,
        suggested_rule_text: temporaryRulesText || null,
        approved_rule_text: temporaryRulesText || null,
        training_attempts: [
          {
            attempt_number: 1,
            generated_letter: baselineLetter,
            score: Number(analysis.score || 0),
            comparison_summary: clean(analysis.comparison_summary),
            suggested_rule: temporaryRulesText,
          },
          {
            attempt_number: 2,
            generated_letter: behaviourTrainedLetter,
            score: null,
            comparison_summary:
              "Regenerated once using learnt provider behaviours from the ideal letter.",
            suggested_rule: null,
          },
        ],
        status: "behaviour_trained",
      })
      .select()
      .maybeSingle()

    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      trainingCase: data,
      baselineLetter,
      behaviourTrainedLetter,
      comparisonScore: Number(analysis.score || 0),
      comparisonSummary: clean(analysis.comparison_summary),
      learntBehaviours,
      savedBehaviours,
    })
  } catch (error) {
    console.error("Train provider behaviours failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to train provider behaviours.",
      },
      { status: 500 }
    )
  }
}
