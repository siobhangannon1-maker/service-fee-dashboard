import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function makeTypeKey(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const providerId = searchParams.get("providerId")

  if (!providerId) {
    return NextResponse.json(
      { success: false, error: "Missing providerId" },
      { status: 400 }
    )
  }

  const [provider, rules, examples, terminology, correspondenceTypes] =
    await Promise.all([
      supabase
        .from("providers")
        .select("id, name")
        .eq("id", providerId)
        .single(),

      supabase
        .from("provider_report_rules")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),

      supabase
        .from("provider_report_examples")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),

      supabase
        .from("provider_terminology_rules")
        .select("*")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),

      supabase
        .from("provider_correspondence_types")
        .select("*")
        .eq("provider_id", providerId)
        .order("label", { ascending: true }),
    ])

  if (
    provider.error ||
    rules.error ||
    examples.error ||
    terminology.error ||
    correspondenceTypes.error
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          provider.error?.message ||
          rules.error?.message ||
          examples.error?.message ||
          terminology.error?.message ||
          correspondenceTypes.error?.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    provider: provider.data,
    rules: rules.data || [],
    examples: examples.data || [],
    terminology: terminology.data || [],
    correspondenceTypes: correspondenceTypes.data || [],
  })
}

export async function POST(req: Request) {
  const body = await req.json()

  const {
    providerId,
    type,
    reportType,
    ruleText,
    title,
    exampleText,
    spokenOrWrittenText,
    preferredText,
    label,
  } = body

  if (!providerId) {
    return NextResponse.json(
      { success: false, error: "Missing providerId" },
      { status: 400 }
    )
  }

  if (type === "rule") {
    const { data, error } = await supabase
      .from("provider_report_rules")
      .insert({
        provider_id: providerId,
        report_type: reportType,
        rule_text: ruleText,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, item: data })
  }

  if (type === "example") {
    const { data, error } = await supabase
      .from("provider_report_examples")
      .insert({
        provider_id: providerId,
        report_type: reportType,
        title,
        example_text: exampleText,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, item: data })
  }

  if (type === "terminology") {
    const { data, error } = await supabase
      .from("provider_terminology_rules")
      .insert({
        provider_id: providerId,
        spoken_or_written_text: spokenOrWrittenText,
        preferred_text: preferredText,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, item: data })
  }

  if (type === "correspondence_type") {
    const cleanLabel = String(label || "").trim()

    if (!cleanLabel) {
      return NextResponse.json(
        { success: false, error: "Missing correspondence type name." },
        { status: 400 }
      )
    }

    const typeKey = makeTypeKey(cleanLabel)

    const { data, error } = await supabase
      .from("provider_correspondence_types")
      .upsert(
        {
          provider_id: providerId,
          type_key: typeKey,
          label: cleanLabel,
        },
        {
          onConflict: "provider_id,type_key",
        }
      )
      .select()
      .single()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, item: data })
  }

  return NextResponse.json(
    { success: false, error: "Unknown training type" },
    { status: 400 }
  )
}