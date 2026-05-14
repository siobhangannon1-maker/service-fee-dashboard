import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const reportDraftId = searchParams.get("reportDraftId")

    if (!reportDraftId) {
      return NextResponse.json(
        { success: false, error: "Missing reportDraftId." },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("report_draft_images")
      .select("*")
      .eq("report_draft_id", reportDraftId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true })

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const images = await Promise.all(
      (data || []).map(async (image) => {
        const { data: signedUrlData, error: signedUrlError } =
          await supabase.storage
            .from("report-assets")
            .createSignedUrl(image.storage_path, 60 * 60)

        return {
          ...image,
          publicUrl: signedUrlError ? "" : signedUrlData.signedUrl,
        }
      })
    )

    return NextResponse.json({
      success: true,
      images,
    })
  } catch (error) {
    console.error(error)

    return NextResponse.json(
      { success: false, error: "Failed to fetch images." },
      { status: 500 }
    )
  }
}