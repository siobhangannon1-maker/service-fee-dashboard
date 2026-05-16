import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      imageId,
      caption,
      cropX,
      cropY,
      cropZoom,
      cropRotation,
      cropAspect,
      cropAreaX,
      cropAreaY,
      cropAreaWidth,
      cropAreaHeight,
      displayWidthPercent,
      displayAlignment,
      displayPageBreakBefore,
    } = body

    if (!imageId) {
      return NextResponse.json(
        { success: false, error: "Missing imageId." },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("report_draft_images")
      .update({
        caption: String(caption || ""),
        crop_x: Number(cropX ?? 0),
        crop_y: Number(cropY ?? 0),
        crop_zoom: Number(cropZoom ?? 1),
        crop_rotation: Number(cropRotation ?? 0),
        crop_aspect: String(cropAspect || "landscape"),
        crop_area_x: cropAreaX === null ? null : Number(cropAreaX),
        crop_area_y: cropAreaY === null ? null : Number(cropAreaY),
        crop_area_width: cropAreaWidth === null ? null : Number(cropAreaWidth),
        crop_area_height:
          cropAreaHeight === null ? null : Number(cropAreaHeight),
        display_width_percent: Number(displayWidthPercent ?? 60),
        display_alignment: String(displayAlignment || "center"),
        display_page_break_before: Boolean(displayPageBreakBefore),
      })
      .eq("id", imageId)
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      image: data,
    })
  } catch (error) {
    console.error("Update draft image failed:", error)

    return NextResponse.json(
      { success: false, error: "Failed to update image settings." },
      { status: 500 }
    )
  }
}