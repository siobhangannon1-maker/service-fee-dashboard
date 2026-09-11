import { projectWorkflowRecovery, staleWorkflowStatus } from "@/lib/report-writing/workflow-recovery"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const providerId = searchParams.get("providerId")

    let query = supabase
      .from("report_drafts")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (providerId && providerId !== "all") {
      query = query.eq("provider_id", providerId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json(
        { success: false, error: "Failed to load report drafts." },
        { status: 500 }
      )
    }

    const durableDrafts = data || []
    // Auxiliary status enrichment must never discard successfully loaded History.
    let recovered = durableDrafts
    try { recovered = await projectWorkflowRecovery(supabase, durableDrafts) }
    catch { recovered = durableDrafts.map(staleWorkflowStatus) }
    const drafts = recovered.map((draft: any) => ({
      ...draft,
      status: draft.status || "draft",
      clinical_notes:
        draft.clinical_notes ||
        draft.source_clinical_notes ||
        draft.source_text ||
        null,
      source_clinical_notes:
        draft.source_clinical_notes ||
        draft.clinical_notes ||
        draft.source_text ||
        null,
      typist_instructions: draft.typist_instructions || null,
    }))

    return NextResponse.json({ success: true, drafts })
  } catch {

    return NextResponse.json(
      {
        success: false,
        error: "Failed to load report drafts.",
      },
      { status: 500 }
    )
  }
}