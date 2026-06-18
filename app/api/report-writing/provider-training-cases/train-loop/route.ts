import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(
      text
        .trim()
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim()
    ) as T
  } catch {
    return fallback
  }
}

function normaliseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.map((item) => clean(item)).filter(Boolean)
}

function uniqueRules(rules: string[]) {
  const seen = new Set<string>()
  const output: string[] = []

  for (const rule of rules) {
    const cleaned = clean(rule)
    if (!cleaned) continue

    const key = cleaned.toLowerCase().replace(/\s+/g, " ")
    if (seen.has(key)) continue

    seen.add(key)
    output.push(cleaned)
  }

  return output
}

function enforcePatientFirstNameOnly(report: string, patientFirstName: string) {
  const exactName = clean(patientFirstName)
  if (!exactName) return report

  // This route only sends first name to the generator, so we only do a light repair here.
  // Do not try to guess names from the report.
  return report
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

type ComparisonResult = {
  score: number
  strengths: string[]
  missing_from_generated: string[]
  should_remove_from_generated: string[]
  suggested_rule: string
  comparison_summary: string
}

async function compareToIdeal(params: {
  reportType: string
  clinicalNotes: string
  generatedLetter: string
  idealLetter: string
  patientFirstName: string
}) {
  const fallback: ComparisonResult = {
    score: 0,
    strengths: [],
    missing_from_generated: [],
    should_remove_from_generated: [],
    suggested_rule: "",
    comparison_summary: "Could not analyse comparison.",
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You compare dental letters. Return JSON only. Do not use markdown. Be strict but fair.",
      },
      {
        role: "user",
        content: `
Compare the AI-generated dental letter with the ideal provider-approved letter.

Score from 0 to 100.

Important rules:
- The patient first name is "${params.patientFirstName}".
- The ideal letter is the source of truth for structure, paragraph order, tone, and content selection.
- Penalise unnecessary headings if the ideal letter does not use headings.
- Penalise generic wording when the ideal has specific provider wording.
- Penalise omitted clinically relevant facts present in the ideal letter and supported by the notes.
- Penalise added clinical details that are in the notes but absent from the ideal letter if they change the provider's style.

Return JSON only:
{
  "score": number,
  "strengths": ["..."],
  "missing_from_generated": ["..."],
  "should_remove_from_generated": ["..."],
  "suggested_rule": "one concise rule to improve the next attempt",
  "comparison_summary": "short summary"
}

Report type:
${params.reportType}

Clinical notes:
${params.clinicalNotes}

AI-generated letter:
${params.generatedLetter}

Ideal provider-approved letter:
${params.idealLetter}
`,
      },
    ],
  })

  return safeJsonParse(completion.choices[0]?.message?.content || "", fallback)
}

type DifferenceBehaviour = {
  category: string
  difference: string
  provider_behaviour_rule: string
  reason: string
  confidence: "high" | "medium" | "low"
}

type DifferenceExtractionResult = {
  behaviours: DifferenceBehaviour[]
  do_not_learn: string[]
}

