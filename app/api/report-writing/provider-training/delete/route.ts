import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const allowedTables = {
  rule: "provider_report_rules",
  example: "provider_report_examples",
  terminology: "provider_terminology_rules",
} as const

export async function POST(req: Request) {
  const body = await req.json()
  const { id, type } = body

  if (!id || !type || !(type in allowedTables)) {
    return NextResponse.json(
      { success: false, error: "Missing or invalid item." },
      { status: 400 }
    )
  }

  const table = allowedTables[type as keyof typeof allowedTables]

  const { error } = await supabase.from(table).delete().eq("id", id)

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}