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

export async function POST(request: Request) {
  const body = await request.json();

  const providerId = cleanString(body.providerId);
  const type = cleanString(body.type);
  const id = cleanString(body.id);

  if (!providerId || !type || !id) {
    return NextResponse.json(
      { success: false, error: "Missing providerId, type or id." },
      { status: 400 },
    );
  }

  if (type === "appointment_type") {
    const appointmentTypeResult = await supabase
      .from("provider_scribe_appointment_types")
      .select("type_key")
      .eq("id", id)
      .eq("provider_id", providerId)
      .single();

    if (appointmentTypeResult.error) {
      return NextResponse.json(
        { success: false, error: appointmentTypeResult.error.message },
        { status: 500 },
      );
    }

    const typeKey = appointmentTypeResult.data.type_key;

    const [fieldsResult, rulesResult, examplesResult, typeResult] =
      await Promise.all([
        supabase
          .from("provider_scribe_structured_fields")
          .delete()
          .eq("provider_id", providerId)
          .eq("appointment_type", typeKey),

        supabase
          .from("provider_scribe_rules")
          .delete()
          .eq("provider_id", providerId)
          .eq("appointment_type", typeKey),

        supabase
          .from("provider_scribe_examples")
          .delete()
          .eq("provider_id", providerId)
          .eq("appointment_type", typeKey),

        supabase
          .from("provider_scribe_appointment_types")
          .delete()
          .eq("id", id)
          .eq("provider_id", providerId),
      ]);

    const error =
      fieldsResult.error ||
      rulesResult.error ||
      examplesResult.error ||
      typeResult.error;

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  }

  let table = "";

  if (type === "rule") table = "provider_scribe_rules";
  if (type === "example") table = "provider_scribe_examples";
  if (type === "field") table = "provider_scribe_structured_fields";

  if (!table) {
    return NextResponse.json(
      { success: false, error: "Invalid delete type." },
      { status: 400 },
    );
  }

  const result = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("provider_id", providerId);

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}