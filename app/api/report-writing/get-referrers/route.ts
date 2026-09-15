import { sensitiveApiAccess } from "@/lib/auth";
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const accessDenied = await sensitiveApiAccess("/api/report-writing/get-referrers");
  if (accessDenied) return accessDenied;

  const { data, error } = await supabase
    .from("report_referrers")
    .select("id, name, address")
    .order("name", { ascending: true })

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