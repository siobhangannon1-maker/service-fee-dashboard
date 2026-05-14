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
    const { draftId, editedText, status } = body

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 }
      )
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof editedText === "string") {
      updatePayload.edited_text = editedText
    }

    if (typeof status === "string" && status.trim()) {
      updatePayload.status = status
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

    await createReportAuditEvent({
      reportDraftId: data.id,
      providerId: data.provider_id,
      patientName: data.patient_name,
      action: "Updated report",
      details: {
        status: data.status,
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