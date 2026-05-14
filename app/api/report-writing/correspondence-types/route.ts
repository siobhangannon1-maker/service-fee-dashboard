import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
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
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from("provider_correspondence_types")
    .select("type_key, label")
    .eq("provider_id", providerId)
    .order("label", { ascending: true })

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  const customTypes =
    data?.map((type) => ({
      value: type.type_key,
      label: type.label,
    })) || []

  return NextResponse.json({
    success: true,
    types: [...defaultTypes, ...customTypes],
  })
}