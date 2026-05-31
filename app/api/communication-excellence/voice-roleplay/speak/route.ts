import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "No text provided." }, { status: 400 });
    }

    const speech = await openai.audio.speech.create({
  model: "gpt-4o-mini-tts",
  voice: "verse",
  input: text,
  instructions:
    "Use a broad but professional Australian accent, like a patient from Brisbane or Sydney. Avoid American pronunciation. Speak naturally, warmly, and slightly faster than normal. Use Australian intonation and rhythm.",
  response_format: "mp3",
});

    const audioBuffer = Buffer.from(await speech.arrayBuffer());

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not generate speech." },
      { status: 500 }
    );
  }
}