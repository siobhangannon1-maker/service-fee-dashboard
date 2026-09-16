import { readDraftList, readDocumentAvailability } from '@/lib/report-writing/draft-list-reader';
import { toDraftListItem } from '@/lib/report-writing/draft-contract';
import { sensitiveApiAccess } from "@/lib/auth";
import { projectWorkflowRecovery, staleWorkflowStatus } from "@/lib/report-writing/workflow-recovery"
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const accessDenied = await sensitiveApiAccess("/api/report-writing/get-drafts");
  if (accessDenied) return accessDenied;

  try {
    const { searchParams } = new URL(req.url)
    const providerId = searchParams.get("providerId")

    const [durableDrafts, availability] = await Promise.all([
      readDraftList(supabase, providerId), readDocumentAvailability(supabase, providerId),
    ])
    // Auxiliary status enrichment must never discard successfully loaded History.
    let recovered = durableDrafts
    try { recovered = await projectWorkflowRecovery(supabase, durableDrafts) }
    catch { recovered = durableDrafts.map(staleWorkflowStatus) }
    const drafts = recovered.map((draft) => {
      const state = availability.get(String(draft.id))
      return toDraftListItem(draft, state && state.revision === draft.updated_at ? state.available : null)
    })
    return NextResponse.json({ success: true, drafts }, { headers: { 'Cache-Control': 'private, no-store' } })

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