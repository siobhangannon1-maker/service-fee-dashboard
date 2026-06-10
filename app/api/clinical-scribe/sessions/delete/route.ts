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
  const sessionId = cleanString(body.sessionId);

  if (!providerId || !sessionId) {
    return NextResponse.json(
      { success: false, error: "Missing providerId or sessionId." },
      { status: 400 },
    );
  }

  const result = await supabase
    .from("clinical_scribe_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("provider_id", providerId);

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}