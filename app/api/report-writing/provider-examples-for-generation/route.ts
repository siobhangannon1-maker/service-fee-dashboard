import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const providerId = searchParams.get("providerId")
  const reportType = searchParams.get("reportType")

  if (!providerId || !reportType) {
    return NextResponse.json(
      { success: false, error: "providerId and reportType are required." },
      { status: 400 }
    )
  }

  const result = await supabase
    .from("provider_report_examples")
    .select(
      "id, title, report_type, scenario_tags, scenario_summary, is_preferred, created_at"
    )
    .eq("provider_id", providerId)
    .eq("report_type", reportType)
    .order("is_preferred", { ascending: false })
    .order("created_at", { ascending: false })

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    examples: result.data || [],
  })
}
