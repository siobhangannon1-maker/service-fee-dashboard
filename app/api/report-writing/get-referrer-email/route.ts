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
    const draftId = searchParams.get("draftId")

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 }
      )
    }

    const { data: draft, error: draftError } = await supabase
      .from("report_drafts")
      .select("id, referrer_name, emailed_to_referrer_email")
      .eq("id", draftId)
      .single()

    if (draftError || !draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found." },
        { status: 404 }
      )
    }

    if (draft.emailed_to_referrer_email) {
      return NextResponse.json({
        success: true,
        email: draft.emailed_to_referrer_email,
        source: "previous_email",
      })
    }

    if (!draft.referrer_name) {
      return NextResponse.json({
        success: true,
        email: "",
        source: "none",
      })
    }

    const { data: referrer } = await supabase
      .from("report_referrers")
      .select("email")
      .eq("name", draft.referrer_name)
      .maybeSingle()

    return NextResponse.json({
      success: true,
      email: referrer?.email || "",
      source: referrer?.email ? "report_referrers" : "none",
    })
  } catch (error) {
    console.error("Get referrer email failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get referrer email.",
      },
      { status: 500 }
    )
  }
}
