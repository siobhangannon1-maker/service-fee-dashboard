import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

async function getTemplateAndRules({
  providerId,
  sessionId,
}: {
  providerId: string;
  sessionId: string;
}) {
  const sessionResult = await supabase
    .from("clinical_scribe_sessions")
    .select("appointment_type")
    .eq("id", sessionId)
    .eq("provider_id", providerId)
    .single();

  if (sessionResult.error) {
    throw new Error(sessionResult.error.message);
  }

  const appointmentType = sessionResult.data.appointment_type;

  const [
    templateResult,
    universalRulesResult,
    providerRulesResult,
    terminologyResult,
  ] = await Promise.all([
    supabase
      .from("provider_scribe_appointment_types")
      .select("default_template")
      .eq("provider_id", providerId)
      .eq("type_key", appointmentType)
      .maybeSingle(),

    supabase
      .from("clinical_scribe_universal_rules")
      .select("rule_text")
      .in("appointment_type", [appointmentType, "all"]),

    supabase
      .from("provider_scribe_rules")
      .select("rule_text")
      .eq("provider_id", providerId)
      .in("appointment_type", [appointmentType, "all"]),

    supabase
      .from("provider_terminology_rules")
      .select("spoken_or_written_text, preferred_text")
      .eq("provider_id", providerId),
  ]);

  return {
    appointmentType,
    templateText:
      templateResult.data?.default_template ||
      "Reason for attendance:\nHistory:\nClinical findings:\nDiagnosis:\nDiscussion:\nPlan:",

    universalRulesText:
      universalRulesResult.data && universalRulesResult.data.length > 0
        ? universalRulesResult.data
            .map((rule, index) => `${index + 1}. ${rule.rule_text}`)
            .join("\n")
        : "No universal clinical scribe rules.",

    providerRulesText:
      providerRulesResult.data && providerRulesResult.data.length > 0
        ? providerRulesResult.data
            .map((rule, index) => `${index + 1}. ${rule.rule_text}`)
            .join("\n")
        : "No provider-specific rules.",

    terminologyText:
      terminologyResult.data && terminologyResult.data.length > 0
        ? terminologyResult.data
            .map(
              (item, index) =>
                `${index + 1}. Replace "${item.spoken_or_written_text}" with "${item.preferred_text}"`,
            )
            .join("\n")
        : "No terminology preferences.",
  };
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing OPENAI_API_KEY." },
        { status: 500 },
      );
    }

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

    const training = await getTemplateAndRules({
      providerId,
      sessionId,
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You are an expert dental clinical scribe. You create clinical notes by filling provider templates exactly. You do not write referral letters.",
        },
        {
          role: "user",
          content: `
Rebuild this clinical note using the provider template and clinician-reviewed structured findings.

CRITICAL FORMAT RULES:
- Use the provider template as the exact clinical note structure.
- Preserve the provider template headings exactly.
- Fill the template like a clinical note form.
- Do not write a referral letter.
- Do not use narrative referral-letter style.
- Do not include "Thank you kindly for referring".
- Do not include "Thank you again for your referral".
- Do not include "Please do not hesitate to contact me".
- Do not include a greeting.
- Do not include a sign-off.
- Do not turn the note into prose paragraphs unless the template itself uses prose.

SOURCE OF TRUTH RULES:
- Clinician-reviewed structured findings are the source of truth.
- If structured findings contain a value for a template section, replace that section completely.
- Do not merge old and new values for the same section.
- Remove old section content when it conflicts with structured findings.
- Do not preserve old content in a section when new structured data has been provided for that section.
- The existing note is only a source of background clinical facts.
- The existing note is not the source of truth for sections represented in structured findings.
- The existing note is not a style guide.

PROGNOSIS REPLACEMENT RULES:
- For the Prognosis section, rebuild Mx and Md from the current structured prognosis data only.
- Do not preserve old Mx or Md prognosis entries from the existing note.
- Remove any previous Mx or Md prognosis entries that are not present in the current structured data.
- Teeth 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28 are maxillary teeth and must be listed under Mx.
- Teeth 31, 32, 33, 34, 35, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48 are mandibular teeth and must be listed under Md.
- If a prognosis is recorded for tooth 15, write it under Mx, never Md.
- If a prognosis is recorded for tooth 16, write it under Mx, never Md.
- Do not place maxillary teeth under Md.
- Do not place mandibular teeth under Mx.

SAFETY RULES:
- If a section is unknown or not discussed, leave it blank or write "Not recorded" only where clinically useful.
- Treatment Plan lines are placeholders only. Fill them only if supported by the consultation or structured findings.
- Do not invent findings.
- Do not invent diagnoses.
- Do not invent risks.
- Do not invent consent.
- Do not invent treatment plans.
- Treatment plans may be inferred from the conversation only when clearly supported.
- Do not propose AI-generated treatment.

Universal rules:
${training.universalRulesText}

Provider-specific rules:
${training.providerRulesText}

Provider terminology:
${training.terminologyText}

Appointment type:
${training.appointmentType}

Provider template:
${training.templateText}

Clinician-reviewed structured findings:
${JSON.stringify(structuredData, null, 2)}

Existing note to use only as a source of background clinical facts, NOT as a style guide and NOT as the source of truth for any section represented in structured findings:
${currentNote}

Return only the rebuilt clinical note.
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