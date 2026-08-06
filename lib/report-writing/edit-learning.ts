import { createHash } from "crypto"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import type { AuditActor } from "@/lib/report-writing/audit"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type KnowledgeType = "behaviour" | "preferred_phrase" | "template_block"

type AnalysedBehaviour = {
  behaviour_key: string
  category: string
  knowledge_type: KnowledgeType
  behaviour_text: string
  preferred_phrase: string | null
  template_block: string | null
  applies_when: string | null
  evidence_summary: string
  confidence_delta: number
}

type EditAnalysis = {
  reusable: boolean
  ignore_reason: string | null
  summary: string
  behaviours: AnalysedBehaviour[]
}

export type EditLearningResult = {
  requested: boolean
  exampleSaved: boolean
  exampleId: string | null
  duplicate: boolean
  analysisStatus: "not_requested" | "processed" | "ignored" | "failed"
  behavioursCreated: number
  behavioursReinforced: number
  error: string | null
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

function clampInteger(value: unknown, minimum: number, maximum: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return minimum
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)))
}

function normaliseBehaviourKey(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120)
}

function getEvidenceWeight(actor: AuditActor, source: string) {
  const normalisedSource = clean(source).toLowerCase()

  if (actor.actorRole === "provider") return 12
  if (actor.actorRole === "admin") return 9

  if (
    actor.actorRole === "typist" &&
    normalisedSource.includes("provider_approval")
  ) {
    return 9
  }

  if (actor.actorRole === "typist") return 6
  if (actor.actorRole === "staff") return 4
  return 3
}

function makeFingerprint(params: {
  draftId: string
  originalText: string
  finalText: string
  source: string
}) {
  return createHash("sha256")
    .update(
      [
        params.draftId,
        params.source,
        params.originalText.trim(),
        params.finalText.trim(),
      ].join("\n---\n")
    )
    .digest("hex")
}

async function analyseEdit(params: {
  reportType: string
  originalText: string
  finalText: string
  actorRole: string
  source: string
}): Promise<EditAnalysis> {
  const fallback: EditAnalysis = {
    reusable: false,
    ignore_reason: "The analysis response could not be parsed.",
    summary: "No reusable behaviour extracted.",
    behaviours: [],
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You analyse edits to specialist dental letters and extract only reusable writing preferences. Return valid JSON only. Never convert patient-specific facts, corrected names, dates, tooth numbers, diagnoses, measurements, medications, treatment facts, or one-off factual corrections into reusable behaviours.",
      },
      {
        role: "user",
        content: `
Compare the original AI draft with the final approved letter.

Identify reusable provider writing behaviours only.

Ignore:
- patient-specific factual corrections
- patient names, DOBs and referrer details
- changed tooth numbers, dates, measurements or percentages
- corrected diagnoses, medications or treatment details
- spelling corrections that do not demonstrate a recurring terminology preference
- isolated wording changes with no clear reusable pattern
- changes caused only by missing clinical information

Useful behaviours may include:
- greeting or opening style
- paragraph order
- tone and brevity
- active versus passive voice
- preferred recurring terminology
- preferred phrases
- treatment-plan formatting
- table or bullet formatting
- closing style
- reusable report structure
- wording that should consistently be avoided

Report type: ${params.reportType}
Editor role: ${params.actorRole}
Learning source: ${params.source}

Return JSON using exactly this shape:
{
  "reusable": true,
  "ignore_reason": null,
  "summary": "brief summary",
  "behaviours": [
    {
      "behaviour_key": "stable_snake_case_key",
      "category": "opening|tone|structure|terminology|formatting|treatment_plan|closing|other",
      "knowledge_type": "behaviour|preferred_phrase|template_block",
      "behaviour_text": "clear reusable instruction",
      "preferred_phrase": null,
      "template_block": null,
      "applies_when": "short condition or null",
      "evidence_summary": "brief deidentified description of the edit evidence",
      "confidence_delta": 1
    }
  ]
}

Rules:
- Return reusable=false and an empty behaviours array when the edit is not reusable.
- Extract no more than 5 behaviours.
- confidence_delta must be an integer from 1 to 5.
- behaviour_key must describe the preference rather than this patient.
- preferred_phrase is only for knowledge_type preferred_phrase.
- template_block is only for knowledge_type template_block.
- Do not include patient-identifying information in any behaviour or evidence summary.

ORIGINAL AI DRAFT:
${params.originalText}

FINAL APPROVED LETTER:
${params.finalText}
`,
      },
    ],
  })

  const parsed = safeJsonParse<EditAnalysis>(
    completion.choices[0]?.message?.content || "",
    fallback
  )

  const behaviours = Array.isArray(parsed.behaviours)
    ? parsed.behaviours
        .map((item) => {
          const knowledgeType: KnowledgeType =
            item.knowledge_type === "preferred_phrase" ||
            item.knowledge_type === "template_block"
              ? item.knowledge_type
              : "behaviour"

          const behaviourKey = normaliseBehaviourKey(item.behaviour_key)
          const behaviourText = clean(item.behaviour_text)
          if (!behaviourKey || !behaviourText) return null

          return {
            behaviour_key: behaviourKey,
            category: clean(item.category) || "other",
            knowledge_type: knowledgeType,
            behaviour_text: behaviourText,
            preferred_phrase:
              knowledgeType === "preferred_phrase"
                ? clean(item.preferred_phrase) || null
                : null,
            template_block:
              knowledgeType === "template_block"
                ? clean(item.template_block) || null
                : null,
            applies_when: clean(item.applies_when) || null,
            evidence_summary:
              clean(item.evidence_summary) || "Learned from an approved edit.",
            confidence_delta: clampInteger(item.confidence_delta, 1, 5),
          } satisfies AnalysedBehaviour
        })
        .filter((item): item is AnalysedBehaviour => Boolean(item))
        .slice(0, 5)
    : []

  return {
    reusable: Boolean(parsed.reusable) && behaviours.length > 0,
    ignore_reason: clean(parsed.ignore_reason) || null,
    summary: clean(parsed.summary) || "Edit analysis complete.",
    behaviours,
  }
}

