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

export async function GET() {
  const result = await supabase
    .from("clinical_scribe_universal_rules")
    .select("id, appointment_type, rule_text, created_at")
    .order("created_at", { ascending: false });

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    rules: result.data || [],
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const appointmentType = cleanString(body.appointmentType) || "all";
    const ruleText = cleanString(body.ruleText);

    if (!ruleText) {
      return NextResponse.json(
        { success: false, error: "Missing rule text." },
        { status: 400 },
      );
    }

    const result = await supabase
      .from("clinical_scribe_universal_rules")
      .insert({
        appointment_type: appointmentType,
        rule_text: ruleText,
      })
      .select("id")
      .single();

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      ruleId: result.data.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save universal clinical scribe rule.",
      },
      { status: 500 },
    );
  }
}