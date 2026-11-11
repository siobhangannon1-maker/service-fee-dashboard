import { ApiAuthorizationError, sensitiveApiAccess } from "@/lib/auth";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

import {
  DictationUploadError,
  DICTATION_MAX_BYTES,
} from "@/lib/report-writing/dictation-upload-contract";
import {
  boundedJson,
  referenceFor,
  retrieveDictationAudio,
  sameOrigin,
} from "@/lib/report-writing/dictation-upload-server";

export const runtime = "nodejs";
export const maxDuration = 300;

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

function buildPatientNameInstruction(
  patientFirstName: string,
  patientLastName: string,
) {
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
  const accessDenied = await sensitiveApiAccess(
    "/api/report-writing/transcribe",
  );
  if (accessDenied) return accessDenied;

  const storageBacked =
    req.headers.get("content-type")?.includes("application/json") === true;
  try {
    const deadline = storageBacked ? AbortSignal.timeout(270_000) : undefined;
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing OPENAI_API_KEY." },
        { status: 500 },
      );
    }

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        { success: false, error: "Missing Supabase environment variables." },
        { status: 500 },
      );
    }

    let audio: File;
    let patientFirstName: string;
    let patientLastName: string;
    if (storageBacked) {
      sameOrigin(req);
      const reference = await referenceFor(await boundedJson(req));
      audio = await retrieveDictationAudio(reference);
      patientFirstName = reference.context.patientFirstName;
      patientLastName = reference.context.patientLastName;
    } else {
      // Preserve existing callers, including Smart Dictate, while Provider Letters switches to references.
      const formData = await req.formData();
      const file = formData.get("audio") || formData.get("file");
      if (!(file instanceof File))
        return NextResponse.json(
          { success: false, error: "No audio file provided." },
          { status: 400 },
        );
      audio = file;
      patientFirstName = String(formData.get("patientFirstName") || "").trim();
      patientLastName = String(formData.get("patientLastName") || "").trim();
    }
    if (storageBacked && audio.size > DICTATION_MAX_BYTES)
      throw new DictationUploadError(
        "AUDIO_TOO_LARGE",
        "The recording exceeds the 24 MB limit. Keep or download the recording; it has not been transcribed.",
        413,
      );

    const universalRules = await loadUniversalRules();
    const patientNameInstruction = buildPatientNameInstruction(
      patientFirstName,
      patientLastName,
    );

    const transcription = await openai.audio.transcriptions.create(
      {
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
      },
      storageBacked ? { signal: deadline, maxRetries: 0 } : undefined,
    );

    const rawText = transcription.text || "";

    if (storageBacked && !rawText.trim())
      throw new DictationUploadError(
        "EMPTY_TRANSCRIPT",
        "No speech was returned. Your recording is retained; retry or download it.",
        422,
      );

    const cleanup = await openai.chat.completions.create(
      {
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
      },
      storageBacked ? { signal: deadline, maxRetries: 0 } : undefined,
    );

    const cleanedText = cleanup.choices[0]?.message?.content?.trim() || rawText;

    return NextResponse.json(
      {
        success: true,
        text: cleanedText,
        rawText,
        rulesApplied: universalRules,
        patientFirstName,
        patientLastName,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known =
      error instanceof DictationUploadError ||
      error instanceof ApiAuthorizationError;
    return NextResponse.json(
      {
        success: false,
        code:
          error instanceof DictationUploadError
            ? error.code
            : "TRANSCRIPTION_FAILED",
        error: known
          ? error.message
          : storageBacked
            ? "Transcription did not complete. Your recording has been kept. Retry transcription or download the recording."
            : "Transcription did not complete. Please try again.",
      },
      {
        status: known ? error.status : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
