import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
);

async function loadUniversalRules() {
  const { data, error } = await supabase
    .from("universal_report_rules")
    .select("report_type, rule_text")
    .in("report_type", ["all", "dictated_letter"])
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load universal rules:", error);
    return "";
  }

  return (data || [])
    .map((rule) => `- [${rule.report_type}] ${rule.rule_text}`)
    .join("\n");
}

function buildPatientNameInstruction(patientFirstName: string, patientLastName: string) {
  if (!patientFirstName && !patientLastName) {
    return "No patient name was provided by the app.";
  }

  return `
Exact patient details entered in the app:
Patient first name: ${patientFirstName || "Not provided"}
Patient last name: ${patientLastName || "Not provided"}

CRITICAL PATIENT NAME RULE:
- The app-entered patient first name is authoritative.
- If the patient first name appears or is implied in the transcript, write it exactly as: ${patientFirstName || "Not provided"}
- Never autocorrect, normalise, simplify, infer, or replace the patient first name.
- Do not change unusual spellings.
- Example: if the app-entered name is "Jaynne", never write "Jane".
- Example: if the app-entered name is "Sarrah", never write "Sarah".
- If the raw transcription contains a likely incorrect spelling of the patient's first name, replace that patient-name occurrence with the exact app-entered first name.
`.trim();
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing OPENAI_API_KEY." },
        { status: 500 },
      );
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing Supabase environment variables." },
        { status: 500 },
      );
    }

    const formData = await req.formData();
    const audio = formData.get("audio") || formData.get("file");

    const patientFirstName = String(formData.get("patientFirstName") || "").trim();
    const patientLastName = String(formData.get("patientLastName") || "").trim();

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No audio file provided." },
        { status: 400 },
      );
    }

    const universalRules = await loadUniversalRules();
    const patientNameInstruction = buildPatientNameInstruction(patientFirstName, patientLastName);

    console.log("Audio received:", {
      name: audio.name,
      type: audio.type,
      size: audio.size,
    });

    console.log("Patient details sent to transcription:", {
      patientFirstName,
      patientLastName,
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: "gpt-4o-transcribe",
      language: "en",
      prompt: `
Specialist Australian dental dictation.

Use Australian English.
Convert spoken punctuation such as full stop, comma, new paragraph, colon, semicolon, open bracket and close bracket into punctuation.

${patientNameInstruction}

Important dental terms include:
periodontal, osseointegration, periapical, radiolucency, suppuration, leukoplakia, mucosa, probing depths, implant, extraction, CBCT, OPG, mobility, furcation, gingival, palatal, vestibular, maxillofacial.

Saved app rules:
${universalRules}
`,
    });

    const rawText = transcription.text || "";

    console.log("RAW TRANSCRIPTION:", rawText);

    const cleanup = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
You are a specialist Australian dental transcription formatter.

Correct the transcript only.
Do not add new clinical information.
Do not remove clinical information.
Return only the corrected transcript.

${patientNameInstruction}

Apply these saved app rules exactly:
${universalRules}

Extra mandatory formatting:
- Convert spoken FDI tooth numbers to two-digit numerals.
- one six = 16
- one seven = 17
- two six = 26
- two seven = 27
- three six = 36
- three two = 32
- four six = 46
- four seven = 47
- Do not write one six, one-six, 1 6, or 1-6 when a tooth number is intended.
- Write clinical numbers as digits.
- Write measurements as digit + shorthand unit with no space.
- eight millimetre = 8mm
- eight millimetres = 8mm
- five percent = 5%
- Use Australian English.
`,
        },
        {
          role: "user",
          content: rawText,
        },
      ],
    });

    const cleanedText = cleanup.choices[0]?.message?.content?.trim() || rawText;

    console.log("CLEANED TRANSCRIPTION:", cleanedText);

    return NextResponse.json({
      success: true,
      text: cleanedText,
      rawText,
      rulesApplied: universalRules,
      patientFirstName,
      patientLastName,
    });
  } catch (error: any) {
    console.error("Transcription failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to transcribe audio. Check terminal logs.",
      },
      { status: 500 },
    );
  }
}