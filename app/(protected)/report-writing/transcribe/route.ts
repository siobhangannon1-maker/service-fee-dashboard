import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const audio = formData.get("audio")

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No audio file provided." },
        { status: 400 }
      )
    }

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: "gpt-4o-transcribe",
      language: "en",
      prompt:
        "Specialist dental dictation. Use correct punctuation. Convert spoken punctuation such as comma, full stop, new paragraph, colon, semicolon, and brackets into punctuation. Use Australian English. Common terms include periodontal, osseointegration, periapical, radiolucency, suppuration, leukoplakia, mucosa, probing depths, implant, extraction, CBCT, OPG, mobility, furcation, gingival, palatal, vestibular, maxillofacial.",
    })

    return NextResponse.json({
      success: true,
      text: transcription.text,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { success: false, error: "Failed to transcribe audio." },
      { status: 500 }
    )
  }
}