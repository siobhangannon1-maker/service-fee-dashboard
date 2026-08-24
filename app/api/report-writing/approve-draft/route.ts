import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createReportAuditEvent } from "@/lib/report-writing/audit"
import { processApprovedEdit } from "@/lib/report-writing/edit-learning"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function clean(value: unknown) {
  return String(value ?? "").trim()
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const draftId = clean(body.draftId)

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 }
      )
    }

    const { data: draftBeforeApproval, error: fetchError } = await supabase
      .from("report_drafts")
      .select("*")
      .eq("id", draftId)
      .single()

    if (fetchError || !draftBeforeApproval) {
      return NextResponse.json(
        { success: false, error: "Draft not found." },
        { status: 404 }
      )
    }

    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from("report_drafts")
      .update({
        status: "approved",
        provider_approved_at: now,
        updated_at: now,
      })
      .eq("id", draftId)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    /*
     * IMPORTANT LEARNING CHANGE
     * -------------------------
     * Do NOT directly insert the whole before/after letter into
     * provider_report_edit_examples here.
     *
     * processApprovedEdit() does all of the following:
     * - saves the edit as evidence
     * - prevents duplicate processing with a fingerprint
     * - analyses whether the edit contains reusable provider behaviour
     * - ignores patient-specific / factual corrections
     * - creates or reinforces structured provider_behaviours
     *
     * Raw edit examples remain evidence/audit data only. They are no longer
     * intended to directly drive future letter generation.
     */
    let learningResult = null

    const originalText = clean(draftBeforeApproval.ai_generated_text)
    const finalText = clean(draftBeforeApproval.edited_text)

    if (originalText && finalText && originalText !== finalText) {
      learningResult = await processApprovedEdit({
        providerId: clean(draftBeforeApproval.provider_id),
        draftId: clean(draftBeforeApproval.id),
        reportType:
          clean(draftBeforeApproval.report_type) || "consultation_report",
        originalText,
        finalText,
        source: "provider_approval",

        // This endpoint represents provider approval. If you later pass real
        // signed-in actor details into this route, replace these values with
        // those authenticated details.
        actor: {
          actorRole: "provider",
          actorUserId: null,
          actorFullName: null,
        } as any,

        approvedByProvider: true,
      })

      if (learningResult.error) {
        console.warn(
          "Provider edit learning completed with a warning:",
          learningResult.error
        )
      }
    }

    await createReportAuditEvent({
      reportDraftId: data.id,
      providerId: data.provider_id,
      patientName: data.patient_name,
      action: "Approved report",
      details: {
        reportType: data.report_type,
        providerSpecificLearningChecked: true,
        learningRequested: Boolean(learningResult?.requested),
        learningAnalysisStatus: learningResult?.analysisStatus || "not_requested",
        behavioursCreated: learningResult?.behavioursCreated || 0,
        behavioursReinforced: learningResult?.behavioursReinforced || 0,
      },
    })

    return NextResponse.json({
      success: true,
      draft: data,
      learning: learningResult,
    })
  } catch (error) {
    console.error("Approve draft failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to approve draft.",
      },
      { status: 500 }
    )
  }
}
