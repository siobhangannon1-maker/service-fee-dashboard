import { sensitiveApiAccess } from "@/lib/auth";
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createReportAuditEvent, getAuditActor } from "@/lib/report-writing/audit"
import { noLearningRequested, processApprovedEdit } from "@/lib/report-writing/edit-learning"

import { approvalResponse, isTypistApproval } from "@/lib/report-writing/typist-approval-stream"

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

async function updateLinkedQueueRows(params: {
  draftId: string
  referrerName?: string | null
  referrerAddress?: string | null
  sourceText?: string | null
  praktikaPatientId?: string | null
  status?: string | null
  approvalQueueId?: string | null
}) {
  const queueUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (params.referrerName !== undefined) queueUpdate.referrer_name = params.referrerName
  if (params.referrerAddress !== undefined) queueUpdate.referrer_address = params.referrerAddress
  if (params.sourceText !== undefined) queueUpdate.source_clinical_notes = params.sourceText
  if (params.praktikaPatientId !== undefined) queueUpdate.praktika_patient_id = params.praktikaPatientId

  // Approval finishes authoring, not the external upload/icon workflow.
  if (
    params.status === "draft" ||
    params.status === "edited_by_typist" ||
    params.status === "awaiting_provider_approval"
  ) {
    queueUpdate.status = "started"
  }

  if (Object.keys(queueUpdate).length <= 1 && !(params.approvalQueueId || "").trim()) return

  if (Object.keys(queueUpdate).length > 1) {
    const { error } = await supabase
      .from("report_letter_queue")
      .update(queueUpdate)
      .eq("report_draft_id", params.draftId)

    if (error) {
      console.warn("Draft updated, but linked queue row could not be updated:", error)
    }
  }

  // This is the image-workspace browser's former completion attempt, moved
  // before acknowledgement. Existing-draft approvals retain their queue status.
  const queueId = (params.approvalQueueId || "").trim()
  if (!queueId) return
  try {
    const { data: queue, error } = await supabase.from("report_letter_queue")
      .update({ status: "completed", report_draft_id: params.draftId,
        updated_at: new Date().toISOString() })
      .eq("id", queueId)
      .select("id, provider_id, patient_first_name, patient_last_name").single()
    if (error || !queue) {
      console.warn("Approved image workspace, but linked queue completion could not be saved.")
      return
    }
    const queueActor = await getAuditActor()
    await createReportAuditEvent({
      reportDraftId: params.draftId,
      providerId: queue.provider_id,
      patientName: [queue.patient_first_name, queue.patient_last_name].filter(Boolean).join(" "),
      action: "Completed queue item",
      details: { queueId: queue.id, queueStatus: "completed", reportDraftId: params.draftId,
        actorInitials: queueActor.actorInitials, actorFullName: queueActor.actorFullName,
        referrerCached: false, clinicalNotesCached: false },
    })
  } catch {
    // Preserve best-effort queue/audit handling; approval is already persisted.
    console.warn("Approved image workspace linked queue completion/audit attempt failed.")
  }
}

