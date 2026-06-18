import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Missing Supabase environment variables.")
  }

  return createClient(url, key)
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const body = await req.json()

    if (!body.id) {
      return NextResponse.json(
        { success: false, error: "Missing training case id." },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from("provider_training_cases")
      .delete()
      .eq("id", body.id)

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete training case.",
      },
      { status: 500 }
    )
  }
}