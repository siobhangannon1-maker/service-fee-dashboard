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

async function getProviderTraining(providerId: string, appointmentType: string) {
  const [templateResult, rulesResult, examplesResult, terminologyResult, fieldsResult] =
    await Promise.all([
      supabase
        .from("provider_scribe_appointment_types")
        .select("default_template")
        .eq("provider_id", providerId)
        .eq("type_key", appointmentType)
        .maybeSingle(),

      supabase
        .from("provider_scribe_rules")
        .select("rule_text")
        .eq("provider_id", providerId)
        .in("appointment_type", [appointmentType, "all"]),

      supabase
        .from("provider_scribe_examples")
        .select("title, example_note, is_preferred")
        .eq("provider_id", providerId)
        .eq("appointment_type", appointmentType)
        .order("is_preferred", { ascending: false })
        .limit(5),

      supabase
        .from("provider_terminology_rules")
        .select("spoken_or_written_text, preferred_text")
        .eq("provider_id", providerId),

      supabase
        .from("provider_scribe_structured_fields")
        .select("field_key, label")
        .eq("provider_id", providerId)
        .eq("appointment_type", appointmentType)
        .order("display_order"),
    ]);

  return {
    templateText:
      templateResult.data?.default_template ||
      "Reason for attendance:\nHistory:\nClinical findings:\nDiagnosis:\nDiscussion:\nPlan:",

    rulesText:
      rulesResult.data?.map((r, i) => `${i + 1}. ${r.rule_text}`).join("\n") ||
      "No provider-specific rules.",

    examplesText:
      examplesResult.data
        ?.map(
          (e, i) =>
            `Example ${i + 1}: ${e.title || "Untitled"}\n${e.example_note}`,
        )
        .join("\n\n---\n\n") || "No provider examples.",

    terminologyText:
      terminologyResult.data
        ?.map(
          (t, i) =>
            `${i + 1}. Replace "${t.spoken_or_written_text}" with "${t.preferred_text}"`,
        )
        .join("\n") || "No terminology rules.",

    fields:
      fieldsResult.data?.map((f) => ({
        key: f.field_key,
        label: f.label,
      })) || [],
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
    const appointmentType = cleanString(body.appointmentType);
    const patientFirstName = cleanString(body.patientFirstName);
    const patientLastName = cleanString(body.patientLastName);
    const patientDob = cleanString(body.patientDob);
    const praktikaPatientId = cleanString(body.praktikaPatientId);
    const temporaryTranscript = cleanString(body.transcript);

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 },
      );
    }

    if (!appointmentType) {
      return NextResponse.json(
        { success: false, error: "Select an appointment template first." },
        { status: 400 },
      );
    }

    if (!patientFirstName || !patientLastName) {
      return NextResponse.json(
        { success: false, error: "Patient first and last name are required." },
        { status: 400 },
      );
    }

    if (!temporaryTranscript) {
      return NextResponse.json(
        { success: false, error: "No consultation audio text was available." },
        { status: 400 },
      );
    }

    const training = await getProviderTraining(providerId, appointmentType);

    const structuredFieldsInstruction =
      training.fields.length > 0
        ? training.fields
            .map((field) => `"${field.key}": "${field.label}"`)
            .join("\n")
        : `"chiefConcern": "Chief concern"
"medicalHistory": "Medical history"
"dentalHistory": "Dental history"
"oralHygieneHabits": "Oral hygiene habits"
"radiographicFindings": "Radiographic findings"
"diagnosis": "Diagnosis"
"treatmentPlan": "Treatment plan"`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an expert periodontal and oral surgery clinical scribe. Return valid JSON only.",
        },
        {
          role: "user",
          content: `
Generate a clinical note and extract structured findings from this consultation.

Rules:
- Do not invent clinical facts.
- Do not show or return the transcript.
- Treatment plans may be inferred from the conversation only when the clinician/patient discussion clearly supports them.
- Do not propose or suggest treatment plans independently.
- If treatment was not discussed, leave treatmentPlan blank or write "Not discussed".
- Use Australian English.
- Use FDI tooth notation.
- Use provider style, rules and terminology.

Patient:
${patientFirstName} ${patientLastName}
DOB: ${patientDob || "Not entered"}
Praktika patient ID: ${praktikaPatientId || "Not selected"}

Appointment type:
${appointmentType}

Provider template:
${training.templateText}

Provider rules:
${training.rulesText}

Provider terminology:
${training.terminologyText}

Provider examples:
${training.examplesText}

Structured fields to extract:
${structuredFieldsInstruction}

Temporary consultation transcript:
${temporaryTranscript}

Return JSON exactly in this shape:
{
  "clinicalNote": "full clinical note here",
  "structuredData": {
    "fieldKey": "extracted value"
  }
}
`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    const clinicalNote = cleanString(parsed.clinicalNote);
    const structuredData =
      parsed.structuredData && typeof parsed.structuredData === "object"
        ? parsed.structuredData
        : {};

    if (!clinicalNote) {
      return NextResponse.json(
        { success: false, error: "AI returned an empty clinical note." },
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
        transcript: null,
        transcript_stored: false,
        extracted_structured_data: structuredData,
        structured_data: structuredData,
        ai_generated_note: clinicalNote,
        edited_note: clinicalNote,
        status: "generated",
      })
      .select("id")
      .single();

    if (insertResult.error) {
      return NextResponse.json(
        { success: false, error: insertResult.error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      sessionId: insertResult.data.id,
      note: clinicalNote,
      structuredData,
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
