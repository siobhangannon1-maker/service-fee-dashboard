import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type LetterSourceType = "dictation" | "smart_dictation" | "clinical_notes";

const DEFAULT_LETTER_SOURCE: LetterSourceType = "dictation";

const LETTER_SOURCE_LABELS: Record<LetterSourceType, string> = {
  dictation: "Dictate",
  smart_dictation: "Smart Dictate",
  clinical_notes: "Generate from Clinical Notes",
};

function isLetterSourceType(value: unknown): value is LetterSourceType {
  return (
    value === "dictation" ||
    value === "smart_dictation" ||
    value === "clinical_notes"
  );
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const providerId = request.nextUrl.searchParams.get("providerId")?.trim();

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "providerId is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("provider_letter_preferences")
      .select("default_letter_source")
      .eq("provider_id", providerId)
      .maybeSingle();

    if (error) {
      console.error("Load provider letter preference error:", error);
      return NextResponse.json(
        { success: false, error: "Could not load the provider preference." },
        { status: 500 },
      );
    }

    const defaultLetterSource = isLetterSourceType(data?.default_letter_source)
      ? data.default_letter_source
      : DEFAULT_LETTER_SOURCE;

    return NextResponse.json({
      success: true,
      defaultLetterSource,
      label: LETTER_SOURCE_LABELS[defaultLetterSource],
    });
  } catch (error) {
    console.error("Provider letter preference GET error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load the provider preference.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const providerId = String(body?.providerId || "").trim();
    const defaultLetterSource = body?.defaultLetterSource;

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "providerId is required." },
        { status: 400 },
      );
    }

    if (!isLetterSourceType(defaultLetterSource)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "defaultLetterSource must be dictation, smart_dictation, or clinical_notes.",
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("provider_letter_preferences")
      .upsert(
        {
          provider_id: providerId,
          default_letter_source: defaultLetterSource,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider_id" },
      )
      .select("provider_id, default_letter_source, updated_at")
      .single();

    if (error) {
      console.error("Save provider letter preference error:", error);
      return NextResponse.json(
        { success: false, error: "Could not save the provider preference." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      preference: data,
      defaultLetterSource,
      label: LETTER_SOURCE_LABELS[defaultLetterSource],
    });
  } catch (error) {
    console.error("Provider letter preference POST error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save the provider preference.",
      },
      { status: 500 },
    );
  }
}
