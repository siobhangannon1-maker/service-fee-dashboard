import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const body = await req.json()

  const {
    imageId,
    caption,
    cropX,
    cropY,
    cropZoom,
    cropRotation,
    cropAspect,
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
      caption: caption || null,
      crop_x: Number(cropX || 0),
      crop_y: Number(cropY || 0),
      crop_zoom: Number(cropZoom || 1),
      crop_rotation: Number(cropRotation || 0),
      crop_aspect: cropAspect || "landscape",
      display_width_percent: Number(displayWidthPercent || 60),
      display_alignment: displayAlignment || "center",
      display_page_break_before: Boolean(displayPageBreakBefore),
      updated_at: new Date().toISOString(),
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
}