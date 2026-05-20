import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const draftId =
    searchParams.get("draftId") || searchParams.get("reportDraftId")

  if (!draftId) {
    return NextResponse.json(
      { success: false, error: "Missing draftId." },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from("report_writing_audit_events")
    .select("*")
    .eq("entity_type", "report_draft")
    .eq("entity_id", draftId)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    events: data || [],
  })
}