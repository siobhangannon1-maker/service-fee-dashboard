import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createReportAuditEvent } from "@/lib/report-writing/audit"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function hasMeaningfulEdit(originalText: string | null, finalText: string | null) {
  const original = String(originalText || "").trim()
  const final = String(finalText || "").trim()

  if (!original || !final) return false
  if (original === final) return false

  const differenceSize = Math.abs(original.length - final.length)
  return differenceSize > 20 || original.slice(0, 500) !== final.slice(0, 500)
}

export async function POST(req: Request) {
  try {
    const { draftId } = await req.json()

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

    const { data, error } = await supabase
      .from("report_drafts")
      .update({
        status: "approved",
        provider_approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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

    if (
      hasMeaningfulEdit(
        draftBeforeApproval.ai_generated_text,
        draftBeforeApproval.edited_text
      )
    ) {
      const { error: learningError } = await supabase
        .from("provider_report_edit_examples")
        .insert({
          provider_id: draftBeforeApproval.provider_id,
          report_type: draftBeforeApproval.report_type,
          original_text: draftBeforeApproval.ai_generated_text,
          final_text: draftBeforeApproval.edited_text,
          created_from_draft_id: draftBeforeApproval.id,
        })

      if (learningError) {
        console.error("Failed to save provider edit-learning example:", learningError)
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
      },
    })

    return NextResponse.json({
      success: true,
      draft: data,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { success: false, error: "Failed to approve draft." },
      { status: 500 }
    )
  }
}