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
  const [
    universalRulesResult,
    templateResult,
    rulesResult,
    examplesResult,
    terminologyResult,
    fieldsResult,
  ] = await Promise.all([
    supabase
      .from("clinical_scribe_universal_rules")
      .select("appointment_type, rule_text")
      .in("appointment_type", [appointmentType, "all"]),

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

  if (universalRulesResult.error) {
    console.error("Universal scribe rules lookup error:", universalRulesResult.error);
  }

  if (templateResult.error) {
    console.error("Provider scribe template lookup error:", templateResult.error);
  }

  if (rulesResult.error) {
    console.error("Provider scribe rules lookup error:", rulesResult.error);
  }

  if (examplesResult.error) {
    console.error("Provider scribe examples lookup error:", examplesResult.error);
  }

  if (terminologyResult.error) {
    console.error("Provider terminology lookup error:", terminologyResult.error);
  }

  if (fieldsResult.error) {
    console.error("Provider scribe structured fields lookup error:", fieldsResult.error);
  }

  return {
    universalRulesText:
      universalRulesResult.data && universalRulesResult.data.length > 0
        ? universalRulesResult.data
            .map((rule, index) => `${index + 1}. ${rule.rule_text}`)
            .join("\n")
        : "No universal clinical scribe rules saved.",

    templateText:
      templateResult.data?.default_template ||
      [
        "Reason for attendance:",
        "History:",
        "Clinical findings:",
        "Diagnosis:",
        "Discussion:",
        "Plan:",
      ].join("\n"),

    rulesText:
      rulesResult.data && rulesResult.data.length > 0
        ? rulesResult.data
            .map((rule, index) => `${index + 1}. ${rule.rule_text}`)
            .join("\n")
        : "No provider-specific clinical scribe rules saved.",

    examplesText:
      examplesResult.data && examplesResult.data.length > 0
        ? examplesResult.data
            .map((example, index) =>
              [
                `Example ${index + 1}: ${example.title || "Untitled"}`,
                `Preferred: ${example.is_preferred ? "yes" : "no"}`,
                example.example_note,
              ].join("\n"),
            )
            .join("\n\n---\n\n")
        : "No provider-specific clinical scribe examples saved.",

    terminologyText:
      terminologyResult.data && terminologyResult.data.length > 0
        ? terminologyResult.data
            .map(
              (item, index) =>
                `${index + 1}. Replace "${item.spoken_or_written_text}" with "${item.preferred_text}"`,
            )
            .join("\n")
        : "No provider terminology preferences saved.",

    fields:
      fieldsResult.data && fieldsResult.data.length > 0
        ? fieldsResult.data.map((field) => ({
            key: field.field_key,
            label: field.label,
          }))
        : [
            { key: "chiefConcern", label: "Chief concern" },
            { key: "medicalHistory", label: "Medical history" },
            { key: "dentalHistory", label: "Dental history" },
            { key: "oralHygieneHabits", label: "Oral hygiene habits" },
            { key: "radiographicFindings", label: "Radiographic findings" },
            { key: "diagnosis", label: "Diagnosis" },
            { key: "treatmentPlan", label: "Treatment plan" },
          ],
  };
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing OPENAI_API_KEY.",
        },
        { status: 500 },
      );
    }

    const body = await request.json();

    const providerId = cleanString(body.providerId);
    const appointmentType =
      cleanString(body.appointmentType) || "periodontal_consultation";
    const patientFirstName = cleanString(body.patientFirstName);
    const patientLastName = cleanString(body.patientLastName);
    const patientDob = cleanString(body.patientDob);
    const praktikaPatientId = cleanString(body.praktikaPatientId);
    const transcript = cleanString(body.transcript);

    if (!providerId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing providerId.",
        },
        { status: 400 },
      );
    }

    if (!patientFirstName || !patientLastName) {
      return NextResponse.json(
        {
          success: false,
          error: "Patient first and last name are required.",
        },
        { status: 400 },
      );
    }

    if (!transcript) {
      return NextResponse.json(
        {
          success: false,
          error: "No consultation audio text was available.",
        },
        { status: 400 },
      );
    }

    const training = await getProviderTraining(providerId, appointmentType);

    const structuredFieldsInstruction = training.fields
      .map((field) => `"${field.key}": "${field.label}"`)
      .join("\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      response_format: {
        type: "json_object",
      },
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

Critical safety rules:
- Do not invent clinical findings.
- Do not invent diagnoses.
- Do not invent radiographic findings.
- Do not invent medical history.
- Do not invent consent discussions.
- Do not invent treatment plans.
- Do not show or return the transcript.
- Treatment plans may be inferred from the conversation only when the clinician-patient discussion clearly supports them.
- Do not propose or suggest treatment plans independently.
- If treatment was not discussed, leave treatmentPlan blank or write "Not discussed".
- If uncertain, omit rather than infer.
- Use Australian English.
- Use FDI tooth numbering.
- Use provider style, rules, examples and terminology.

Patient:
${patientFirstName} ${patientLastName}
DOB: ${patientDob || "Not entered"}
Praktika patient ID: ${praktikaPatientId || "Not selected"}

Appointment type:
${appointmentType}

Universal clinical scribe rules:
${training.universalRulesText}

Provider clinical note template:
${training.templateText}

Provider-specific clinical scribe rules:
${training.rulesText}

Provider terminology:
${training.terminologyText}

Provider example clinical notes:
${training.examplesText}

Structured fields to extract:
${structuredFieldsInstruction}

Temporary consultation transcript:
${transcript}

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

    let parsed: any;

    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      console.error("Clinical scribe JSON parse error:", parseError, raw);

      return NextResponse.json(
        {
          success: false,
          error: "AI returned invalid JSON.",
        },
        { status: 500 },
      );
    }

    const clinicalNote = cleanString(parsed.clinicalNote);

    const structuredData =
      parsed.structuredData && typeof parsed.structuredData === "object"
        ? parsed.structuredData
        : {};

    if (!clinicalNote) {
      return NextResponse.json(
        {
          success: false,
          error: "AI returned an empty clinical note.",
        },
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

        // Important privacy behaviour:
        // The consultation transcript is used only temporarily to generate the note.
        // It is deliberately not saved.
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