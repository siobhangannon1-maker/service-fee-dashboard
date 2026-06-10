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

function hasStructuredData(data: any) {
  if (!data || typeof data !== "object") return false;

  return Object.values(data).some((value) =>
    String(value ?? "").trim(),
  );
}

function formatStructuredData(data: any) {
  if (!data || typeof data !== "object") {
    return "No structured clinical data entered.";
  }

  return [
    `Chief concern: ${cleanString(data.chiefConcern) || "Not entered"}`,
    `Diagnosis: ${cleanString(data.diagnosis) || "Not entered"}`,
    `Periodontal stage/grade: ${cleanString(data.stageGrade) || "Not entered"}`,
    `Probing depths summary: ${cleanString(data.probingDepthsSummary) || "Not entered"}`,
    `Bleeding on probing: ${cleanString(data.bopScore) || "Not entered"}`,
    `Suppuration: ${cleanString(data.suppuration) || "Not entered"}`,
    `Mobility: ${cleanString(data.mobility) || "Not entered"}`,
    `Furcation involvement: ${cleanString(data.furcation) || "Not entered"}`,
    `Recession: ${cleanString(data.recession) || "Not entered"}`,
    `Plaque/calculus: ${cleanString(data.plaqueCalculus) || "Not entered"}`,
    `Radiographic findings: ${cleanString(data.radiographicFindings) || "Not entered"}`,
    `Risk factors: ${cleanString(data.riskFactors) || "Not entered"}`,
    `Treatment discussed: ${cleanString(data.treatmentDiscussed) || "Not entered"}`,
    `Consent/risk discussion: ${cleanString(data.consentDiscussion) || "Not entered"}`,
    `Plan: ${cleanString(data.plan) || "Not entered"}`,
  ].join("\n");
}

