import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getPraktikaCookie } from "@/lib/praktika/session-store"
import { withPraktikaAutoRefresh } from "@/lib/praktika/seamless-request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au"
const TYPIST_LETTER_ICON_ID = 7360
const LETTER_SENT_ICON_ID = 6597

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildRequestId(cookie: string) {
  const match = cookie.match(/PHPSESSID=([^;]+)/)
  const sessionId = match?.[1] || crypto.randomUUID()
  return `${sessionId}_${Date.now()}`
}

function replaceTypistLetterIcon(iconIds: number[]) {
  const updated = iconIds.map((id) =>
    id === TYPIST_LETTER_ICON_ID ? LETTER_SENT_ICON_ID : id
  )

  if (!updated.includes(LETTER_SENT_ICON_ID)) {
    const emptyIndex = updated.findIndex((id) => id === 0)

    if (emptyIndex >= 0) {
      updated[emptyIndex] = LETTER_SENT_ICON_ID
    }
  }

  return updated.slice(0, 4)
}

function assertPraktikaJsonResponse(responseText: string) {
  const trimmed = responseText.trim().toLowerCase()

  if (
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.includes("/v2/login") ||
    trimmed.includes("type=\"password\"") ||
    trimmed.includes("logged-out") ||
    trimmed.includes("logged out")
  ) {
    throw new Error("Praktika session expired or returned a login page.")
  }
}

async function findQueueItem(params: { queueId?: string; draftId?: string }) {
  if (params.queueId) {
    const { data, error } = await supabase
      .from("report_letter_queue")
      .select("*")
      .eq("id", params.queueId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) return data
  }

  if (params.draftId) {
    const { data, error } = await supabase
      .from("report_letter_queue")
      .select("*")
      .eq("report_draft_id", params.draftId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (data) return data
  }

  return null
}

async function commitAppointmentIcons({
  cookie,
  practiceId,
  appointmentId,
  updatedIconIds,
}: {
  cookie: string
  practiceId: number
  appointmentId: string
  updatedIconIds: number[]
}) {
  const payload = [
    {
      request_id: buildRequestId(cookie),
      practice_id: practiceId,
      appointment_id: Number(appointmentId),
      appointment_icon1id: updatedIconIds[0],
      appointment_icon2id: updatedIconIds[1],
      appointment_icon3id: updatedIconIds[2],
      appointment_icon4id: updatedIconIds[3],
    },
  ]

  const response = await fetch(
    `${PRAKTIKA_BASE_URL}/php/forms/db_commitFormData.php`,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: PRAKTIKA_BASE_URL,
        Referer: `${PRAKTIKA_BASE_URL}/v2/scheduler`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  )

  const responseText = await response.text()
  assertPraktikaJsonResponse(responseText)

  if (!response.ok) {
    throw new Error(
      `Praktika icon update failed: ${response.status}. ${responseText.slice(0, 500)}`
    )
  }

  return responseText
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const queueId = clean(body.queueId)
    const draftId = clean(body.draftId)

    if (!queueId && !draftId) {
      return NextResponse.json(
        { success: false, error: "Missing queueId or draftId." },
        { status: 400 }
      )
    }

    const practiceId = Number(process.env.PRAKTIKA_PRACTICE_ID || "1181")
    const queueItem = await findQueueItem({ queueId, draftId })

    if (!queueItem) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No linked queue item found for this draft. Open the item from the queue before creating the draft, or link the queue item to the draft.",
        },
        { status: 404 }
      )
    }

    const raw = queueItem.raw_json || {}
    const appointmentId =
      clean(queueItem.appointment_id) || clean(raw.iAppointmentId)

    if (!appointmentId) {
      return NextResponse.json(
        { success: false, error: "Missing appointment ID." },
        { status: 400 }
      )
    }

    const currentIconIds = [
      numberValue(raw.iIcon1Id),
      numberValue(raw.iIcon2Id),
      numberValue(raw.iIcon3Id),
      numberValue(raw.iIcon4Id),
    ]

    const updatedIconIds = replaceTypistLetterIcon(currentIconIds)

    const responseText = await withPraktikaAutoRefresh(async () => {
      const cookie = await getPraktikaCookie()

      return commitAppointmentIcons({
        cookie,
        practiceId,
        appointmentId,
        updatedIconIds,
      })
    })

    const now = new Date().toISOString()

    const { error: updateError } = await supabase
      .from("report_letter_queue")
      .update({
        status: "completed",
        report_draft_id: draftId || queueItem.report_draft_id || null,
        updated_at: now,
        raw_json: {
          ...raw,
          iIcon1Id: String(updatedIconIds[0]),
          iIcon2Id: String(updatedIconIds[1]),
          iIcon3Id: String(updatedIconIds[2]),
          iIcon4Id: String(updatedIconIds[3]),
          letterIconUpdatedAt: now,
          letterIconUpdateResponsePreview: responseText.slice(0, 500),
        },
      })
      .eq("id", queueItem.id)

    if (updateError) {
      return NextResponse.json(
        {
          success: false,
          error: `Praktika icons updated, but queue status failed: ${updateError.message}`,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      queueId: queueItem.id,
      appointmentId,
      oldIconIds: currentIconIds,
      newIconIds: updatedIconIds,
    })
  } catch (error) {
    console.error("Update Praktika letter icons failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update Praktika letter icons.",
      },
      { status: 500 }
    )
  }
}
