import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { imageId, caption } = body

    if (!imageId) {
      return NextResponse.json(
        { success: false, error: "Missing imageId." },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("report_draft_images")
      .update({
        caption: caption || "",
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
    console.error(error)

    return NextResponse.json(
      { success: false, error: "Failed to update image." },
      { status: 500 }
    )
  }
}