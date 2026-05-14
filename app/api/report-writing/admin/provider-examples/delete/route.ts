import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const body = await req.json()
  const { exampleId } = body

  if (!exampleId) {
    return NextResponse.json(
      { success: false, error: "Missing exampleId." },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from("provider_report_examples")
    .delete()
    .eq("id", exampleId)

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}