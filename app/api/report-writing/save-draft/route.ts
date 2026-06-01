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

function cleanOrNull(value: unknown) {
  const cleaned = clean(value)
  return cleaned || null
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

async function updateLinkedQueueItem(params: {
  queueId?: string | null
  draftId: string
  status: string
  referrerName: string | null
  referrerAddress: string | null
  sourceText: string | null
  praktikaPatientId: string | null
}) {
  const queueId = clean(params.queueId)

  if (!queueId) return

  const queueUpdate: Record<string, unknown> = {
    report_draft_id: params.draftId,
    status: params.status === "approved" ? "completed" : "started",
    updated_at: new Date().toISOString(),
  }

  if (params.referrerName) queueUpdate.referrer_name = params.referrerName
  if (params.referrerAddress) queueUpdate.referrer_address = params.referrerAddress
  if (params.sourceText) queueUpdate.source_clinical_notes = params.sourceText
  if (params.praktikaPatientId) queueUpdate.praktika_patient_id = params.praktikaPatientId

  const { error } = await supabase
    .from("report_letter_queue")
    .update(queueUpdate)
    .eq("id", queueId)

  if (error) {
    console.warn("Draft saved, but linked queue item could not be updated:", error)
  }
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
      queueId,
    } = body

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId" },
        { status: 400 }
      )
    }

    const finalStatus = status || "draft"
    const finalReportType = reportType || "consultation_report"
    const finalReferrerName = cleanOrNull(referrerName)
    const finalReferrerAddress = cleanOrNull(referrerAddress)
    const finalSourceText = cleanOrNull(clinicalNotes)
    const finalPraktikaPatientId = cleanOrNull(praktikaPatientId)

    const aiText = clean(originalAiText) || clean(generatedReport)
    const finalText =
      clean(finalApprovedText) || clean(editedText) || clean(generatedReport)

    const insertPayload: Record<string, unknown> = {
      provider_id: providerId,
      created_by: providerId,
      patient_name: cleanOrNull(patientName),
      patient_dob: cleanOrNull(patientDob),
      referrer_name: finalReferrerName,
      referrer_address: finalReferrerAddress,
      report_type: finalReportType,
      source_type: sourceType || "clinical_notes",
      source_text: finalSourceText,
      ai_generated_text: aiText,
      edited_text: finalText,
      status: finalStatus,
      praktika_patient_id: finalPraktikaPatientId,
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

    await updateLinkedQueueItem({
      queueId,
      draftId: data.id,
      status: finalStatus,
      referrerName: finalReferrerName,
      referrerAddress: finalReferrerAddress,
      sourceText: finalSourceText,
      praktikaPatientId: finalPraktikaPatientId,
    })

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
        referrerNameSaved: Boolean(finalReferrerName),
        referrerAddressSaved: Boolean(finalReferrerAddress),
        linkedQueueId: clean(queueId) || null,
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
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to save draft",
      },
      { status: 500 }
    )
  }
}
