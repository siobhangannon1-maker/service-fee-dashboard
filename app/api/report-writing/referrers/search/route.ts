import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")?.trim() || ""

  if (q.length < 2) {
    return NextResponse.json({
      success: true,
      referrers: [],
    })
  }

  const { data, error } = await supabase
    .from("report_referrers")
    .select("id, name, practice_name, address, phone, email")
    .eq("is_active", true)
    .or(
      `name.ilike.%${q}%,practice_name.ilike.%${q}%,address.ilike.%${q}%`
    )
    .order("name", { ascending: true })
    .limit(20)

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    referrers: data ?? [],
  })
}