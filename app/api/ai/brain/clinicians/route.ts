import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function cleanArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("ai_clinicians")
    .select("*")
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ clinicians: data || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const payload = {
    clinician_key: String(body.clinician_key || "").trim(),
    display_name: String(body.display_name || "").trim(),
    role: body.role || null,
    keywords: cleanArray(body.keywords),
    referring_practitioner_keywords: cleanArray(
      body.referring_practitioner_keywords,
    ),
    default_trello_board_id: body.default_trello_board_id || null,
    general_list_id: body.general_list_id || null,
    urgent_list_id: body.urgent_list_id || null,
    radiology_results_list_id: body.radiology_results_list_id || null,
    pathology_results_list_id: body.pathology_results_list_id || null,
    is_active: body.is_active !== false,
    updated_at: new Date().toISOString(),
  };

  if (!payload.clinician_key || !payload.display_name) {
    return NextResponse.json(
      { error: "clinician_key and display_name are required." },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("ai_clinicians")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ clinician: data });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const payload = {
    clinician_key: String(body.clinician_key || "").trim(),
    display_name: String(body.display_name || "").trim(),
    role: body.role || null,
    keywords: cleanArray(body.keywords),
    referring_practitioner_keywords: cleanArray(
      body.referring_practitioner_keywords,
    ),
    default_trello_board_id: body.default_trello_board_id || null,
    general_list_id: body.general_list_id || null,
    urgent_list_id: body.urgent_list_id || null,
    radiology_results_list_id: body.radiology_results_list_id || null,
    pathology_results_list_id: body.pathology_results_list_id || null,
    is_active: body.is_active !== false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("ai_clinicians")
    .update(payload)
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ clinician: data });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("ai_clinicians")
    .delete()
    .eq("id", body.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}