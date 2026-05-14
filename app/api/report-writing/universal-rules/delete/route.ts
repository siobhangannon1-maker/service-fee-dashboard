import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const body = await req.json()
  const { ruleId } = body

  if (!ruleId) {
    return NextResponse.json(
      { success: false, error: "Missing ruleId." },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from("universal_report_rules")
    .delete()
    .eq("id", ruleId)

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}