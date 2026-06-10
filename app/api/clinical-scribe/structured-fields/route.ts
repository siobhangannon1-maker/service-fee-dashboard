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

const defaultFields = [
  {
    field_key: "chiefConcern",
    label: "Chief concern",
    placeholder: "Chief concern",
    input_type: "textarea",
    display_order: 10,
    required: false,
  },
  {
    field_key: "diagnosis",
    label: "Diagnosis",
    placeholder: "Diagnosis",
    input_type: "textarea",
    display_order: 20,
    required: false,
  },
  {
    field_key: "stageGrade",
    label: "Stage/grade",
    placeholder: "Stage III Grade B periodontitis",
    input_type: "text",
    display_order: 30,
    required: false,
  },
  {
    field_key: "bopScore",
    label: "BOP score",
    placeholder: "38%",
    input_type: "text",
    display_order: 40,
    required: false,
  },
  {
    field_key: "probingDepthsSummary",
    label: "Probing depths summary",
    placeholder: "Generalised 4-5 mm pockets with 6-7 mm pockets at...",
    input_type: "textarea",
    display_order: 50,
    required: false,
  },
  {
    field_key: "radiographicFindings",
    label: "Radiographic findings",
    placeholder: "Horizontal bone loss, vertical defects, furcation involvement...",
    input_type: "textarea",
    display_order: 60,
    required: false,
  },
  {
    field_key: "riskFactors",
    label: "Risk factors",
    placeholder: "Smoking, diabetes, oral hygiene, bruxism...",
    input_type: "textarea",
    display_order: 70,
    required: false,
  },
  {
    field_key: "plan",
    label: "Plan",
    placeholder: "Treatment plan",
    input_type: "textarea",
    display_order: 80,
    required: false,
  },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerId = cleanString(url.searchParams.get("providerId"));
  const appointmentType = cleanString(url.searchParams.get("appointmentType"));

  if (!providerId || !appointmentType) {
    return NextResponse.json(
      { success: false, error: "Missing providerId or appointmentType." },
      { status: 400 },
    );
  }

  const result = await supabase
    .from("provider_scribe_structured_fields")
    .select(
      "id, field_key, label, placeholder, input_type, display_order, required",
    )
    .eq("provider_id", providerId)
    .eq("appointment_type", appointmentType)
    .order("display_order", { ascending: true });

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    fields: result.data && result.data.length > 0 ? result.data : defaultFields,
  });
}