async function createOrReinforceBehaviour(params: {
  providerId: string
  reportType: string
  behaviour: AnalysedBehaviour
  source: string
  actor: AuditActor
}) {
  const { data: existing, error: existingError } = await supabase
    .from("provider_behaviours")
    .select("id, confidence, support_count, evidence_summary")
    .eq("provider_id", params.providerId)
    .eq("report_type", params.reportType)
    .eq("behaviour_key", params.behaviour.behaviour_key)
    .maybeSingle()

  if (existingError) throw new Error(existingError.message)

  const roleWeight = getEvidenceWeight(params.actor, params.source)
  const confidenceIncrease = Math.max(
    1,
    Math.round((roleWeight * params.behaviour.confidence_delta) / 5)
  )
  const now = new Date().toISOString()

  if (existing) {
    const nextConfidence = Math.min(
      100,
      Number(existing.confidence || 50) + confidenceIncrease
    )
    const nextSupportCount = Number(existing.support_count || 1) + 1

    const evidenceSummary = [
      clean(existing.evidence_summary),
      params.behaviour.evidence_summary,
    ]
      .filter(Boolean)
      .slice(-6)
      .join(" | ")

    const { error } = await supabase
      .from("provider_behaviours")
      .update({
        category: params.behaviour.category,
        knowledge_type: params.behaviour.knowledge_type,
        behaviour_text: params.behaviour.behaviour_text,
        preferred_phrase: params.behaviour.preferred_phrase,
        template_block: params.behaviour.template_block,
        applies_when: params.behaviour.applies_when,
        evidence_summary: evidenceSummary,
        confidence: nextConfidence,
        support_count: nextSupportCount,
        status: "active",
        source: "approved_edit_learning",
        updated_at: now,
      })
      .eq("id", existing.id)

    if (error) throw new Error(error.message)
    return "reinforced" as const
  }

  const initialConfidence = Math.min(90, 45 + confidenceIncrease)

  const { error } = await supabase.from("provider_behaviours").insert({
    provider_id: params.providerId,
    report_type: params.reportType,
    behaviour_key: params.behaviour.behaviour_key,
    category: params.behaviour.category,
    behaviour_text: params.behaviour.behaviour_text,
    evidence_summary: params.behaviour.evidence_summary,
    confidence: initialConfidence,
    support_count: 1,
    status: "active",
    source: "approved_edit_learning",
    knowledge_type: params.behaviour.knowledge_type,
    preferred_phrase: params.behaviour.preferred_phrase,
    template_block: params.behaviour.template_block,
    applies_when: params.behaviour.applies_when,
    created_at: now,
    updated_at: now,
  })

  if (error) throw new Error(error.message)
  return "created" as const
}

