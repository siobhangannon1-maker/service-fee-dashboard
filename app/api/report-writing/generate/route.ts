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
  editLearningText: string
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

  if (!providerId) {
    return {
      rulesText:
        universalRules.length > 0
          ? universalRules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")
          : "No report rules saved.",
      terminologyText: "No provider-specific terminology rules saved.",
      examplesText: "No provider-specific examples saved.",
      editLearningText: "No provider-specific edit examples saved.",
      exampleDebug: [],
    }
  }

  const [rulesResult, terminologyResult, examplesResult, editExamplesResult] =
    await Promise.all([
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
        .limit(30),

      supabase
        .from("provider_report_edit_examples")
        .select("report_type, original_text, final_text")
        .eq("provider_id", providerId)
        .eq("report_type", reportType)
        .order("created_at", { ascending: false })
        .limit(5),
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
    .slice(0, safePreferredExampleId ? 6 : 5)

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

  const editLearningText =
    editExamplesResult.data && editExamplesResult.data.length > 0
      ? editExamplesResult.data
          .map((example, index) => {
            return [
              `Provider edit example ${index + 1}:`,
              "Original AI version:",
              example.original_text,
              "Final provider-approved version:",
              example.final_text,
            ].join("\n")
          })
          .join("\n\n---\n\n")
      : "No provider-specific edit examples saved."

  return {
    rulesText,
    terminologyText,
    examplesText,
    editLearningText,
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

function getReportTypeLabel(reportType: string) {
  const labels: Record<string, string> = {
    consultation_report: "consultation report",
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

function normaliseClinicalScenario(value: Partial<ClinicalScenario> | null | undefined, reportType: string): ClinicalScenario {
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
    const patientFirstName = cleanString(body.patientFirstName)
    const patientDob = cleanString(body.patientDob)
    const patientGender = body.patientGender
    const referrerName = cleanString(body.referrerName)
    const referrerAddress = cleanString(body.referrerAddress)
    const reportType = cleanString(body.reportType)
    const clinicalNotes = cleanString(body.clinicalNotes)
    const preferredExampleId = cleanString(body.preferredExampleId)

    if (!patientName) {
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
    const scenarioText = formatClinicalScenario(clinicalScenario)

    const prompt = `
You are an AI specialist dental report writing assistant.

Write a polished specialist dental ${reportTypeLabel}.

The report must:
- Always use the exact patient first name provided in the patientFirstName field.
- Never change, infer, shorten, replace or hallucinate the patient name from clinical notes or dictation.
- Follow the supplied patient gender/pronoun setting exactly.
- Do not infer gender from the patient name, referrer name, or clinical notes.
- Be clinically professional and concise.
- Use Australian English.
- Use correct dental and medical terminology.
- Avoid inventing facts that are not in the clinical notes.
- Do not include markdown formatting.
- Do not include a signature block.
- Do not include "Warm regards" unless it is clearly part of the requested content.
- Follow universal report rules.
- Follow provider-specific report rules.
- Use the terminology replacement rules exactly.
- Use the detected clinical scenario to choose the closest matching provider example structure.
- If the detected scenario says a detail is false, do not mention that detail as if it happened.
- If the detected scenario says a detail is unclear or not stated, do not invent it.

Provider example rules:
- The provider examples are EXTREMELY important.
- Provider examples override generic writing behaviour.
- Match the style of the examples as closely as possible.
- Closely follow the structure, brevity, sequencing, wording style, paragraph structure, and treatment-plan format of the provider examples.
- If the examples are concise and template-like, the generated letter must also be concise and template-like.
- Prefer the same overall length as the examples.
- Do not add extra narrative, radiographic interpretation, consent discussions, or explanatory detail unless the examples include them.
- Use the examples as the primary guide for writing style.
- Use the clinical notes only to determine the clinical facts and which example structure is most appropriate.
- If a preferred example was selected, follow that example's structure most closely.
- If examples use short paragraphs and numbered treatment plans, use that structure.
- Avoid generic AI-style explanatory writing.
- Avoid expanding sections unnecessarily.

Provider-specific learning rules:
- Learn from the provider-specific edit examples by imitating the final approved style.
- Avoid patterns that were removed from the original AI versions.

Patient details:
Patient full name: ${patientName || ""}
Patient first name: ${patientFirstName || patientName || ""}
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

Detected clinical scenario:
${scenarioText}

Detected scenario tags:
${scenarioTags.length > 0 ? scenarioTags.join(", ") : "No scenario tags detected"}

Universal and provider-specific report rules:
${training.rulesText}

Provider-specific terminology preferences:
${training.terminologyText}

Provider example letters for style and structure only:
${training.examplesText}

Provider-specific learning from previously edited/approved reports:
${training.editLearningText}

Clinical notes:
${clinicalNotes}

Now write the final report body only.
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content:
            "You write specialist dental reports. You must closely follow the provider's examples for structure, brevity, sequencing, paragraph style, and tone. You follow universal rules, provider-specific rules, terminology preferences, detected clinical scenario information, and provider-specific edit-learning examples carefully. You do not invent clinical facts. You follow the supplied patient gender/pronoun setting exactly and do not infer gender from names.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    })

    const report = completion.choices[0]?.message?.content?.trim()

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
        patientGender: finalPatientGender,
        preferredExampleId: preferredExampleId || null,
        scenarioTags,
        selectedExamples: training.exampleDebug,
        rulesUsed: training.rulesText,
        terminologyUsed: training.terminologyText,
        examplesUsed: training.examplesText,
        editLearningUsed: training.editLearningText,
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