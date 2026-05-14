import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  try {
    const formData = await req.formData()

    const file = formData.get("file")
    const reportDraftId = formData.get("reportDraftId")
    const caption = formData.get("caption")

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "No file uploaded.",
        },
        { status: 400 }
      )
    }

    if (!reportDraftId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing reportDraftId.",
        },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const fileExt = file.name.split(".").pop()
    const fileName = `${crypto.randomUUID()}.${fileExt}`

    const storagePath = `draft-images/${reportDraftId}/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from("report-assets")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json(
        {
          success: false,
          error: uploadError.message,
        },
        { status: 500 }
      )
    }

    const { data, error } = await supabase
      .from("report_draft_images")
      .insert({
        report_draft_id: reportDraftId,
        storage_path: storagePath,
        original_filename: file.name,
        caption: String(caption || ""),
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
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
      {
        success: false,
        error: "Failed to upload image.",
      },
      { status: 500 }
    )
  }
}