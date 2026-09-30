import { trainingAccess, trainingProviderAccess } from "@/lib/report-writing/training-authorization";
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
  const access = await trainingAccess(true);
  if (access.denied) return access.denied;

  const providers = await supabase.from("providers").select("id, name")
    .eq("is_active", true).order("name", { ascending: true });
  if (providers.error) return NextResponse.json({ success: false, error: "Training data could not be loaded." }, { status: 500 });
  const providerIds = (providers.data || []).map(provider => provider.id);
  const [examples, customTypes] = providerIds.length ? await Promise.all([
    supabase.from("provider_report_examples").select("*, providers(name)")
      .in("provider_id", providerIds).order("created_at", { ascending: false }),
    supabase.from("provider_correspondence_types").select("*")
      .in("provider_id", providerIds).order("label", { ascending: true }),
  ]) : [{ data: [], error: null }, { data: [], error: null }];

  if (providers.error || examples.error || customTypes.error) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Training data could not be loaded.",
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
  const access = await trainingAccess(true);
  if (access.denied) return access.denied;

  const body = await req.json()

  const {
    providerId,
    reportType,
    title,
    exampleText,
  } = body

  if (!providerId || !reportType || !exampleText) {
    return NextResponse.json(
      { success: false, error: "Missing required fields." },
      { status: 400 }
    )
  }

  const providerDenied = await trainingProviderAccess(access.value, providerId);
  if (providerDenied) return providerDenied;

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
      { success: false, error: "Training request could not be completed." },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    example: data,
  })
}