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
}

async function getProviderTraining(
  providerId: string | null,
  reportType: string
): Promise<TrainingData> {
  const universalRulesResult = await supabase
    .from("universal_report_rules")
    .select("report_type, rule_text")
    .in("report_type", [reportType, "all"])

  if (!providerId) {
    const universalRules =
      universalRulesResult.data && universalRulesResult.data.length > 0
        ? universalRulesResult.data.map((rule) => rule.rule_text)
        : []

    return {
      rulesText:
        universalRules.length > 0
          ? universalRules
              .map((rule, index) => `${index + 1}. ${rule}`)
              .join("\n")
          : "No report rules saved.",
      terminologyText: "No provider-specific terminology rules saved.",
      examplesText: "No provider-specific examples saved.",
      editLearningText: "No provider-specific edit examples saved.",
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
        .select("report_type, title, example_text")
        .eq("provider_id", providerId)
        .eq("report_type", reportType)
        .order("created_at", { ascending: false })
        .limit(3),

      supabase
        .from("provider_report_edit_examples")
        .select("report_type, original_text, final_text")
        .eq("provider_id", providerId)
        .eq("report_type", reportType)
        .order("created_at", { ascending: false })
        .limit(3),
    ])

  const universalRules =
    universalRulesResult.data && universalRulesResult.data.length > 0
      ? universalRulesResult.data.map((rule) => rule.rule_text)
      : []

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

  const examplesText =
    examplesResult.data && examplesResult.data.length > 0
      ? examplesResult.data
          .map((example, index) => {
            return [
              `Example ${index + 1}: ${example.title || "Untitled"}`,
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
              `Original AI version:`,
              example.original_text,
              `Final provider-approved version:`,
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

    const body = await req.json()

    const {
      providerId,
      patientName,
      patientFirstName,
      patientDob,
      referrerName,
      referrerAddress,
      reportType,
      clinicalNotes,
    } = body

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

    const training = await getProviderTraining(
      providerId || null,
      finalReportType
    )

    const reportTypeLabel = getReportTypeLabel(finalReportType)

    const prompt = `
You are an AI specialist dental report writing assistant.

Write a polished specialist dental ${reportTypeLabel}.

The report must:
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
- Use the example letters only as style guidance, not as patient facts.
- Learn from the provider-specific edit examples by imitating the final approved style and avoiding patterns that were removed from the original AI versions.

Patient details:
Patient full name: ${patientName || ""}
Patient first name: ${patientFirstName || patientName || ""}
Patient DOB: ${patientDob || "Not provided"}

Referrer details:
Referrer name: ${referrerName || "Not provided"}
Referrer address:
${referrerAddress || "Not provided"}

Report type:
${reportTypeLabel}

Universal and provider-specific report rules:
${training.rulesText}

Provider-specific terminology preferences:
${training.terminologyText}

Provider example letters for style only:
${training.examplesText}

Provider-specific learning from previously edited/approved reports:
${training.editLearningText}

Clinical notes:
${clinicalNotes}

Now write the final report body only.
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You write specialist dental reports. You follow universal rules, provider-specific rules, terminology preferences, supplied examples, and provider-specific edit-learning examples carefully. You do not invent clinical facts.",
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