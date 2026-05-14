import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing OPENAI_API_KEY." },
        { status: 500 }
      )
    }

    const formData = await req.formData()
    const audio = formData.get("audio")

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No audio file provided." },
        { status: 400 }
      )
    }

    console.log("Audio received:", {
      name: audio.name,
      type: audio.type,
      size: audio.size,
    })

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: "gpt-4o-transcribe",
      language: "en",
      prompt:
        "Specialist dental dictation. Use Australian English. Convert spoken punctuation such as comma, full stop, period, new paragraph, colon, semicolon, open bracket, close bracket into punctuation. Common terms include periodontal, osseointegration, periapical, radiolucency, suppuration, leukoplakia, mucosa, probing depths, implant, extraction, CBCT, OPG, mobility, furcation, gingival, palatal, vestibular, maxillofacial.",
    })

    return NextResponse.json({
      success: true,
      text: transcription.text,
    })
  } catch (error: any) {
    console.error("Transcription failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Failed to transcribe audio. Check terminal logs.",
      },
      { status: 500 }
    )
  }
}