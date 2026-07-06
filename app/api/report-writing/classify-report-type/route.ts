import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

type ReportTypeOption = {
  value: string
  label: string
}

type ClassificationResult = {
  encounterType:
    | "consultation"
    | "surgical_treatment"
    | "non_surgical_treatment"
    | "review"
    | "supportive_periodontal_therapy"
    | "implant_review"
    | "post_op_review"
    | "unclear"
  reportType: string
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

function normaliseReportTypes(value: unknown): ReportTypeOption[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => ({
      value: clean(item?.value),
      label: clean(item?.label || item?.value),
    }))
    .filter((item) => item.value)
}

function pickFallbackReportType(
  availableReportTypes: ReportTypeOption[],
  fallbackReportType: string,
) {
  const availableValues = new Set(availableReportTypes.map((type) => type.value))

  if (fallbackReportType && availableValues.has(fallbackReportType)) {
    return fallbackReportType
  }

  if (availableValues.has("consultation_report")) {
    return "consultation_report"
  }

  return availableReportTypes[0]?.value || "consultation_report"
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing OPENAI_API_KEY." },
        { status: 500 },
      )
    }

    const body = await req.json()

    const providerId = clean(body.providerId)
    const clinicalNotes = clean(body.clinicalNotes)
    const appointmentNotes = clean(body.appointmentNotes)
    const fallbackReportType = clean(body.fallbackReportType)
    const availableReportTypes = normaliseReportTypes(body.availableReportTypes)

    const safeFallbackReportType = pickFallbackReportType(
      availableReportTypes,
      fallbackReportType,
    )

    if (availableReportTypes.length === 0) {
      return NextResponse.json({
        success: true,
        encounterType: "unclear",
        reportType: safeFallbackReportType,
        usedFallback: true,
      })
    }

    const availableReportTypesText = availableReportTypes
      .map((type) => `- ${type.value}: ${type.label}`)
      .join("\n")

    const fallback: ClassificationResult = {
      encounterType: "unclear",
      reportType: safeFallbackReportType,
    }

    const prompt = `
You are classifying specialist dental notes to choose the most appropriate report type.

Return JSON only. Do not return markdown.

Available report types for this provider:
${availableReportTypesText}

Fallback report type if unclear:
${safeFallbackReportType}

Important classification rules:
- Base the decision primarily on what clinically occurred during this appointment.
- Same-day clinical notes are stronger evidence than appointment labels.
- Appointment notes, treatment labels and booking labels are weak supporting evidence only.
- Ignore non-clinical/admin notes such as:
  - patient running late
  - "patient will be 5 minutes late"
  - reception notes
  - cancellation notes
  - appointment timing
  - parking/arrival notes
  - payment/admin reminders
  - fasting reminders
  - booking comments
  - internal suitability checks
- Do not classify as consultation just because the appointment was booked as a consultation.
- If a surgical procedure was completed, choose the surgical report type if available.
- If active non-surgical periodontal treatment was completed, choose the treatment/non-surgical report type if available.
- If the appointment was supportive periodontal therapy or periodontal maintenance, choose the SPT report type if available.
- If healing, sutures, postoperative status, or surgical recovery was reviewed without new surgery, choose post-op/review if available.
- If osseointegration, implant stability, implant restoration readiness, or implant review was assessed, choose the osseointegration/implant review type if available.
- If only examination, diagnosis, discussion, consent, or treatment planning occurred, choose consultation report if available.
- If clinical content is insufficient or mostly admin, return encounterType "unclear" and use the fallback report type.
- The reportType must be exactly one of the available report type values.

Encounter type must be one of:
consultation
surgical_treatment
non_surgical_treatment
review
supportive_periodontal_therapy
implant_review
post_op_review
unclear

Return this exact JSON shape:
{
  "encounterType": "consultation",
  "reportType": "consultation_report"
}

Provider ID:
${providerId || "unknown"}

Appointment / booking notes:
${appointmentNotes || "No appointment notes supplied."}

Clinical notes:
${clinicalNotes || "No clinical notes supplied."}
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You classify specialist dental clinical notes into encounter type and provider-specific report type. Return valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content || ""
    const parsed = safeJsonParse<ClassificationResult>(raw, fallback)

    const allowedEncounterTypes = new Set([
      "consultation",
      "surgical_treatment",
      "non_surgical_treatment",
      "review",
      "supportive_periodontal_therapy",
      "implant_review",
      "post_op_review",
      "unclear",
    ])

    const availableValues = new Set(availableReportTypes.map((type) => type.value))

    const encounterType = allowedEncounterTypes.has(parsed.encounterType)
      ? parsed.encounterType
      : "unclear"

    const reportType = availableValues.has(parsed.reportType)
      ? parsed.reportType
      : safeFallbackReportType

    return NextResponse.json({
      success: true,
      encounterType,
      reportType,
      usedFallback: reportType !== parsed.reportType || encounterType === "unclear",
    })
  } catch (error) {
    console.error("Classify report type failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to classify report type.",
      },
      { status: 500 },
    )
  }
}