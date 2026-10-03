import { createHash } from "crypto"
import type OpenAI from "openai"
import type { AuditActor } from "@/lib/report-writing/audit"

type KnowledgeType = "behaviour" | "preferred_phrase" | "template_block"

export type AnalysedBehaviour = {
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

export type EditAnalysis = {
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

export function clean(value: unknown) {
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

export function getEvidenceWeight(actor: AuditActor, source: string) {
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

export function makeFingerprint(params: {
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

export async function analyseApprovedEdit(client: Pick<OpenAI, "chat">, params: {
  reportType: string
  originalText: string
  finalText: string
  actorRole: string
  source: string
}, requestOptions?: { signal?: AbortSignal; maxRetries?: number }): Promise<EditAnalysis> {
  const fallback: EditAnalysis = {
    reusable: false,
    ignore_reason: "The analysis response could not be parsed.",
    summary: "No reusable behaviour extracted.",
    behaviours: [],
  }

  const completion = await client.chat.completions.create({
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
  }, requestOptions)

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
