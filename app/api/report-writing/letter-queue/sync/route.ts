import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED_STATUSES = new Set(["queued", "started", "completed"])

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get("providerId")
  const status = searchParams.get("status") || "active"

  let query = supabase
    .from("report_letter_queue")
    .select("*")
    .order("appointment_time", { ascending: false })

  if (providerId) {
    query = query.eq("provider_id", providerId)
  }

  if (status === "active") {
    query = query.in("status", ["queued", "started"])
  } else if (ALLOWED_STATUSES.has(status)) {
    query = query.eq("status", status)
  } else {
    query = query.in("status", ["queued", "started"])
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
    queue: data || [],
  })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { queueId, status } = body

  if (!queueId || !status) {
    return NextResponse.json(
      { success: false, error: "Missing queueId or status." },
      { status: 400 }
    )
  }

  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { success: false, error: "Invalid queue status." },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from("report_letter_queue")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", queueId)
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    queueItem: data,
  })
}
