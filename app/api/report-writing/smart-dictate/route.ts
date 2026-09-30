import { generateTrainingLetter, trainingGenerationErrorResponse } from "@/lib/report-writing/training-generation";
import { sensitiveApiAccess } from "@/lib/auth";
import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const accessDenied = await sensitiveApiAccess("/api/report-writing/smart-dictate");
  if (accessDenied) return accessDenied;

  try {
    const body = await req.json()

    const {
      providerId,
      patientFirstName,
      patientLastName,
      patientName,
      patientDob,
      dictatedText,
      reportType,
    } = body

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    if (!patientFirstName || !patientLastName) {
      return NextResponse.json(
        {
          success: false,
          error: "Patient first name and last name are required.",
        },
        { status: 400 }
      )
    }

    if (!dictatedText) {
      return NextResponse.json(
        { success: false, error: "Missing dictated text." },
        { status: 400 }
      )
    }

    const finalPatientFirstName = String(patientFirstName).trim()
    const finalPatientLastName = String(patientLastName).trim()

    const finalPatientName =
      String(patientName || "").trim() ||
      `${finalPatientFirstName} ${finalPatientLastName}`.trim()

    const finalReportType = reportType || "consultation_report"

    const extractionPrompt = `
Extract clinical notes from this dictated dental report instruction.

Return JSON only with:
{
  "clinicalNotes": ""
}

Rules:
- Never extract or modify the patient name from dictation.
- The patient name has already been entered separately and is authoritative.
- Keep all findings, diagnoses, treatment plan and relevant instructions in clinicalNotes.
- Do not invent missing information.
- Do not decide the report type.

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
            "You extract clinical notes from dictated specialist dental instructions. Return valid JSON only.",
        },
        {
          role: "user",
          content: extractionPrompt,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim() || "{}"

    const parsed = JSON.parse(raw)

    const clinicalNotes = String(
      parsed.clinicalNotes || dictatedText
    ).trim()

    const report = await generateTrainingLetter(req, {
      providerId,
      patientName: finalPatientName,
      patientFirstName: finalPatientFirstName,
      patientDob: patientDob || "",
      reportType: finalReportType,
      clinicalNotes,
    })

    return NextResponse.json({
      success: true,
      patientFirstName: finalPatientFirstName,
      patientLastName: finalPatientLastName,
      patientDob: patientDob || "",
      reportType: finalReportType,
      clinicalNotes,
      report,
      dictatedText,
    })
  } catch (error) {
    const generationError = trainingGenerationErrorResponse(error);
    if (generationError) return generationError;
    console.error("Smart dictate failed.")

    return NextResponse.json(
      {
        success: false,
        error:
          "Smart dictate failed.",
      },
      { status: 500 }
    )
  }
}