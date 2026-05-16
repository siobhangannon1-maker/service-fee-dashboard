import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function clean(value: unknown) {
  return String(value ?? "").trim()
}

const tableByType: Record<string, string> = {
  rule: "provider_report_rules",
  example: "provider_report_examples",
  terminology: "provider_terminology_rules",
  edit_example: "provider_report_edit_examples",
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const type = clean(body.type)
    const id = clean(body.id)

    if (!type || !id) {
      return NextResponse.json(
        { success: false, error: "Missing type or id." },
        { status: 400 }
      )
    }

    const table = tableByType[type]

    if (!table) {
      return NextResponse.json(
        { success: false, error: `Unsupported delete type: ${type}` },
        { status: 400 }
      )
    }

    const { error } = await supabase.from(table).delete().eq("id", id)

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete provider training item failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete provider training item.",
      },
      { status: 500 }
    )
  }
}