async function extractProviderBehaviours(params: {
  reportType: string
  clinicalNotes: string
  generatedLetter: string
  idealLetter: string
}) {
  const fallback: DifferenceExtractionResult = {
    behaviours: [],
    do_not_learn: [],
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You convert differences between AI dental letters and ideal provider letters into reusable provider training behaviours. Return JSON only.",
      },
      {
        role: "user",
        content: `
You are training an AI dental letter writer.

Compare the generated letter to the ideal provider-approved letter and extract reusable provider behaviours.

Goal:
Create rules that would help future letters match this provider's style.

Important:
- Do not create rules that only copy one patient's facts.
- Do create rules that describe reusable behaviours.
- Good rules explain WHEN to include something and HOW the provider words it.
- Prefer rules that preserve provider structure, warmth, paragraph sequence, and content selection.
- Do not create contradictory rules.
- Do not create more than 8 behaviour rules.
- Do not suggest a rule for accidental details that are not supported by the clinical notes.

Return JSON only:
{
  "behaviours": [
    {
      "category": "opening|content_inclusion|content_exclusion|wording|structure|closing|referrer_communication|treatment_plan|other",
      "difference": "what differed between generated and ideal",
      "provider_behaviour_rule": "reusable provider rule",
      "reason": "why this helps",
      "confidence": "high|medium|low"
    }
  ],
  "do_not_learn": ["differences that appear patient-specific and should not become rules"]
}

Report type:
${params.reportType}

Clinical notes:
${params.clinicalNotes}

Generated letter:
${params.generatedLetter}

Ideal provider-approved letter:
${params.idealLetter}
`,
      },
    ],
  })

  const parsed = safeJsonParse<DifferenceExtractionResult>(
    completion.choices[0]?.message?.content || "",
    fallback
  )

  return {
    behaviours: Array.isArray(parsed.behaviours) ? parsed.behaviours : [],
    do_not_learn: normaliseStringArray(parsed.do_not_learn),
  }
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
    const patientFirstName = clean(body.patientFirstName) || "Patient"
    const patientName = patientFirstName
    const patientGender = clean(body.patientGender) || "neutral"
    const referrerName = clean(body.referrerName)
    const clinicalNotes = clean(body.clinicalNotes)
    const idealLetter = clean(body.idealLetter)
    const maxAttempts = Math.min(Math.max(Number(body.maxAttempts || 2), 1), 4)

    if (!providerId || !patientFirstName || !clinicalNotes || !idealLetter) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Provider, patient name, clinical notes and ideal letter are required.",
        },
        { status: 400 }
      )
    }

    const attempts: any[] = []
    const behaviourRules: string[] = []

    const baseTemporaryRules = [
      `Use the patient first name "${patientFirstName}" throughout the letter. Do not use a surname in the body of the letter unless the ideal provider example specifically does so.`,
      "Follow the ideal provider letter's paragraph order, tone, warmth, and structure as closely as possible.",
      "Do not add headings such as Plan, Next visit, Assessment, or Treatment unless the ideal provider letter uses those headings.",
      "When the ideal letter uses narrative paragraphs, preserve narrative paragraphs rather than converting the content into headings or bullet points.",
      "When the ideal letter contains a specific provider wording pattern, prefer that wording over generic AI phrasing.",
    ]

    for (let index = 0; index < maxAttempts; index++) {
      const temporaryRulesText = uniqueRules([
        ...baseTemporaryRules,
        ...behaviourRules,
      ])
        .map((rule, ruleIndex) => `${ruleIndex + 1}. ${rule}`)
        .join("\n")

      const generatedRaw = await generateLetter(origin, {
        providerId,
        reportType,
        patientName,
        patientFirstName,
        patientGender,
        referrerName,
        referrerAddress: "",
        patientDob: "",
        clinicalNotes,
        temporaryRulesText,
      })

      const generatedLetter = enforcePatientFirstNameOnly(
        generatedRaw,
        patientFirstName
      )

      const [comparison, differenceExtraction] = await Promise.all([
        compareToIdeal({
          reportType,
          clinicalNotes,
          generatedLetter,
          idealLetter,
          patientFirstName,
        }),
        extractProviderBehaviours({
          reportType,
          clinicalNotes,
          generatedLetter,
          idealLetter,
        }),
      ])

      const extractedRules = differenceExtraction.behaviours
        .filter((item) => item.provider_behaviour_rule)
        .map((item) => item.provider_behaviour_rule)

      const attempt = {
        attempt_number: index + 1,
        generated_letter: generatedLetter,
        score: Number(comparison.score || 0),
        strengths: normaliseStringArray(comparison.strengths),
        missing_from_generated: normaliseStringArray(
          comparison.missing_from_generated
        ),
        should_remove_from_generated: normaliseStringArray(
          comparison.should_remove_from_generated
        ),
        suggested_rule: clean(comparison.suggested_rule),
        comparison_summary: clean(comparison.comparison_summary),
        extracted_behaviours: differenceExtraction.behaviours,
        do_not_learn: differenceExtraction.do_not_learn,
      }

      attempts.push(attempt)

      for (const rule of extractedRules) {
        if (!behaviourRules.includes(rule)) behaviourRules.push(rule)
      }

      if (
        attempt.suggested_rule &&
        !behaviourRules.includes(attempt.suggested_rule)
      ) {
        behaviourRules.push(attempt.suggested_rule)
      }

      if (attempt.score >= 94) break
    }

    const bestAttempt = attempts.reduce((best, current) =>
      current.score > best.score ? current : best
    )

    const suggestedRulesText = uniqueRules(behaviourRules)
      .map((rule, index) => `${index + 1}. ${rule}`)
      .join("\n\n")

    const { data, error } = await supabase
      .from("provider_training_cases")
      .insert({
        provider_id: providerId,
        report_type: reportType,
        patient_name: patientName,
        patient_first_name: patientFirstName,
        patient_dob: null,
        patient_gender: patientGender,
        referrer_name: referrerName || null,
        referrer_address: null,
        clinical_notes: clinicalNotes,
        ai_draft: attempts[0]?.generated_letter || null,
        final_letter: idealLetter,
        suggested_rule_text: suggestedRulesText || null,
        approved_rule_text: suggestedRulesText || null,
        training_attempts: attempts,
        best_generated_letter: bestAttempt?.generated_letter || null,
        status: "analysed",
      })
      .select()
      .maybeSingle()

    if (error) throw new Error(error.message)

    return NextResponse.json({
      success: true,
      trainingCase: data,
      attempts,
      bestAttempt,
      suggestedRulesText,
    })
  } catch (error) {
    console.error("Training loop failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Training loop failed.",
      },
      { status: 500 }
    )
  }
}