export async function processApprovedEdit(params: {
  providerId: string
  draftId: string
  reportType: string
  originalText: string
  finalText: string
  source: string
  actor: AuditActor
  approvedByProvider?: boolean
}): Promise<EditLearningResult> {
  const originalText = clean(params.originalText)
  const finalText = clean(params.finalText)

  const baseResult: EditLearningResult = {
    requested: true,
    exampleSaved: false,
    exampleId: null,
    duplicate: false,
    analysisStatus: "failed",
    behavioursCreated: 0,
    behavioursReinforced: 0,
    error: null,
  }

  if (!originalText || !finalText || originalText === finalText) {
    return {
      ...baseResult,
      analysisStatus: "ignored",
      error: "Original and final text were missing or unchanged.",
    }
  }

  const fingerprint = makeFingerprint({
    draftId: params.draftId,
    originalText,
    finalText,
    source: params.source,
  })

  try {
    const { data: existingExample, error: existingExampleError } = await supabase
      .from("provider_report_edit_examples")
      .select("id, analysis_status")
      .eq("edit_fingerprint", fingerprint)
      .maybeSingle()

    if (existingExampleError) throw new Error(existingExampleError.message)

    if (existingExample) {
      return {
        ...baseResult,
        exampleSaved: true,
        exampleId: existingExample.id,
        duplicate: true,
        analysisStatus:
          existingExample.analysis_status === "processed"
            ? "processed"
            : existingExample.analysis_status === "ignored"
              ? "ignored"
              : "failed",
        error: null,
      }
    }

    const approvedByProvider =
      params.approvedByProvider ??
      (params.actor.actorRole === "provider" ||
        params.actor.actorRole === "admin")

    const { data: example, error: insertError } = await supabase
      .from("provider_report_edit_examples")
      .insert({
        provider_id: params.providerId,
        report_type: params.reportType,
        original_text: originalText,
        final_text: finalText,
        report_draft_id: params.draftId,
        source: params.source,
        editor_role: params.actor.actorRole,
        editor_id: params.actor.actorUserId,
        editor_name: params.actor.actorFullName,
        approved_by_provider: approvedByProvider,
        analysis_status: "processing",
        analysis_attempts: 1,
        analysis_error: null,
        analysis_json: {},
        edit_fingerprint: fingerprint,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single()

    if (insertError || !example) {
      throw new Error(insertError?.message || "Could not save learning example.")
    }

    baseResult.exampleSaved = true
    baseResult.exampleId = example.id

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY.")
    }

    const analysis = await analyseEdit({
      reportType: params.reportType,
      originalText,
      finalText,
      actorRole: params.actor.actorRole,
      source: params.source,
    })

    if (!analysis.reusable || analysis.behaviours.length === 0) {
      await supabase
        .from("provider_report_edit_examples")
        .update({
          analysis_status: "ignored",
          analysed_at: new Date().toISOString(),
          analysis_error: analysis.ignore_reason,
          analysis_json: analysis,
          updated_at: new Date().toISOString(),
        })
        .eq("id", example.id)

      return {
        ...baseResult,
        exampleSaved: true,
        exampleId: example.id,
        analysisStatus: "ignored",
        error: analysis.ignore_reason,
      }
    }

    let created = 0
    let reinforced = 0

    for (const behaviour of analysis.behaviours) {
      const outcome = await createOrReinforceBehaviour({
        providerId: params.providerId,
        reportType: params.reportType,
        behaviour,
        source: params.source,
        actor: params.actor,
      })

      if (outcome === "created") created += 1
      if (outcome === "reinforced") reinforced += 1
    }

    await supabase
      .from("provider_report_edit_examples")
      .update({
        analysis_status: "processed",
        analysed_at: new Date().toISOString(),
        analysis_error: null,
        analysis_json: analysis,
        updated_at: new Date().toISOString(),
      })
      .eq("id", example.id)

    return {
      ...baseResult,
      exampleSaved: true,
      exampleId: example.id,
      analysisStatus: "processed",
      behavioursCreated: created,
      behavioursReinforced: reinforced,
      error: null,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Edit learning analysis failed."

    console.error("Approved edit learning failed:", error)

    if (baseResult.exampleId) {
      await supabase
        .from("provider_report_edit_examples")
        .update({
          analysis_status: "failed",
          analysis_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", baseResult.exampleId)
    }

    return {
      ...baseResult,
      analysisStatus: "failed",
      error: message,
    }
  }
}

export function noLearningRequested(): EditLearningResult {
  return {
    requested: false,
    exampleSaved: false,
    exampleId: null,
    duplicate: false,
    analysisStatus: "not_requested",
    behavioursCreated: 0,
    behavioursReinforced: 0,
    error: null,
  }
}
