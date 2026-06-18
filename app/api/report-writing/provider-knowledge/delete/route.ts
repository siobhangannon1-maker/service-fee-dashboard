import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing Supabase environment variables.")
  return createClient(url, key)
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const body = await req.json()
    const id = String(body.id || "").trim()
    const status = String(body.status || "archived").trim()

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing knowledge id." }, { status: 400 })
    }

    const { error } = await supabase
      .from("provider_knowledge")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update provider knowledge." },
      { status: 500 }
    )
  }
}