export async function POST(req: Request) {
  const accessDenied = await sensitiveApiAccess("/api/report-writing/update-draft");
  if (accessDenied) return accessDenied;

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
      unapprove,
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

    const conflict = () => NextResponse.json({
      success: false,
      code: "draft_revision_conflict",
      error: "Draft changed. Reload the letter before saving or approving. Your changes have not been saved.",
      reloadRequired: true,
      draftId: existingDraft.id,
    }, { status: 409 })

    // Preserve the exact database timestamp (including microseconds) as the token.
    // Missing tokens must never fall back to the revision read by this request.
    if (!Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt") ||
        body.expectedUpdatedAt !== existingDraft.updated_at ||
        (body.expectedUpdatedAt !== null &&
          (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))))) {
      return conflict()
    }

    // Every write advances the revision, even with a frozen/backward clock.
    // Parsing is only for choosing a strictly later millisecond, never equality.
    const updatePayload: Record<string, unknown> = {
      updated_at: new Date(Math.max(
        Date.now(), (Date.parse(existingDraft.updated_at || "") || 0) + 1
      )).toISOString(),
    }

    if (typeof editedText === "string") updatePayload.edited_text = editedText

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

    const isUnapproving =
      Boolean(unapprove) &&
      existingDraft.status === "approved" &&
      status === "awaiting_provider_approval"

    const isApproving = status === "approved" && existingDraft.status !== "approved"

    if (typeof status === "string" && status.trim()) {
      updatePayload.status = status

      if (status === "awaiting_provider_approval") {
        updatePayload.sent_for_provider_review_at = isUnapproving
          ? now
          : existingDraft.sent_for_provider_review_at || now
      }

      if (isUnapproving) {
        updatePayload.provider_approved_at = null
        updatePayload.approved_by_initials = null
        updatePayload.approved_by_name = null
      }

      if (status === "approved") {
        if (isApproving) {
          updatePayload.provider_approved_at = now
          updatePayload.approved_by_initials = actor.actorInitials
          updatePayload.approved_by_name = actor.actorFullName
        }
      }
    }

    const autosave = learningSource === "typist_autosave"
    if (autosave && status !== existingDraft.status) return conflict()

    // All content/status/metadata writes compare the client's loaded revision and
    // the authoritative status read above in the same database UPDATE.
    let write = supabase.from("report_drafts").update(updatePayload).eq("id", draftId)
    write = existingDraft.status == null
      ? write.is("status", null)
      : write.eq("status", existingDraft.status)
    write = existingDraft.updated_at == null
      ? write.is("updated_at", null)
      : write.eq("updated_at", body.expectedUpdatedAt)
    const { data, error } = await write.select().maybeSingle()
    if (!error && !data) {
      return conflict()
    }

    if (error) {
      console.error("Update draft failed:", error)
      return NextResponse.json(
        { success: false, error: error.message, details: error },
        { status: 500 }
      )
    }

    await updateLinkedQueueRows({
      draftId: data.id,
      referrerName: Object.prototype.hasOwnProperty.call(body, "referrerName")
        ? cleanOrNull(referrerName)
        : undefined,
      referrerAddress: Object.prototype.hasOwnProperty.call(body, "referrerAddress")
        ? cleanOrNull(referrerAddress)
        : undefined,
      sourceText: Object.prototype.hasOwnProperty.call(body, "clinicalNotes")
        ? cleanOrNull(clinicalNotes)
        : undefined,
      praktikaPatientId: Object.prototype.hasOwnProperty.call(body, "praktikaPatientId")
        ? cleanOrNull(praktikaPatientId)
        : undefined,
      status: typeof status === "string" ? status : null,
      approvalQueueId: status === "approved" &&
        clean(learningSource) === "typist_image_workspace_final_save" ? cleanOrNull(body.queueId) : null,
    })

    const aiText =
      clean(originalAiText) ||
      clean(existingDraft.ai_generated_text) ||
      clean(data.ai_generated_text)

    const finalText =
      clean(finalApprovedText) || clean(editedText) || clean(data.edited_text)

    const source = clean(learningSource) || "approval_edit"
    return await approvalResponse({
      draft: data,
      initialLearning: { ...noLearningRequested(), requested: Boolean(learnFromEdits),
        analysisStatus: learnFromEdits ? "pending" : "not_requested" },
      typist: isTypistApproval(status, source),
      synchronous: async () => {
        let learning = noLearningRequested()
        if (status === "approved" && Boolean(learnFromEdits)) {
          learning = await processApprovedEdit({
            providerId: data.provider_id,
            draftId: data.id,
            reportType: data.report_type || "consultation_report",
            originalText: aiText,
            finalText,
            source,
            actor,
            approvedByProvider:
              actor.actorRole === "provider" || actor.actorRole === "admin",
          })
        }
        return learning
      },
      audit: async (learning) => {
        await createReportAuditEvent({
          reportDraftId: data.id,
          providerId: data.provider_id,
          patientName: data.patient_name,
          action:
            Object.prototype.hasOwnProperty.call(body, "praktikaPatientId") && !status
              ? "Updated Praktika patient match"
              : isUnapproving
                ? "Unapproved report"
                : isApproving
                  ? "Approved report"
                  : status === "awaiting_provider_approval"
                    ? "Sent report to provider for approval"
                    : status === "edited_by_typist" || status === "draft"
                      ? "Saved draft report"
                      : "Updated report",
          details: {
            status: data.status,
            unapproved: isUnapproving,
            previousStatus: existingDraft.status,
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
            actorRole: actor.actorRole,
            learning,
          },
        })
      },
    })
  } catch (error) {
    console.error("Update draft server error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update draft.",
      },
      { status: 500 }
    )
  }
}
