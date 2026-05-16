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
      providerId,
      patientName,
      patientDob,
      referrerName,
      referrerAddress,
      reportType,
      clinicalNotes,
      generatedReport,
      editedText,
      originalAiText,
      finalApprovedText,
      learnFromEdits,
      learningSource,
      sourceType,
      status,
      praktikaPatientId,
    } = body

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId" },
        { status: 400 }
      )
    }

    const finalStatus = status || "draft"
    const finalReportType = reportType || "consultation_report"
    const aiText = clean(originalAiText) || clean(generatedReport)
    const finalText =
      clean(finalApprovedText) || clean(editedText) || clean(generatedReport)

    const insertPayload: Record<string, unknown> = {
      provider_id: providerId,
      created_by: providerId,
      patient_name: patientName || null,
      patient_dob: patientDob || null,
      referrer_name: referrerName || null,
      referrer_address: referrerAddress || null,
      report_type: finalReportType,
      source_type: sourceType || "clinical_notes",
      source_text: clinicalNotes || null,
      ai_generated_text: aiText,
      edited_text: finalText,
      status: finalStatus,
      praktika_patient_id: praktikaPatientId || null,
      drafted_by_initials: actor.actorInitials,
      drafted_by_name: actor.actorFullName,
      provider_approved_at:
        finalStatus === "approved" ? new Date().toISOString() : null,
    }

    if (finalStatus === "approved") {
      insertPayload.approved_by_initials = actor.actorInitials
      insertPayload.approved_by_name = actor.actorFullName
    }

    const { data, error } = await supabase
      .from("report_drafts")
      .insert(insertPayload)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    if (finalStatus === "approved" && learnFromEdits) {
      await saveLearningExample({
        providerId,
        draftId: data.id,
        reportType: finalReportType,
        originalText: aiText,
        finalText,
        source: learningSource || "typist_direct_approval",
      })
    }

    await createReportAuditEvent({
      reportDraftId: data.id,
      providerId,
      patientName,
      action:
        finalStatus === "approved"
          ? "Created and approved report"
          : "Created draft report",
      details: {
        reportType: finalReportType,
        sourceType: sourceType || "clinical_notes",
        status: finalStatus,
        actorInitials: actor.actorInitials,
        actorFullName: actor.actorFullName,
        learningSaved:
          finalStatus === "approved" &&
          Boolean(learnFromEdits) &&
          aiText !== finalText,
      },
    })

    return NextResponse.json({
      success: true,
      draft: data,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { success: false, error: "Failed to save draft" },
      { status: 500 }
    )
  }
}
