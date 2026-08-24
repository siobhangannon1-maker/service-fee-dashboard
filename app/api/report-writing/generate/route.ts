import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type TrainingData = {
  rulesText: string
  terminologyText: string
  examplesText: string
  providerKnowledgeText: string
  exampleDebug: Array<{
    id: string
    title: string | null
    report_type: string
    scenario_tags: string[] | null
    scenario_summary: string | null
    is_preferred: boolean | null
    relevance_score: number
  }>
}

type ClinicalScenario = {
  summary: string
  procedure_category: string
  implant_count: number | null
  implant_sites: string[]
  guided_surgery: boolean | null
  grafting_performed: boolean | null
  immediate_implant: boolean | null
  extraction_performed: boolean | null
  sinus_lift: boolean | null
  membrane_used: boolean | null
  provisionalisation: boolean | null
  key_clinical_features: string[]
  missing_or_unclear_details: string[]
}

type PatientGender = "male" | "female" | "neutral"

function cleanString(value: unknown) {
  return String(value ?? "").trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normaliseScore(value: unknown, fallback = 70) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback

  // Some AI outputs use 0.9 instead of 90.
  if (numeric > 0 && numeric <= 1) return Math.round(numeric * 100)

  return Math.max(1, Math.min(100, Math.round(numeric)))
}

async function safeSelect<T>(query: PromiseLike<{ data: T | null; error: any }>) {
  const result = await query

  if (result.error) {
    console.warn("Optional provider training query failed:", result.error.message)
    return null
  }

  return result.data
}

