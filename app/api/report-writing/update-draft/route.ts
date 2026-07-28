import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  createReportAuditEvent,
  getAuditActor,
} from "@/lib/report-writing/audit"

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

  const { error } = await supabase
    .from("provider_report_edit_examples")
    .insert({
      provider_id: params.providerId,
      report_draft_id: params.draftId,
      report_type: params.reportType,
      original_text: params.originalText,
      final_text: params.finalText,
      source: params.source,
    })

  if (error) {
    console.warn("Draft updated, but learning example could not be saved:", error)
  }
}

async function updateLinkedQueueRows(params: {
  draftId: string
  referrerName?: string | null
  referrerAddress?: string | null
  sourceText?: string | null
  praktikaPatientId?: string | null
  status?: string | null
}) {
  const queueUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (params.referrerName !== undefined) {
    queueUpdate.referrer_name = params.referrerName
  }

  if (params.referrerAddress !== undefined) {
    queueUpdate.referrer_address = params.referrerAddress
  }

  if (params.sourceText !== undefined) {
    queueUpdate.source_clinical_notes = params.sourceText
  }

  if (params.praktikaPatientId !== undefined) {
    queueUpdate.praktika_patient_id = params.praktikaPatientId
  }

  /*
    A queue row is completed only when the letter is genuinely approved.
    Saving a typist draft or sending it for provider review must keep the
    queue row linked and recoverable.
  */
  if (params.status === "approved") {
    queueUpdate.status = "completed"
  } else if (
    params.status === "draft" ||
    params.status === "edited_by_typist" ||
    params.status === "awaiting_provider_approval"
  ) {
    queueUpdate.status = "started"
  }

  if (Object.keys(queueUpdate).length <= 1) return

  const { error } = await supabase
    .from("report_letter_queue")
    .update(queueUpdate)
    .eq("report_draft_id", params.draftId)

  if (error) {
    console.warn(
      "Draft updated, but linked queue row could not be updated:",
      error
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const actor = await getAuditActor()
    const now = new Date().toISOString()

    const {
      draftId,
      editedText,
      status,
      originalAiText,
      finalApprovedText,
      learnFromEdits,
      learningSource,
      praktikaPatientId,
      referrerName,
      referrerAddress,
      clinicalNotes,
      patientDob,
      patientName,
      reportType,
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
      updated_at: now,
    }

    if (typeof editedText === "string") {
      updatePayload.edited_text = editedText
    }

    if (Object.prototype.hasOwnProperty.call(body, "referrerName")) {
      updatePayload.referrer_name = cleanOrNull(referrerName)
    }

    if (Object.prototype.hasOwnProperty.call(body, "referrerAddress")) {
      updatePayload.referrer_address = cleanOrNull(referrerAddress)
    }

    if (Object.prototype.hasOwnProperty.call(body, "clinicalNotes")) {
      updatePayload.source_text = cleanOrNull(clinicalNotes)
    }

    if (Object.prototype.hasOwnProperty.call(body, "patientDob")) {
      updatePayload.patient_dob = cleanOrNull(patientDob)
    }

    if (Object.prototype.hasOwnProperty.call(body, "patientName")) {
      updatePayload.patient_name = cleanOrNull(patientName)
    }

    if (Object.prototype.hasOwnProperty.call(body, "reportType")) {
      updatePayload.report_type =
        cleanOrNull(reportType) ||
        existingDraft.report_type ||
        "consultation_report"
    }

    if (Object.prototype.hasOwnProperty.call(body, "praktikaPatientId")) {
      updatePayload.praktika_patient_id = cleanOrNull(praktikaPatientId)
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "typistInstructions") ||
      Object.prototype.hasOwnProperty.call(body, "typist_instructions")
    ) {
      updatePayload.typist_instructions = cleanOrNull(
        body.typistInstructions ?? body.typist_instructions
      )
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "typistQueries") ||
      Object.prototype.hasOwnProperty.call(body, "typist_queries")
    ) {
      updatePayload.typist_queries = cleanOrNull(
        body.typistQueries ?? body.typist_queries
      )
    }

    if (typeof status === "string" && status.trim()) {
      updatePayload.status = status

      if (status === "awaiting_provider_approval") {
        updatePayload.sent_for_provider_review_at =
          existingDraft.sent_for_provider_review_at || now
      }

      if (status === "approved") {
        updatePayload.provider_approved_at =
          existingDraft.provider_approved_at || now
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

    await updateLinkedQueueRows({
      draftId: data.id,
      referrerName: Object.prototype.hasOwnProperty.call(body, "referrerName")
        ? cleanOrNull(referrerName)
        : undefined,
      referrerAddress: Object.prototype.hasOwnProperty.call(
        body,
        "referrerAddress"
      )
        ? cleanOrNull(referrerAddress)
        : undefined,
      sourceText: Object.prototype.hasOwnProperty.call(body, "clinicalNotes")
        ? cleanOrNull(clinicalNotes)
        : undefined,
      praktikaPatientId: Object.prototype.hasOwnProperty.call(
        body,
        "praktikaPatientId"
      )
        ? cleanOrNull(praktikaPatientId)
        : undefined,
      status: typeof status === "string" ? status : null,
    })

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
        Object.prototype.hasOwnProperty.call(body, "praktikaPatientId") &&
        !status
          ? "Updated Praktika patient match"
          : status === "approved"
            ? "Approved report"
            : status === "awaiting_provider_approval"
              ? "Sent report to provider for approval"
              : status === "edited_by_typist" || status === "draft"
                ? "Saved draft report"
                : "Updated report",
      details: {
        status: data.status,
        sentForProviderReviewAt:
          status === "awaiting_provider_approval"
            ? data.sent_for_provider_review_at
            : null,
        praktikaPatientId: data.praktika_patient_id || null,
        referrerNameSaved: Boolean(data.referrer_name),
        referrerAddressSaved: Boolean(data.referrer_address),
        typistInstructionsSaved: Boolean(data.typist_instructions),
        typistQueriesSaved: Boolean(data.typist_queries),
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