async function getProviderTraining(providerId: string, appointmentType: string) {
  const [appointmentTypeResult, rulesResult, examplesResult, terminologyResult] =
    await Promise.all([
      supabase
        .from("provider_scribe_appointment_types")
        .select("type_key, label, default_template")
        .eq("provider_id", providerId)
        .eq("type_key", appointmentType)
        .maybeSingle(),

      supabase
        .from("provider_scribe_rules")
        .select("appointment_type, rule_text")
        .eq("provider_id", providerId)
        .in("appointment_type", [appointmentType, "all"]),

      supabase
        .from("provider_scribe_examples")
        .select("title, appointment_type, example_note, is_preferred, created_at")
        .eq("provider_id", providerId)
        .eq("appointment_type", appointmentType)
        .order("is_preferred", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5),

      supabase
        .from("provider_terminology_rules")
        .select("spoken_or_written_text, preferred_text")
        .eq("provider_id", providerId),
    ]);

  if (appointmentTypeResult.error) {
    console.error("Scribe appointment type lookup error:", appointmentTypeResult.error);
  }

  if (rulesResult.error) {
    console.error("Scribe rules lookup error:", rulesResult.error);
  }

  if (examplesResult.error) {
    console.error("Scribe examples lookup error:", examplesResult.error);
  }

  if (terminologyResult.error) {
    console.error("Terminology lookup error:", terminologyResult.error);
  }

  const templateText =
    appointmentTypeResult.data?.default_template?.trim() ||
    [
      "Use these headings where relevant:",
      "",
      "Reason for attendance:",
      "History:",
      "Clinical findings:",
      "Periodontal findings:",
      "Radiographic findings:",
      "Diagnosis:",
      "Discussion:",
      "Treatment options:",
      "Risks/consent:",
      "Plan:",
    ].join("\n");

  const rulesText =
    rulesResult.data && rulesResult.data.length > 0
      ? rulesResult.data
          .map((rule, index) => `${index + 1}. ${rule.rule_text}`)
          .join("\n")
      : "No provider-specific scribe rules saved.";

  const examplesText =
    examplesResult.data && examplesResult.data.length > 0
      ? examplesResult.data
          .map((example, index) =>
            [
              `Example ${index + 1}: ${example.title || "Untitled"}`,
              `Appointment type: ${example.appointment_type}`,
              `Preferred: ${example.is_preferred ? "yes" : "no"}`,
              example.example_note,
            ].join("\n"),
          )
          .join("\n\n---\n\n")
      : "No provider-specific scribe examples saved.";

  const terminologyText =
    terminologyResult.data && terminologyResult.data.length > 0
      ? terminologyResult.data
          .map(
            (item, index) =>
              `${index + 1}. Replace "${item.spoken_or_written_text}" with "${item.preferred_text}"`,
          )
          .join("\n")
      : "No provider terminology preferences saved.";

  return {
    templateText,
    rulesText,
    examplesText,
    terminologyText,
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

    const providerId = cleanString(body.providerId);
    const patientFirstName = cleanString(body.patientFirstName);
    const patientLastName = cleanString(body.patientLastName);
    const patientDob = cleanString(body.patientDob);
    const praktikaPatientId = cleanString(body.praktikaPatientId);
    const appointmentType =
      cleanString(body.appointmentType) || "periodontal_consultation";
    const transcript = cleanString(body.transcript);
    const structuredData = body.structuredData || {};

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 },
      );
    }

    if (!patientFirstName || !patientLastName) {
      return NextResponse.json(
        { success: false, error: "Patient first and last name are required." },
        { status: 400 },
      );
    }

    if (!transcript && !hasStructuredData(structuredData)) {
      return NextResponse.json(
        {
          success: false,
          error: "Enter a transcript or structured clinical data first.",
        },
        { status: 400 },
      );
    }

    const training = await getProviderTraining(providerId, appointmentType);
    const structuredDataText = formatStructuredData(structuredData);

    const prompt = `
You are an expert periodontal and oral and maxillofacial surgery clinical scribe.

Generate a clinical note for the patient's record.

Important rules:
- Do not invent clinical facts.
- Do not infer unstated findings.
- If something is not stated, omit it unless the provider template specifically requires a heading.
- Use Australian English.
- Use concise clinical language.
- Use FDI tooth numbering.
- Do not write a referral letter.
- Do not include a greeting.
- Do not include a signature block.
- Do not include markdown tables.
- This note will be reviewed and edited by the clinician before upload.
- Give priority to structured clinical data over the transcript if they conflict.
- Preserve provider style and terminology preferences.
- Use the provider clinical note template as the main structure.
- If the provider template is incomplete, use sensible clinical note headings appropriate to the appointment type.

Patient:
${patientFirstName} ${patientLastName}
DOB: ${patientDob || "Not entered"}
Praktika patient ID: ${praktikaPatientId || "Not selected"}

Appointment type:
${appointmentType}

Provider clinical note template:
${training.templateText}

Provider scribe rules:
${training.rulesText}

Provider terminology:
${training.terminologyText}

Provider example notes:
${training.examplesText}

Consultation transcript:
${transcript || "No transcript provided."}

Structured clinical data:
${structuredDataText}

Generate the clinical note now.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You generate accurate dental clinical notes from transcripts, templates and structured data. You never invent facts.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const note = completion.choices[0]?.message?.content?.trim() || "";

    if (!note) {
      return NextResponse.json(
        { success: false, error: "AI returned an empty note." },
        { status: 500 },
      );
    }

    const insertResult = await supabase
      .from("clinical_scribe_sessions")
      .insert({
        provider_id: providerId,
        patient_first_name: patientFirstName,
        patient_last_name: patientLastName,
        patient_dob: patientDob || null,
        praktika_patient_id: praktikaPatientId || null,
        appointment_type: appointmentType,
        transcript,
        structured_data: structuredData,
        ai_generated_note: note,
        edited_note: note,
        status: "generated",
      })
      .select("id")
      .single();

    if (insertResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: insertResult.error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      sessionId: insertResult.data.id,
      note,
    });
  } catch (error) {
    console.error("Generate clinical scribe note error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate clinical note.",
      },
      { status: 500 },
    );
  }
}