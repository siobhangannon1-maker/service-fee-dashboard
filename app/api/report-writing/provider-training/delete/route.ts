import { trainingAccess, trainingItemAccess } from "@/lib/report-writing/training-authorization";
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
  const access = await trainingAccess();
  if (access.denied) return access.denied;

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

    const itemAccess = await trainingItemAccess(access.value, table, id);
    if (itemAccess.denied) return itemAccess.denied;

    const { error } = await supabase.from(table).delete().eq("id", id)
      .eq("provider_id", itemAccess.value)

    if (error) {
      return NextResponse.json(
        { success: false, error: "Training request could not be completed." },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete provider training item failed:")

    return NextResponse.json(
      {
        success: false,
        error:
          "Failed to delete provider training item.",
      },
      { status: 500 }
    )
  }
}
