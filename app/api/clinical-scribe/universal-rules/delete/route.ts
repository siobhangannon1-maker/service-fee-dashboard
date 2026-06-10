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
  try {
    const body = await request.json();
    const ruleId = cleanString(body.ruleId);

    if (!ruleId) {
      return NextResponse.json(
        { success: false, error: "Missing ruleId." },
        { status: 400 },
      );
    }

    const result = await supabase
      .from("clinical_scribe_universal_rules")
      .delete()
      .eq("id", ruleId);

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete universal clinical scribe rule.",
      },
      { status: 500 },
    );
  }
}