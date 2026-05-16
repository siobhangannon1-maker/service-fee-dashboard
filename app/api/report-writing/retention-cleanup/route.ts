import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type DraftForRetention = {
  id: string
  patient_name: string | null
  status: string | null
  source_text: string | null
  ai_generated_text: string | null
  edited_text: string | null
  completed_at: string | null
  uploaded_to_praktika_at: string | null
  emailed_to_referrer_at: string | null
  provider_approved_at: string | null
  created_at: string | null
  updated_at: string | null
  sensitive_source_deleted_at: string | null
  ai_text_deleted_at: string | null
  final_text_deleted_at: string | null
  retention_status: string | null
}

function daysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date
}

function getCompletionDate(draft: DraftForRetention) {
  const value =
    draft.completed_at ||
    draft.emailed_to_referrer_at ||
    draft.uploaded_to_praktika_at ||
    draft.provider_approved_at ||
    draft.updated_at ||
    draft.created_at

  if (!value) return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return null

  return date
}

function isCompleted(draft: DraftForRetention) {
  return Boolean(
    draft.completed_at ||
      draft.emailed_to_referrer_at ||
      draft.uploaded_to_praktika_at ||
      draft.status === "uploaded_to_praktika" ||
      draft.status === "approved"
  )
}

function isAuthorized(req: Request) {
  const secret = process.env.RETENTION_CLEANUP_SECRET

  if (!secret) {
    return true
  }

  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : ""

  const querySecret = new URL(req.url).searchParams.get("secret") || ""

  return bearer === secret || querySecret === secret
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      )
    }

    const deleteFinalText =
      process.env.RETENTION_DELETE_FINAL_TEXT === "true"

    const sourceRetentionDays = Number(
      process.env.RETENTION_SOURCE_DAYS || "30"
    )

    const aiRetentionDays = Number(process.env.RETENTION_AI_DAYS || "30")

    const finalRetentionDays = Number(
      process.env.RETENTION_FINAL_TEXT_DAYS || "90"
    )

    const sourceCutoff = daysAgo(sourceRetentionDays)
    const aiCutoff = daysAgo(aiRetentionDays)
    const finalCutoff = daysAgo(finalRetentionDays)

    const { data: drafts, error } = await supabase
      .from("report_drafts")
      .select(
        [
          "id",
          "patient_name",
          "status",
          "source_text",
          "ai_generated_text",
          "edited_text",
          "completed_at",
          "uploaded_to_praktika_at",
          "emailed_to_referrer_at",
          "provider_approved_at",
          "created_at",
          "updated_at",
          "sensitive_source_deleted_at",
          "ai_text_deleted_at",
          "final_text_deleted_at",
          "retention_status",
        ].join(", ")
      )
      .limit(1000)

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const nowIso = new Date().toISOString()

    let checked = 0
    let sourceDeleted = 0
    let aiDeleted = 0
    let finalDeleted = 0
    let completedAtBackfilled = 0

    const auditEvents: Array<{
      report_draft_id: string
      provider_id?: string | null
      patient_name?: string | null
      actor_full_name: string
      actor_initials: string
      action: string
      details: Record<string, unknown>
    }> = []

    const typedDrafts = (drafts || []) as unknown as DraftForRetention[]

    for (const draft of typedDrafts) {
      if (!isCompleted(draft)) continue

      checked += 1

      const completionDate = getCompletionDate(draft)

      if (!completionDate) continue

      const updatePayload: Record<string, unknown> = {}
      const deletedFields: string[] = []

      if (!draft.completed_at) {
        updatePayload.completed_at = completionDate.toISOString()
        completedAtBackfilled += 1
      }

      if (
        draft.source_text &&
        !draft.sensitive_source_deleted_at &&
        completionDate <= sourceCutoff
      ) {
        updatePayload.source_text = null
        updatePayload.sensitive_source_deleted_at = nowIso
        deletedFields.push("source_text")
        sourceDeleted += 1
      }

      if (
        draft.ai_generated_text &&
        !draft.ai_text_deleted_at &&
        completionDate <= aiCutoff
      ) {
        updatePayload.ai_generated_text = null
        updatePayload.ai_text_deleted_at = nowIso
        deletedFields.push("ai_generated_text")
        aiDeleted += 1
      }

      if (
        deleteFinalText &&
        draft.edited_text &&
        !draft.final_text_deleted_at &&
        completionDate <= finalCutoff
      ) {
        updatePayload.edited_text = null
        updatePayload.final_text_deleted_at = nowIso
        deletedFields.push("edited_text")
        finalDeleted += 1
      }

      if (Object.keys(updatePayload).length > 0) {
        updatePayload.retention_status =
          updatePayload.final_text_deleted_at
            ? "final_text_deleted"
            : updatePayload.ai_text_deleted_at || draft.ai_text_deleted_at
              ? "ai_and_source_deleted"
              : updatePayload.sensitive_source_deleted_at ||
                  draft.sensitive_source_deleted_at
                ? "source_deleted"
                : draft.retention_status || "completed"

        updatePayload.updated_at = nowIso

        const { error: updateError } = await supabase
          .from("report_drafts")
          .update(updatePayload)
          .eq("id", draft.id)

        if (updateError) {
          console.error("Retention cleanup failed for draft", draft.id, updateError)
          continue
        }

        if (deletedFields.length > 0) {
          auditEvents.push({
            report_draft_id: draft.id,
            patient_name: draft.patient_name,
            actor_full_name: "System retention cleanup",
            actor_initials: "SYS",
            action: "Retention cleanup deleted sensitive text",
            details: {
              deletedFields,
              sourceRetentionDays,
              aiRetentionDays,
              finalRetentionDays,
              deleteFinalText,
            },
          })
        }
      }
    }

    if (auditEvents.length > 0) {
      const { error: auditError } = await supabase
        .from("report_writing_audit_events")
        .insert(auditEvents)

      if (auditError) {
        console.error("Retention cleanup audit insert failed:", auditError)
      }
    }

    return NextResponse.json({
      success: true,
      checked,
      completedAtBackfilled,
      sourceDeleted,
      aiDeleted,
      finalDeleted,
      deleteFinalText,
      retention: {
        sourceRetentionDays,
        aiRetentionDays,
        finalRetentionDays,
      },
    })
  } catch (error) {
    console.error("Retention cleanup failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Retention cleanup failed.",
      },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  return POST(req)
}
