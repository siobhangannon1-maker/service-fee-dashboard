import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("providers")
      .select("id, name, specialty, email, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true })

    if (error) {
      console.error("SUPABASE ERROR:", error)

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
      providers: data ?? [],
    })
  } catch (error) {
    console.error("SERVER ERROR:", error)

    return NextResponse.json(
      {
        success: false,
        error: "Server error loading providers",
      },
      { status: 500 }
    )
  }
}