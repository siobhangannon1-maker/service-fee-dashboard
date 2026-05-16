import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const { providerId, dictatedText, reportType } = body

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    if (!dictatedText) {
      return NextResponse.json(
        { success: false, error: "Missing dictated text." },
        { status: 400 }
      )
    }

    const finalReportType = reportType || "consultation_report"

    const extractionPrompt = `
Extract structured information from this dictated dental report instruction.

Return JSON only with:
{
  "patientFirstName": "",
  "patientLastName": "",
  "patientDob": "",
  "clinicalNotes": ""
}

Rules:
- Extract patient name if present.
- Extract DOB only if clearly mentioned.
- Keep all findings, diagnoses, treatment plan and relevant instructions in clinicalNotes.
- Do not invent missing information.
- Do not decide the report type. The provider has already selected it.

Dictation:
${dictatedText}
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You extract structured report-writing data from dictated specialist dental instructions. Return valid JSON only.",
        },
        {
          role: "user",
          content: extractionPrompt,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim() || "{}"
    const parsed = JSON.parse(raw)

    const patientFirstName = String(parsed.patientFirstName || "").trim()
    const patientLastName = String(parsed.patientLastName || "").trim()
    const patientName = `${patientFirstName} ${patientLastName}`.trim()

    const generateResponse = await fetch(
      `${new URL(req.url).origin}/api/report-writing/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientName,
          patientFirstName,
          patientDob: parsed.patientDob || "",
          reportType: finalReportType,
          clinicalNotes: parsed.clinicalNotes || dictatedText,
        }),
      }
    )

    const generateData = await generateResponse.json()

    if (!generateData.success) {
      return NextResponse.json(
        {
          success: false,
          error: generateData.error || "Failed to generate report.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      patientFirstName,
      patientLastName,
      patientDob: parsed.patientDob || "",
      reportType: finalReportType,
      clinicalNotes: parsed.clinicalNotes || dictatedText,
      report: generateData.report,
      dictatedText,
    })
  } catch (error) {
    console.error("Smart dictate failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Smart dictate failed.",
      },
      { status: 500 }
    )
  }
}