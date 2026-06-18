import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables.")
  }

  return createClient(url, key)
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(req.url)

    const providerId = clean(searchParams.get("providerId"))
    const reportType = clean(searchParams.get("reportType"))

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    let query = supabase
      .from("provider_behaviours")
      .select(
        [
          "id",
          "provider_id",
          "report_type",
          "behaviour_key",
          "knowledge_type",
          "category",
          "behaviour_text",
          "preferred_phrase",
          "template_block",
          "applies_when",
          "evidence_summary",
          "confidence",
          "support_count",
          "status",
          "source",
          "created_at",
          "updated_at",
        ].join(", ")
      )
      .eq("provider_id", providerId)
      .eq("status", "active")
      .order("confidence", { ascending: false })
      .order("support_count", { ascending: false })

    if (reportType) {
      query = query.in("report_type", [reportType, "all"])
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, behaviours: data || [] })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load provider behaviours.",
      },
      { status: 500 }
    )
  }
}
