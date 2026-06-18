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

function clean(value: unknown) {
  return String(value ?? "").trim()
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(req.url)
    const providerId = clean(searchParams.get("providerId"))

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("provider_report_type_settings")
      .select("id, provider_id, report_type, label, is_enabled, display_order, updated_at")
      .eq("provider_id", providerId)
      .order("display_order", { ascending: true })
      .order("label", { ascending: true })

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, settings: data || [] })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load report type settings.",
      },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const body = await req.json()

    const providerId = clean(body.providerId)
    const reportType = clean(body.reportType)
    const label = clean(body.label) || reportType.replace(/_/g, " ")
    const displayOrder = Number.isFinite(Number(body.displayOrder))
      ? Number(body.displayOrder)
      : 100
    const isEnabled = Boolean(body.isEnabled)

    if (!providerId || !reportType) {
      return NextResponse.json(
        { success: false, error: "Provider and report type are required." },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("provider_report_type_settings")
      .upsert(
        {
          provider_id: providerId,
          report_type: reportType,
          label,
          is_enabled: isEnabled,
          display_order: displayOrder,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider_id,report_type" }
      )
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, setting: data })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save report type setting.",
      },
      { status: 500 }
    )
  }
}
