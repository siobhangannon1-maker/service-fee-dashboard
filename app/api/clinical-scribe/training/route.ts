import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const defaultTypes = [
  {
    type_key: "periodontal_consultation",
    label: "Periodontal Consultation",
    default_template:
      "Reason for attendance:\nHistory:\nClinical findings:\nPeriodontal findings:\nRadiographic findings:\nDiagnosis:\nDiscussion:\nTreatment options:\nRisks/consent:\nPlan:",
  },
  {
    type_key: "implant_consultation",
    label: "Implant Consultation",
    default_template:
      "Reason for attendance:\nHistory:\nClinical findings:\nRadiographic/CBCT findings:\nAssessment:\nTreatment options:\nRisks/consent:\nPlan:",
  },
  {
    type_key: "oral_surgery_consultation",
    label: "Oral Surgery Consultation",
    default_template:
      "Reason for attendance:\nHistory:\nClinical findings:\nRadiographic findings:\nDiagnosis:\nDiscussion:\nRisks/consent:\nPlan:",
  },
  {
    type_key: "post_op_review",
    label: "Post-operative Review",
    default_template:
      "Procedure reviewed:\nHealing:\nSymptoms:\nClinical findings:\nRadiographic findings:\nAssessment:\nPlan:",
  },
];

const defaultFields = [
  ["chiefConcern", "Chief concern", "Chief concern", "textarea", 10],
  ["medicalHistory", "Medical history", "Relevant medical history", "textarea", 20],
  ["diagnosis", "Diagnosis", "Diagnosis", "textarea", 30],
  ["stageGrade", "Stage/grade", "Stage III Grade B", "text", 40],
  ["probingDepthsSummary", "Probing depths summary", "Pocketing summary", "textarea", 50],
  ["bopScore", "BOP score", "38%", "text", 60],
  ["radiographicFindings", "Radiographic findings", "Bone loss / defects", "textarea", 70],
  ["riskFactors", "Risk factors", "Smoking, diabetes, OH, bruxism", "textarea", 80],
  ["treatmentDiscussed", "Treatment discussed", "Options discussed", "textarea", 90],
  ["consentDiscussion", "Consent/risk discussion", "Risks and consent", "textarea", 100],
  ["plan", "Plan", "Treatment plan", "textarea", 110],
];

async function seedDefaults(providerId: string) {
  for (const type of defaultTypes) {
    await supabase.from("provider_scribe_appointment_types").upsert(
      {
        provider_id: providerId,
        type_key: type.type_key,
        label: type.label,
        default_template: type.default_template,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_id,type_key" },
    );

    for (const [fieldKey, label, placeholder, inputType, order] of defaultFields) {
      await supabase.from("provider_scribe_structured_fields").upsert(
        {
          provider_id: providerId,
          appointment_type: type.type_key,
          field_key: fieldKey,
          label,
          placeholder,
          input_type: inputType,
          display_order: order,
          required: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider_id,appointment_type,field_key" },
      );
    }
  }
}

export async function GET(request: Request) {
  const providerId = cleanString(new URL(request.url).searchParams.get("providerId"));

  if (!providerId) {
    return NextResponse.json({ success: false, error: "Missing providerId." }, { status: 400 });
  }

  const [appointmentTypes, rules, examples, fields] = await Promise.all([
    supabase.from("provider_scribe_appointment_types").select("*").eq("provider_id", providerId).order("label"),
    supabase.from("provider_scribe_rules").select("*").eq("provider_id", providerId).order("created_at", { ascending: false }),
    supabase.from("provider_scribe_examples").select("*").eq("provider_id", providerId).order("created_at", { ascending: false }),
    supabase.from("provider_scribe_structured_fields").select("*").eq("provider_id", providerId).order("display_order"),
  ]);

  const error = appointmentTypes.error || rules.error || examples.error || fields.error;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    appointmentTypes: appointmentTypes.data || [],
    rules: rules.data || [],
    examples: examples.data || [],
    fields: fields.data || [],
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const providerId = cleanString(body.providerId);
  const action = cleanString(body.action);

  if (!providerId) {
    return NextResponse.json({ success: false, error: "Missing providerId." }, { status: 400 });
  }

  if (action === "seed_defaults") {
    await seedDefaults(providerId);
    return NextResponse.json({ success: true });
  }

  if (action === "add_appointment_type") {
    const label = cleanString(body.label);
    const typeKey = slugify(label);

    if (!label || !typeKey) {
      return NextResponse.json({ success: false, error: "Missing appointment type label." }, { status: 400 });
    }

    const result = await supabase
      .from("provider_scribe_appointment_types")
      .insert({ provider_id: providerId, type_key: typeKey, label, default_template: "" })
      .select("type_key")
      .single();

    if (result.error) return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });

    return NextResponse.json({ success: true, typeKey: result.data.type_key });
  }

  if (action === "save_template") {
    const appointmentType = cleanString(body.appointmentType);
    const defaultTemplate = cleanString(body.defaultTemplate);

    const result = await supabase
      .from("provider_scribe_appointment_types")
      .update({ default_template: defaultTemplate, updated_at: new Date().toISOString() })
      .eq("provider_id", providerId)
      .eq("type_key", appointmentType);

    if (result.error) return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "add_rule") {
    const appointmentType = cleanString(body.appointmentType);
    const ruleText = cleanString(body.ruleText);

    const result = await supabase.from("provider_scribe_rules").insert({
      provider_id: providerId,
      appointment_type: appointmentType,
      rule_text: ruleText,
    });

    if (result.error) return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "add_example") {
    const result = await supabase.from("provider_scribe_examples").insert({
      provider_id: providerId,
      appointment_type: cleanString(body.appointmentType),
      title: cleanString(body.title) || null,
      example_note: cleanString(body.exampleNote),
      is_preferred: Boolean(body.isPreferred),
    });

    if (result.error) return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "update_example") {
    const result = await supabase
      .from("provider_scribe_examples")
      .update({
        title: cleanString(body.title) || null,
        example_note: cleanString(body.exampleNote),
        is_preferred: Boolean(body.isPreferred),
      })
      .eq("id", cleanString(body.id))
      .eq("provider_id", providerId);

    if (result.error) return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "add_field") {
    const label = cleanString(body.label);
    const fieldKey = slugify(cleanString(body.fieldKey) || label);

    const result = await supabase.from("provider_scribe_structured_fields").insert({
      provider_id: providerId,
      appointment_type: cleanString(body.appointmentType),
      field_key: fieldKey,
      label,
      placeholder: cleanString(body.placeholder) || null,
      input_type: cleanString(body.inputType) || "textarea",
      display_order: Number(body.displayOrder || 0),
      required: Boolean(body.required),
    });

    if (result.error) return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (action === "update_field") {
    const result = await supabase
      .from("provider_scribe_structured_fields")
      .update({
        label: cleanString(body.label),
        placeholder: cleanString(body.placeholder) || null,
        input_type: cleanString(body.inputType) || "textarea",
        display_order: Number(body.displayOrder || 0),
        required: Boolean(body.required),
        updated_at: new Date().toISOString(),
      })
      .eq("id", cleanString(body.id))
      .eq("provider_id", providerId);

    if (result.error) return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}