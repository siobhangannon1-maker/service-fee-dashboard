import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED_STATUSES = new Set(["queued", "started", "completed"])

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get("providerId")
  const status = searchParams.get("status") || "active"
  const draftId = searchParams.get("draftId")

  let query = supabase
    .from("report_letter_queue")
    .select("*")
    .order("appointment_time", { ascending: false })

  if (draftId) {
    query = query.eq("report_draft_id", draftId)
  } else if (providerId) {
    query = query.eq("provider_id", providerId)
  }

  if (!draftId) {
    if (status === "active") {
      query = query.in("status", ["queued", "started"])
    } else if (ALLOWED_STATUSES.has(status)) {
      query = query.eq("status", status)
    } else {
      query = query.in("status", ["queued", "started"])
    }
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
  const {
    queueId,
    status,
    reportDraftId,
    cachedClinicalNotes,
    cachedClinicalNotesSource,
  } = body

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

  const updatePayload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (reportDraftId) {
    updatePayload.report_draft_id = reportDraftId
  }

  if (typeof cachedClinicalNotes === "string") {
    const { data: existing, error: existingError } = await supabase
      .from("report_letter_queue")
      .select("raw_json")
      .eq("id", queueId)
      .single()

    if (existingError) {
      return NextResponse.json(
        { success: false, error: existingError.message },
        { status: 500 }
      )
    }

    const rawJson = asObject(existing?.raw_json)

    updatePayload.raw_json = {
      ...rawJson,
      cached_clinical_notes: cachedClinicalNotes,
      cached_clinical_notes_source:
        cachedClinicalNotesSource || "praktika_clinical_notes",
      cached_clinical_notes_at: new Date().toISOString(),
    }
  }

  const { data, error } = await supabase
    .from("report_letter_queue")
    .update(updatePayload)
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