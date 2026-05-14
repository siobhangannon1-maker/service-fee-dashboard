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

function deidentifyText(text: string) {
  return text
    .replace(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, "[DATE]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[DATE]")
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "[PERSON NAME]")
    .replace(
      /\b\d{1,5}\s+[A-Za-z0-9\s]+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Lane|Ln|Place|Pl)\b/gi,
      "[ADDRESS]"
    )
    .replace(/\b04\d{2}\s?\d{3}\s?\d{3}\b/g, "[PHONE]")
    .replace(/\b0\d\s?\d{4}\s?\d{4}\b/g, "[PHONE]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/\bDOB[:\s]*[^\n,]+/gi, "DOB: [DOB]")
}

export async function GET() {
  const [providers, examples, customTypes] = await Promise.all([
    supabase
      .from("providers")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true }),

    supabase
      .from("provider_report_examples")
      .select("*, providers(name)")
      .order("created_at", { ascending: false }),

    supabase
      .from("provider_correspondence_types")
      .select("*")
      .order("label", { ascending: true }),
  ])

  if (providers.error || examples.error || customTypes.error) {
    return NextResponse.json(
      {
        success: false,
        error:
          providers.error?.message ||
          examples.error?.message ||
          customTypes.error?.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    providers: providers.data || [],
    examples: examples.data || [],
    defaultTypes,
    customTypes: customTypes.data || [],
  })
}

export async function POST(req: Request) {
  const body = await req.json()

  const {
    providerId,
    reportType,
    title,
    exampleText,
    actorFullName,
    actorEmail,
  } = body

  if (!providerId || !reportType || !exampleText) {
    return NextResponse.json(
      { success: false, error: "Missing required fields." },
      { status: 400 }
    )
  }

  const deidentifiedExample = deidentifyText(exampleText)

  const { data, error } = await supabase
    .from("provider_report_examples")
    .insert({
      provider_id: providerId,
      report_type: reportType,
      title: title || "Admin uploaded example",
      example_text: deidentifiedExample,
    })
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
    example: data,
  })
}