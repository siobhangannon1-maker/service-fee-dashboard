import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get("providerId")

  let query = supabase
    .from("report_drafts")
    .select("*")
    .neq("status", "deleted")
    .order("created_at", { ascending: false })

  if (providerId) {
    query = query.eq("provider_id", providerId)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    drafts: data,
  })
}