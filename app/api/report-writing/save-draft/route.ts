import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createReportAuditEvent } from "@/lib/report-writing/audit"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      providerId,
      patientName,
      patientDob,
      referrerName,
      referrerAddress,
      reportType,
      clinicalNotes,
      generatedReport,
      sourceType,
      status,
    } = body

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId" },
        { status: 400 }
      )
    }

    const finalStatus = status || "draft"

    const { data, error } = await supabase
      .from("report_drafts")
      .insert({
        provider_id: providerId,
        created_by: providerId,
        patient_name: patientName || null,
        patient_dob: patientDob || null,
        referrer_name: referrerName || null,
        referrer_address: referrerAddress || null,
        report_type: reportType,
        source_type: sourceType || "clinical_notes",
        source_text: clinicalNotes || null,
        ai_generated_text: generatedReport,
        edited_text: generatedReport,
        status: finalStatus,
        provider_approved_at:
          finalStatus === "approved" ? new Date().toISOString() : null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
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
        reportType,
        sourceType: sourceType || "clinical_notes",
        status: finalStatus,
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