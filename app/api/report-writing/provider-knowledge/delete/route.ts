import { trainingAccess, trainingItemAccess } from "@/lib/report-writing/training-authorization";
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
  const access = await trainingAccess();
  if (access.denied) return access.denied;

  try {
    const supabase = getSupabase()
    const body = await req.json()
    const id = String(body.id || "").trim()
    const status = String(body.status || "archived").trim()

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing knowledge id." }, { status: 400 })
    }

    const itemAccess = await trainingItemAccess(access.value, "provider_knowledge", id);
    if (itemAccess.denied) return itemAccess.denied;

    const { error } = await supabase
      .from("provider_knowledge")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("provider_id", itemAccess.value)

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to update provider knowledge." },
      { status: 500 }
    )
  }
}
