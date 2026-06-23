import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const defaultTypes = [
  { value: "consultation_report", label: "Consultation Report" },
  { value: "treatment_report", label: "Treatment Report" },
  { value: "review", label: "Review" },
  { value: "SPT_report", label: "SPT Report" },
  { value: "osseointegration_letter", label: "Osseointegration Letter" },
  { value: "surgery_report", label: "Surgery Report" },
]

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get("providerId")

  if (!providerId) {
    return NextResponse.json(
      { success: false, error: "Missing providerId" },
      { status: 400 },
    )
  }

  const { data: customRows, error: customError } = await supabase
    .from("provider_correspondence_types")
    .select("type_key, label")
    .eq("provider_id", providerId)
    .order("label", { ascending: true })

  if (customError) {
    return NextResponse.json(
      { success: false, error: customError.message },
      { status: 500 },
    )
  }

  const { data: settingsRows, error: settingsError } = await supabase
    .from("provider_report_type_settings")
    .select("report_type, label, is_enabled, display_order")
    .eq("provider_id", providerId)

  if (settingsError) {
    return NextResponse.json(
      { success: false, error: settingsError.message },
      { status: 500 },
    )
  }

  const customTypes =
    customRows?.map((type) => ({
      value: type.type_key,
      label: type.label,
    })) || []

  const settingsByType = new Map(
    (settingsRows || []).map((setting) => [setting.report_type, setting]),
  )

  const seen = new Set<string>()

  const types = [...defaultTypes, ...customTypes]
    .filter((type) => {
      if (seen.has(type.value)) return false
      seen.add(type.value)
      return true
    })
    .map((type, index) => {
      const setting = settingsByType.get(type.value)

      return {
        value: type.value,
        label: setting?.label || type.label,
        is_enabled:
          typeof setting?.is_enabled === "boolean"
            ? setting.is_enabled
            : true,
        display_order:
          typeof setting?.display_order === "number"
            ? setting.display_order
            : index + 1000,
      }
    })
    .filter((type) => type.is_enabled)
    .sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order
      }

      return a.label.localeCompare(b.label)
    })
    .map(({ value, label }) => ({ value, label }))

  return NextResponse.json({
    success: true,
    types,
  })
}