import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const allowedFields = [
  "tx_type",
  "tx_label",
  "appointment_notes",
  "resource_name",
  "provider_name",
];

const allowedMatchTypes = ["contains", "equals", "starts_with"];

async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function GET() {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("praktika_location_rules")
    .select("*")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rules: data || [] });
}

export async function POST(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (!allowedFields.includes(body.matchField)) {
    return NextResponse.json({ error: "Invalid match field." }, { status: 400 });
  }

  if (!allowedMatchTypes.includes(body.matchType)) {
    return NextResponse.json({ error: "Invalid match type." }, { status: 400 });
  }

  if (!body.matchValue?.trim() || !body.locationName?.trim()) {
    return NextResponse.json(
      { error: "Match value and location are required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("praktika_location_rules")
    .insert({
      priority: Number(body.priority || 100),
      match_field: body.matchField,
      match_type: body.matchType,
      match_value: body.matchValue.trim(),
      location_name: body.locationName.trim(),
      is_active: body.isActive !== false,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}

export async function PATCH(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "Rule ID is required." }, { status: 400 });
  }

  const updatePayload: any = {
    updated_at: new Date().toISOString(),
  };

  if (body.matchField && allowedFields.includes(body.matchField)) {
    updatePayload.match_field = body.matchField;
  }

  if (body.matchType && allowedMatchTypes.includes(body.matchType)) {
    updatePayload.match_type = body.matchType;
  }

  if (body.matchValue !== undefined) {
    updatePayload.match_value = String(body.matchValue).trim();
  }

  if (body.locationName !== undefined) {
    updatePayload.location_name = String(body.locationName).trim();
  }

  if (body.priority !== undefined) {
    updatePayload.priority = Number(body.priority || 100);
  }

  if (typeof body.isActive === "boolean") {
    updatePayload.is_active = body.isActive;
  }

  const { data, error } = await supabaseAdmin
    .from("praktika_location_rules")
    .update(updatePayload)
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rule: data });
}

export async function DELETE(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Rule ID is required." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("praktika_location_rules")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}