import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createReportAuditEvent, getAuditActor } from "@/lib/report-writing/audit"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function clean(value: unknown) {
  return String(value ?? "").trim()
}

async function saveLearningExample(params: {
  providerId: string
  draftId: string
  reportType: string
  originalText: string
  finalText: string
  source: string
}) {
  if (!params.originalText.trim()) return
  if (!params.finalText.trim()) return
  if (params.originalText.trim() === params.finalText.trim()) return

  await supabase.from("provider_report_edit_examples").insert({
    provider_id: params.providerId,
    report_draft_id: params.draftId,
    report_type: params.reportType,
    original_text: params.originalText,
    final_text: params.finalText,
    source: params.source,
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const actor = await getAuditActor()

    const {
      draftId,
      editedText,
      status,
      originalAiText,
      finalApprovedText,
      learnFromEdits,
      learningSource,
      praktikaPatientId,
    } = body

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 }
      )
    }

    const { data: existingDraft, error: existingError } = await supabase
      .from("report_drafts")
      .select("*")
      .eq("id", draftId)
      .single()

    if (existingError || !existingDraft) {
      return NextResponse.json(
        { success: false, error: "Draft not found." },
        { status: 404 }
      )
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof editedText === "string") {
      updatePayload.edited_text = editedText
    }

    if (Object.prototype.hasOwnProperty.call(body, "praktikaPatientId")) {
      updatePayload.praktika_patient_id = praktikaPatientId
        ? String(praktikaPatientId)
        : null
    }

    if (typeof status === "string" && status.trim()) {
      updatePayload.status = status

      if (status === "approved") {
        updatePayload.provider_approved_at =
          existingDraft.provider_approved_at || new Date().toISOString()
        updatePayload.approved_by_initials = actor.actorInitials
        updatePayload.approved_by_name = actor.actorFullName
      }
    }

    const { data, error } = await supabase
      .from("report_drafts")
      .update(updatePayload)
      .eq("id", draftId)
      .select()
      .single()

    if (error) {
      console.error("Update draft failed:", error)

      return NextResponse.json(
        {
          success: false,
          error: error.message,
          details: error,
        },
        { status: 500 }
      )
    }

    const aiText =
      clean(originalAiText) ||
      clean(existingDraft.ai_generated_text) ||
      clean(data.ai_generated_text)

    const finalText =
      clean(finalApprovedText) || clean(editedText) || clean(data.edited_text)

    if (status === "approved" && learnFromEdits) {
      await saveLearningExample({
        providerId: data.provider_id,
        draftId: data.id,
        reportType: data.report_type || "consultation_report",
        originalText: aiText,
        finalText,
        source: learningSource || "approval_edit",
      })
    }

    await createReportAuditEvent({
      reportDraftId: data.id,
      providerId: data.provider_id,
      patientName: data.patient_name,
      action:
        Object.prototype.hasOwnProperty.call(body, "praktikaPatientId") && !status
          ? "Updated Praktika patient match"
          : status === "approved"
            ? "Approved report"
            : "Updated report",
      details: {
        status: data.status,
        praktikaPatientId: data.praktika_patient_id || null,
        actorInitials: actor.actorInitials,
        actorFullName: actor.actorFullName,
        learningSaved:
          status === "approved" &&
          Boolean(learnFromEdits) &&
          aiText !== finalText,
      },
    })

    return NextResponse.json({
      success: true,
      draft: data,
    })
  } catch (error) {
    console.error("Update draft server error:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update draft.",
      },
      { status: 500 }
    )
  }
}