async function getProviderKnowledgeText(providerId: string | null, reportType: string) {
  if (!providerId) {
    return "No provider behaviours, preferred phrases, template blocks, or provider knowledge saved."
  }

  const [behaviourData, knowledgeData] = await Promise.all([
    safeSelect<any[]>(
      supabase
        .from("provider_behaviours")
        .select("*")
        .eq("provider_id", providerId)
        .eq("status", "active")
        .in("report_type", [reportType, "all"])
        .order("confidence", { ascending: false })
        .order("support_count", { ascending: false })
        .limit(160)
    ),
    safeSelect<any[]>(
      supabase
        .from("provider_knowledge")
        .select("*")
        .eq("provider_id", providerId)
        .eq("status", "active")
        .in("report_type", [reportType, "all"])
        .order("confidence", { ascending: false })
        .order("evidence_count", { ascending: false })
        .limit(160)
    ),
  ])

  const normalisedBehaviours = (behaviourData || []).map((item) => ({
    ...item,
    origin: "provider_behaviours",
    support_count: Number(item.support_count || 1),
    behaviour_text: cleanString(item.behaviour_text),
    phrase_text: cleanString(item.preferred_phrase || item.phrase_text),
    template_block_text: cleanString(item.template_block || item.template_block_text),
  }))

  const normalisedKnowledge = (knowledgeData || []).map((item) => {
    const knowledgeType = cleanString(item.knowledge_type || "behaviour")
    const knowledgeText = cleanString(item.knowledge_text)

    return {
      ...item,
      origin: "provider_knowledge",
      knowledge_type: knowledgeType,
      support_count: Number(item.evidence_count || 1),
      behaviour_text: knowledgeType === "behaviour" ? knowledgeText : "",
      phrase_text: knowledgeType === "preferred_phrase" ? knowledgeText : "",
      template_block_text: knowledgeType === "template_block" ? knowledgeText : "",
    }
  })

  const combinedData = [...normalisedBehaviours, ...normalisedKnowledge]

  if (combinedData.length === 0) {
    return "No provider behaviours, preferred phrases, template blocks, or provider knowledge saved."
  }

  // Learned edit behaviours should not influence future letters after only one edit.
  // Formatting/structure/treatment-plan behaviours require stronger repeated evidence.
  // Training-case/provider-knowledge records are allowed through because they were
  // deliberately created from provider training material rather than a single edit.
  const usableData = combinedData.filter((item) => {
    const source = cleanString(item.source).toLowerCase()
    const supportCount = Number(item.support_count || 1)
    const category = cleanString(item.category).toLowerCase()

    if (source !== "approved_edit_learning") return true

    if (["formatting", "structure", "treatment_plan", "treatment_plan_format"].includes(category)) {
      return supportCount >= 3
    }

    return supportCount >= 2
  })

  if (usableData.length === 0) {
    return "No learned provider behaviours have enough supporting evidence yet."
  }

  // The same learned preference can exist in both provider_knowledge and
  // provider_behaviours. Deduplicate by report type + knowledge type + text.
  const deduped = new Map<string, any>()

  for (const item of usableData) {
    const type = cleanString(item.knowledge_type || "behaviour") || "behaviour"
    const textValue =
      cleanString(item.behaviour_text) ||
      cleanString(item.phrase_text) ||
      cleanString(item.template_block_text) ||
      cleanString(item.knowledge_text)

    if (!textValue) continue

    const key = [
      cleanString(item.report_type || reportType).toLowerCase(),
      type.toLowerCase(),
      textValue.toLowerCase().replace(/\s+/g, " "),
    ].join("|")

    const existing = deduped.get(key)

    if (!existing) {
      deduped.set(key, item)
      continue
    }

    const existingConfidence = normaliseScore(existing.confidence, 70)
    const candidateConfidence = normaliseScore(item.confidence, 70)
    const existingSupport = Number(existing.support_count || 1)
    const candidateSupport = Number(item.support_count || 1)

    if (
      candidateConfidence > existingConfidence ||
      (candidateConfidence === existingConfidence && candidateSupport > existingSupport)
    ) {
      deduped.set(key, item)
    }
  }

  const uniqueData = Array.from(deduped.values()).sort((a, b) => {
    const confidenceDiff =
      normaliseScore(b.confidence, 70) - normaliseScore(a.confidence, 70)

    if (confidenceDiff !== 0) return confidenceDiff

    return Number(b.support_count || 1) - Number(a.support_count || 1)
  })

  const behaviours = uniqueData.filter((item) => {
    const type = cleanString(item.knowledge_type || "behaviour")
    return type === "behaviour" || !type
  })

  const phrases = uniqueData.filter((item) => {
    const type = cleanString(item.knowledge_type)
    return type === "preferred_phrase"
  })

  const templateBlocks = uniqueData.filter((item) => {
    const type = cleanString(item.knowledge_type)
    return type === "template_block"
  })

  const formatItem = (item: any, index: number) => {
    const confidence = normaliseScore(item.confidence, 70)
    const supportCount = Number(item.support_count || 1)
    const category = cleanString(item.category) || "general"
    const text =
      cleanString(item.behaviour_text) ||
      cleanString(item.phrase_text) ||
      cleanString(item.template_block_text) ||
      cleanString(item.knowledge_text)

    const evidence = cleanString(item.evidence_summary)
    const origin = cleanString(item.origin) || "provider_learning"

    return [
      `${index + 1}. [${item.report_type || reportType} / ${category} / confidence ${confidence}% / seen ${supportCount} / ${origin}]`,
      text,
      evidence ? `Evidence: ${evidence}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  }

  const sections: string[] = []

  if (behaviours.length > 0) {
    sections.push(
      [
        "LEARNED PROVIDER BEHAVIOURS",
        "Use these as provider-specific style, structure, formatting, and content preferences.",
        "High-confidence repeated formatting and treatment-plan behaviours override conflicting example formatting.",
        behaviours.map(formatItem).join("\n\n"),
      ].join("\n")
    )
  }

  if (phrases.length > 0) {
    sections.push(
      [
        "PREFERRED PROVIDER PHRASES",
        "When clinically appropriate, prefer these phrases or very close wording rather than generic wording.",
        phrases.map(formatItem).join("\n\n"),
      ].join("\n")
    )
  }

  if (templateBlocks.length > 0) {
    sections.push(
      [
        "PROVIDER TEMPLATE BLOCKS",
        "Use these as reusable paragraph or section structures when the clinical scenario matches.",
        templateBlocks.map(formatItem).join("\n\n"),
      ].join("\n")
    )
  }

  return sections.join("\n\n---\n\n")
}

async function getProviderTraining(
  providerId: string | null,
  reportType: string,
  scenarioTags: string[] = [],
  preferredExampleId: string | null = null
): Promise<TrainingData> {
  const safeScenarioTags = Array.isArray(scenarioTags) ? scenarioTags : []
  const safePreferredExampleId = cleanString(preferredExampleId)

  const universalRulesResult = await supabase
    .from("universal_report_rules")
    .select("report_type, rule_text")
    .in("report_type", [reportType, "all"])

  const universalRules =
    universalRulesResult.data && universalRulesResult.data.length > 0
      ? universalRulesResult.data.map((rule) => rule.rule_text)
      : []

  const providerKnowledgeText = await getProviderKnowledgeText(providerId, reportType)

  if (!providerId) {
    return {
      rulesText:
        universalRules.length > 0
          ? universalRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")
          : "No report rules saved.",
      terminologyText: "No provider-specific terminology rules saved.",
      examplesText: "No provider-specific examples saved.",
      providerKnowledgeText,
      exampleDebug: [],
    }
  }

  const [rulesResult, terminologyResult, examplesResult] = await Promise.all([
    supabase
      .from("provider_report_rules")
      .select("report_type, rule_text")
      .eq("provider_id", providerId)
      .in("report_type", [reportType, "all"]),

    supabase
      .from("provider_terminology_rules")
      .select("spoken_or_written_text, preferred_text")
      .eq("provider_id", providerId),

    supabase
      .from("provider_report_examples")
      .select(
        "id, report_type, title, example_text, scenario_tags, scenario_summary, is_preferred, created_at"
      )
      .eq("provider_id", providerId)
      .eq("report_type", reportType)
      .order("created_at", { ascending: false })
      .limit(40),
  ])

  const providerRules =
    rulesResult.data && rulesResult.data.length > 0
      ? rulesResult.data.map((rule) => rule.rule_text)
      : []

  const allRules = [...universalRules, ...providerRules]

  const rulesText =
    allRules.length > 0
      ? allRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")
      : "No report rules saved."

  const terminologyText =
    terminologyResult.data && terminologyResult.data.length > 0
      ? terminologyResult.data
          .map(
            (item, index) =>
              `${index + 1}. Replace "${item.spoken_or_written_text}" with "${item.preferred_text}"`
          )
          .join("\n")
      : "No provider-specific terminology rules saved."

  const allExamples = examplesResult.data || []

  const scoredExamples = allExamples
    .map((example) => {
      const tags: string[] = Array.isArray(example.scenario_tags)
        ? example.scenario_tags
        : []
      const tagMatches = safeScenarioTags.filter((tag: string) => tags.includes(tag)).length

      let relevanceScore = 0

      if (safePreferredExampleId && example.id === safePreferredExampleId) {
        relevanceScore += 1000
      }

      if (example.is_preferred) {
        relevanceScore += 25
      }

      relevanceScore += tagMatches * 10

      if (safeScenarioTags.length > 0 && tags.length > 0) {
        const extraTags = tags.filter((tag: string) => !safeScenarioTags.includes(tag)).length
        relevanceScore -= extraTags
      }

      return {
        ...example,
        relevance_score: relevanceScore,
      }
    })
    .sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) {
        return b.relevance_score - a.relevance_score
      }

      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0
      return bDate - aDate
    })
    .slice(0, safePreferredExampleId ? 8 : 6)

  const examplesText =
    scoredExamples.length > 0
      ? scoredExamples
          .map((example, index) => {
            return [
              `Example ${index + 1}: ${example.title || "Untitled"}`,
              `Report type: ${example.report_type}`,
              `Scenario tags: ${(example.scenario_tags || []).join(", ") || "none"}`,
              `Scenario summary: ${example.scenario_summary || "none"}`,
              `Preferred example: ${example.is_preferred ? "yes" : "no"}`,
              `Relevance score: ${example.relevance_score}`,
              example.example_text,
            ].join("\n")
          })
          .join("\n\n---\n\n")
      : "No provider-specific examples saved."

  return {
    rulesText,
    terminologyText,
    examplesText,
    providerKnowledgeText,
    exampleDebug: scoredExamples.map((example) => ({
      id: example.id,
      title: example.title,
      report_type: example.report_type,
      scenario_tags: example.scenario_tags,
      scenario_summary: example.scenario_summary,
      is_preferred: example.is_preferred,
      relevance_score: example.relevance_score,
    })),
  }
}

async function enforceExactPatientFirstName(
  report: string,
  patientFirstName: string,
  patientFullName?: string
) {
  const firstName = cleanString(patientFirstName)
  const fullName = cleanString(patientFullName)

  if (!firstName) return report

  let fixed = report

  if (fullName && fullName !== firstName) {
    fixed = fixed.replace(
      new RegExp(`\\b${escapeRegExp(fullName)}\\b`, "g"),
      firstName
    )

    const nameParts = fullName.split(/\s+/).filter(Boolean)
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : ""

    if (lastName && lastName !== firstName) {
      fixed = fixed.replace(
        new RegExp(`\\b${escapeRegExp(lastName)}\\b`, "g"),
        firstName
      )
    }
  }

  return fixed
}

function getReportFormattingInstruction(reportType: string) {
  if (
    reportType === "consultation_report" ||
    reportType === "periodontal_consultation_report"
  ) {
    return [
      "MANDATORY TREATMENT-PLAN FORMAT FOR THIS REPORT TYPE:",
      "- Write the treatment plan as concise narrative prose in normal paragraphs.",
      "- Do NOT use a numbered treatment plan.",
      "- Do NOT use bullet points for the treatment plan.",
      "- If provider examples contain a numbered or bulleted treatment plan, ignore that example formatting and preserve only the clinically appropriate content and sequencing.",
      "- This formatting instruction overrides conflicting provider-example formatting.",
    ].join("\n")
  }

  return "No additional report-type formatting override."
}

function getReportTypeLabel(reportType: string) {
  const labels: Record<string, string> = {
    consultation_report: "consultation report",
    periodontal_consultation_report: "periodontal consultation report",
    treatment_report: "treatment report",
    review: "review letter",
    SPT_report: "supportive periodontal therapy report",
    osseointegration_letter: "osseointegration letter",
    surgery_report: "surgery report",
    referral_reply: "referral reply",
    post_op_letter: "post-operative letter",
    medico_legal_report: "medico-legal report",
    patient_letter: "patient letter",
    gp_letter: "GP letter",
    dictated_letter: "dictated letter",
  }

  return labels[reportType] || reportType.replace(/_/g, " ")
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

function normaliseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
}

function normaliseClinicalScenario(
  value: Partial<ClinicalScenario> | null | undefined,
  reportType: string
): ClinicalScenario {
  return {
    summary: cleanString(value?.summary) || "No structured scenario detected.",
    procedure_category: cleanString(value?.procedure_category) || reportType,
    implant_count:
      typeof value?.implant_count === "number" && Number.isFinite(value.implant_count)
        ? value.implant_count
        : null,
    implant_sites: normaliseStringArray(value?.implant_sites),
    guided_surgery:
      typeof value?.guided_surgery === "boolean" ? value.guided_surgery : null,
    grafting_performed:
      typeof value?.grafting_performed === "boolean" ? value.grafting_performed : null,
    immediate_implant:
      typeof value?.immediate_implant === "boolean" ? value.immediate_implant : null,
    extraction_performed:
      typeof value?.extraction_performed === "boolean" ? value.extraction_performed : null,
    sinus_lift:
      typeof value?.sinus_lift === "boolean" ? value.sinus_lift : null,
    membrane_used:
      typeof value?.membrane_used === "boolean" ? value.membrane_used : null,
    provisionalisation:
      typeof value?.provisionalisation === "boolean" ? value.provisionalisation : null,
    key_clinical_features: normaliseStringArray(value?.key_clinical_features),
    missing_or_unclear_details: normaliseStringArray(value?.missing_or_unclear_details),
  }
}

async function detectClinicalScenario(
  clinicalNotes: string,
  reportType: string
): Promise<ClinicalScenario> {
  const fallback: ClinicalScenario = {
    summary: "No structured scenario detected.",
    procedure_category: reportType,
    implant_count: null,
    implant_sites: [],
    guided_surgery: null,
    grafting_performed: null,
    immediate_implant: null,
    extraction_performed: null,
    sinus_lift: null,
    membrane_used: null,
    provisionalisation: null,
    key_clinical_features: [],
    missing_or_unclear_details: [],
  }

  const scenarioPrompt = `
You are analysing dental clinical notes before a letter is written.

Extract the clinical scenario from the notes.

Return JSON only. Do not include markdown.

Use true, false, or null where details are unclear.

JSON shape:
{
  "summary": "brief plain English summary",
  "procedure_category": "brief category, e.g. single implant guided placement with graft",
  "implant_count": number or null,
  "implant_sites": ["tooth/site labels if stated"],
  "guided_surgery": true/false/null,
  "grafting_performed": true/false/null,
  "immediate_implant": true/false/null,
  "extraction_performed": true/false/null,
  "sinus_lift": true/false/null,
  "membrane_used": true/false/null,
  "provisionalisation": true/false/null,
  "key_clinical_features": ["important clinical facts only from notes"],
  "missing_or_unclear_details": ["important details that are unclear or not stated"]
}

Report type:
${reportType}

Clinical notes:
${clinicalNotes}
`

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You extract structured dental clinical facts from notes. You return valid JSON only and do not invent facts.",
      },
      {
        role: "user",
        content: scenarioPrompt,
      },
    ],
  })

  const content = completion.choices[0]?.message?.content || ""

  const parsed = safeJsonParse<Partial<ClinicalScenario>>(content, fallback)

  return normaliseClinicalScenario(parsed, reportType)
}

function formatClinicalScenario(scenario: ClinicalScenario) {
  return [
    `Scenario summary: ${scenario.summary}`,
    `Procedure category: ${scenario.procedure_category}`,
    `Implant count: ${scenario.implant_count ?? "Not clearly stated"}`,
    `Implant sites: ${
      scenario.implant_sites.length > 0
        ? scenario.implant_sites.join(", ")
        : "Not clearly stated"
    }`,
    `Guided surgery: ${scenario.guided_surgery ?? "Not clearly stated"}`,
    `Grafting performed: ${scenario.grafting_performed ?? "Not clearly stated"}`,
    `Immediate implant: ${scenario.immediate_implant ?? "Not clearly stated"}`,
    `Extraction performed: ${
      scenario.extraction_performed ?? "Not clearly stated"
    }`,
    `Sinus lift: ${scenario.sinus_lift ?? "Not clearly stated"}`,
    `Membrane used: ${scenario.membrane_used ?? "Not clearly stated"}`,
    `Provisionalisation: ${scenario.provisionalisation ?? "Not clearly stated"}`,
    "",
    "Key clinical features:",
    scenario.key_clinical_features.length > 0
      ? scenario.key_clinical_features.map((item) => `- ${item}`).join("\n")
      : "- None detected",
    "",
    "Missing or unclear details:",
    scenario.missing_or_unclear_details.length > 0
      ? scenario.missing_or_unclear_details.map((item) => `- ${item}`).join("\n")
      : "- None detected",
  ].join("\n")
}

function getScenarioTagsFromClinicalScenario(scenario: ClinicalScenario) {
  const tags: string[] = []

  if (scenario.implant_count === 1) tags.push("single_implant")
  if ((scenario.implant_count || 0) > 1) tags.push("multiple_implants")
  if (scenario.guided_surgery === true) tags.push("guided")
  if (scenario.grafting_performed === true) tags.push("graft")
  if (scenario.immediate_implant === true) tags.push("immediate")
  if (scenario.extraction_performed === true) tags.push("extraction")
  if (scenario.sinus_lift === true) tags.push("sinus_lift")
  if (scenario.membrane_used === true) tags.push("membrane")
  if (scenario.provisionalisation === true) tags.push("provisionalisation")

  return tags
}

function normalisePatientGender(value: unknown): PatientGender {
  if (value === "male" || value === "female" || value === "neutral") {
    return value
  }

  return "neutral"
}

function getGenderInstruction(patientGender: PatientGender) {
  if (patientGender === "male") {
    return [
      "Patient gender/pronoun setting: male.",
      "Use male pronouns where pronouns are required: he, him, his.",
      "Do not use female pronouns for this patient.",
    ].join("\n")
  }

  if (patientGender === "female") {
    return [
      "Patient gender/pronoun setting: female.",
      "Use female pronouns where pronouns are required: she, her, hers.",
      "Do not use male pronouns for this patient.",
    ].join("\n")
  }

  return [
    "Patient gender/pronoun setting: neutral.",
    "Avoid gendered pronouns where possible.",
    "Prefer the patient's first name or neutral wording such as 'the patient' when a pronoun would otherwise be needed.",
    "Do not infer gender from the patient's name or clinical notes.",
  ].join("\n")
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing OPENAI_API_KEY.",
        },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))

    const providerId = cleanString(body.providerId)
    const patientName = cleanString(body.patientName)
    const patientFirstName = cleanString(body.patientFirstName) || patientName
    const patientDob = cleanString(body.patientDob)
    const patientGender = body.patientGender
    const referrerName = cleanString(body.referrerName)
    const referrerAddress = cleanString(body.referrerAddress)
    const reportType = cleanString(body.reportType)
    const clinicalNotes = cleanString(body.clinicalNotes)
    const preferredExampleId = cleanString(body.preferredExampleId)
    const temporaryRulesText = cleanString(body.temporaryRulesText)

    if (!patientName && !patientFirstName) {
      return NextResponse.json(
        {
          success: false,
          error: "Patient name is required.",
        },
        { status: 400 }
      )
    }

    if (!clinicalNotes) {
      return NextResponse.json(
        {
          success: false,
          error: "Clinical notes are required.",
        },
        { status: 400 }
      )
    }

    const finalReportType = reportType || "consultation_report"
    const finalPatientGender = normalisePatientGender(patientGender)
    const genderInstruction = getGenderInstruction(finalPatientGender)

    const exactFirstName = patientFirstName || patientName

    const clinicalScenario = await detectClinicalScenario(
      clinicalNotes,
      finalReportType
    )

    const scenarioTags = getScenarioTagsFromClinicalScenario(clinicalScenario)

    const training = await getProviderTraining(
      providerId || null,
      finalReportType,
      scenarioTags,
      preferredExampleId || null
    )

    const reportTypeLabel = getReportTypeLabel(finalReportType)
    const reportFormattingInstruction = getReportFormattingInstruction(finalReportType)
    const scenarioText = formatClinicalScenario(clinicalScenario)

    const prompt = `
You are an AI specialist dental report writing assistant.

Write a polished specialist dental ${reportTypeLabel}.

The report must:
- CRITICAL: The exact patient first name is "${exactFirstName}". Use this spelling exactly every time.
- Use the patient first name only in the body of the report unless the provider examples clearly use the full name.
- Never use the patient surname in the body of the report unless the provider examples clearly require it.
- Never autocorrect this name. For example, if the entered name is "Sarrah", never write "Sarah".
- Always use the exact patient first name provided in the patientFirstName field.
- Never change, infer, shorten, replace or hallucinate the patient name from clinical notes or dictation.
- Follow the supplied patient gender/pronoun setting exactly.
- Do not infer gender from the patient name, referrer name, or clinical notes.
- Be clinically professional and concise.
- Use Australian English.
- Use correct dental and medical terminology.
- Avoid inventing facts that are not in the clinical notes.
- Use plain text paragraphs for normal report content.
- Markdown formatting is not permitted except for Markdown tables.
- IMPORTANT TABLE RULE: When the current clinical notes contain clearly tabular or comparative clinical data, automatically format it as a Markdown table using pipes and a separator row.
- The Markdown table must not be wrapped in a code block.
- Do not include a signature block.
- Do not include "Warm regards" unless it is clearly part of the requested content.
- Follow universal report rules.
- Follow provider-specific report rules.
- Follow learnt provider behaviours, preferred phrases and template blocks.
- Use the terminology replacement rules exactly.
- Use the detected clinical scenario to choose the closest matching provider example structure.
- If the detected scenario says a detail is false, do not mention that detail as if it happened.
- If the detected scenario says a detail is unclear or not stated, do not invent it.

Provider example rules:
- Provider examples are important guides for tone, brevity, sequencing, wording style, and paragraph structure.
- Provider examples override only generic writing behaviour; they do NOT override manual rules, report-type formatting instructions, or sufficiently supported learned provider behaviours.
- Match the style of the examples as closely as possible where it does not conflict with higher-priority rules.
- If the examples are concise and template-like, the generated letter should also be concise and template-like.
- Prefer the same overall length as the examples.
- Do not add extra narrative, radiographic interpretation, consent discussions, or explanatory detail unless the examples include them.
- Use the examples as a strong style guide, but obey the rule hierarchy below.
- Use the clinical notes only to determine the clinical facts and which example structure is most appropriate.
- If a preferred example was selected, follow that example's structure most closely unless it conflicts with a higher-priority formatting or provider rule.
- IMPORTANT: If a manual rule, report-type formatting instruction, or learned provider behaviour says the treatment plan must be narrative prose, do not copy numbering or bullets from an example.
- Avoid generic AI-style explanatory writing.
- Avoid expanding sections unnecessarily.
- Provider examples must not prevent the use of a table when the current clinical notes contain clearly tabular data.
- Provider examples must never supply patient-specific dates, measurements, percentages, tooth numbers, medications, diagnoses, or treatment details.

Clinical data table rules:
- Recognise data as tabular when it contains two or more dates, visits, stages, categories, or comparison periods together with repeated measurements or labels and a value for each period.
- Automatically convert clearly tabular or comparative clinical data into a Markdown table.
- Use this exact Markdown table structure:

| Column heading | Column heading | Column heading |
| --- | --- | --- |
| Row value | Row value | Row value |

- Do not wrap the table in a Markdown code fence.
- Use a single header row followed immediately by the separator row.
- Keep ordinary clinical narrative outside the table.
- Preserve every supplied heading, date, stage, measurement label, number, percentage, symbol, and value exactly as written in the current clinical notes.
- Do not alter, round, reinterpret, summarise, replace, or omit table values merely to make the report shorter.
- Do not invent missing table cells or values.
- If a value is genuinely missing or unclear, preserve the row but leave the relevant cell blank.
- If the same table data appears more than once in the clinical notes, include it only once.
- Choose the table orientation that best represents the source data. For repeated measurements across dates or visits, use the measurement names as rows and the dates or visits as columns unless the provider examples clearly require the opposite orientation.
- Tables are the only permitted Markdown formatting.
- All patient-specific table content must come exclusively from the current clinical notes, never from provider examples, learned examples, template blocks, or prior reports.

Provider knowledge rules and hierarchy:
- Follow this priority order when instructions conflict:
  1. Current clinical facts and patient safety/accuracy.
  2. Manual universal/provider report rules and the report-type formatting instruction.
  3. Sufficiently supported learned provider behaviours from provider_behaviours and provider_knowledge.
  4. Preferred phrases and template blocks.
  5. Provider example formatting and style.
  6. Generic writing behaviour.
- Learned behaviours explain reusable provider preferences.
- High-confidence repeated formatting, structure, and treatment-plan behaviours must be followed even when an older provider example uses a different format.
- Preferred phrases are important. Use them when the clinical situation matches.
- Template blocks are important. Use the same block structure when the clinical situation matches.
- If a learned behaviour conflicts with a manual rule or report-type formatting instruction, follow the manual/report-type rule.
- If a preferred phrase conflicts with the clinical notes, do not use it.
- If a template block requires facts not in the clinical notes, adapt it without inventing facts.

Patient details:
Patient full name: ${patientName || exactFirstName || ""}
Patient first name: ${exactFirstName || ""}
Patient DOB: ${patientDob || "Not provided"}
Patient gender/pronoun setting: ${finalPatientGender}

Pronoun instructions:
${genderInstruction}

Referrer details:
Referrer name: ${referrerName || "Not provided"}
Referrer address:
${referrerAddress || "Not provided"}

Report type:
${reportTypeLabel}

Report-type formatting instruction:
${reportFormattingInstruction}

Detected clinical scenario:
${scenarioText}

Detected scenario tags:
${scenarioTags.length > 0 ? scenarioTags.join(", ") : "No scenario tags detected"}

Universal and provider-specific report rules:
${training.rulesText}

Learned provider behaviours, preferred phrases and template blocks:
${training.providerKnowledgeText}

Temporary training-loop or preview rules:
${temporaryRulesText || "No temporary training-loop rules."}

Provider-specific terminology preferences:
${training.terminologyText}

Provider example letters for style and structure only:
${training.examplesText}

Clinical notes:
${clinicalNotes}

Now write the final report body only.
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.12,
      messages: [
        {
          role: "system",
          content:
            "You write specialist dental reports. You closely follow provider examples, manual rules, sufficiently supported learned behaviours, preferred phrases, template blocks, terminology preferences, and detected clinical scenario information. You do not invent clinical facts. You use the supplied patient first name only unless examples clearly require the full name. You follow the supplied patient gender/pronoun setting exactly and do not infer gender from names. When the current clinical notes contain clearly tabular or comparative data, you automatically format that data as a valid Markdown table without a code fence, while keeping all other report content as plain text.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    })

    const rawReport = completion.choices[0]?.message?.content?.trim() || ""
    const report = rawReport
      ? await enforceExactPatientFirstName(
          rawReport,
          exactFirstName || patientName,
          patientName
        )
      : ""

    if (!report) {
      return NextResponse.json(
        {
          success: false,
          error: "No report was generated.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      report,
      clinicalScenario,
      scenarioTags,
      debug: {
        providerId,
        reportType: finalReportType,
        reportTypeLabel,
        reportFormattingInstruction,
        patientGender: finalPatientGender,
        preferredExampleId: preferredExampleId || null,
        temporaryRulesText,
        scenarioTags,
        selectedExamples: training.exampleDebug,
        rulesUsed: training.rulesText,
        providerKnowledgeUsed: training.providerKnowledgeText,
        terminologyUsed: training.terminologyText,
        examplesUsed: training.examplesText,
      },
    })
  } catch (error) {
    console.error("Generate report failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate report.",
      },
      { status: 500 }
    )
  }
}
