import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = cleanString(body.sessionId);
    const providerId = cleanString(body.providerId);
    const currentNote = cleanString(body.currentNote);
    const structuredData = body.structuredData || {};

    if (!sessionId || !providerId) {
      return NextResponse.json(
        { success: false, error: "Missing sessionId or providerId." },
        { status: 400 },
      );
    }

    if (!currentNote) {
      return NextResponse.json(
        { success: false, error: "Missing current clinical note." },
        { status: 400 },
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content:
            "You update dental clinical notes using clinician-edited structured findings. Do not invent facts.",
        },
        {
          role: "user",
          content: `
Update this clinical note using the structured findings.

Rules:
- Do not invent new findings.
- Treatment plans may be included only if present in the structured data or already supported in the note.
- Do not propose or suggest an AI treatment plan.
- Keep the provider's style.
- Preserve useful existing information.
- Update only sections affected by the structured data.
- Return only the updated clinical note.

Current note:
${currentNote}

Clinician-reviewed structured findings:
${JSON.stringify(structuredData, null, 2)}
`,
        },
      ],
    });

    const updatedNote = completion.choices[0]?.message?.content?.trim() || "";

    if (!updatedNote) {
      return NextResponse.json(
        { success: false, error: "AI returned an empty updated note." },
        { status: 500 },
      );
    }

    const updateResult = await supabase
      .from("clinical_scribe_sessions")
      .update({
        structured_data: structuredData,
        edited_note: updatedNote,
        status: "generated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("provider_id", providerId);

    if (updateResult.error) {
      return NextResponse.json(
        { success: false, error: updateResult.error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      note: updatedNote,
    });
  } catch (error) {
    console.error("Update clinical scribe note error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update clinical note.",
      },
      { status: 500 },
    );
  }
}