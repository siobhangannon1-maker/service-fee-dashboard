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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerId = cleanString(url.searchParams.get("providerId"));

  if (!providerId) {
    return NextResponse.json(
      { success: false, error: "Missing providerId." },
      { status: 400 },
    );
  }

  const result = await supabase
    .from("provider_scribe_appointment_types")
    .select("type_key, label")
    .eq("provider_id", providerId)
    .order("label");

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    types:
      result.data?.map((type) => ({
        value: type.type_key,
        label: type.label,
      })) || [],
  });
}