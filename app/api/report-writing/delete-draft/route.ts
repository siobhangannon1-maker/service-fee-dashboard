import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const { draftId } = await req.json()

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 }
      )
    }

    const { data: images } = await supabase
      .from("report_draft_images")
      .select("storage_path")
      .eq("report_draft_id", draftId)

    const imagePaths =
      images?.map((image) => image.storage_path).filter(Boolean) || []

    if (imagePaths.length > 0) {
      await supabase.storage.from("report-assets").remove(imagePaths)
    }

    await supabase
      .from("report_writing_audit_events")
      .delete()
      .eq("report_draft_id", draftId)

    await supabase
      .from("report_draft_images")
      .delete()
      .eq("report_draft_id", draftId)

    const { error } = await supabase
      .from("report_drafts")
      .delete()
      .eq("id", draftId)

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { success: false, error: "Failed to delete draft." },
      { status: 500 }
    )
  }
}