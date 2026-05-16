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

function makeTypeKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const providerId = searchParams.get("providerId")

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    const [
      providerResult,
      rulesResult,
      examplesResult,
      terminologyResult,
      correspondenceTypesResult,
      editExamplesResult,
    ] = await Promise.all([
      supabase
        .from("providers")
        .select("id, name")
        .eq("id", providerId)
        .maybeSingle(),

      supabase
        .from("provider_report_rules")
        .select("id, report_type, rule_text")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),

      supabase
        .from("provider_report_examples")
        .select("id, report_type, title, example_text")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),

      supabase
        .from("provider_terminology_rules")
        .select("id, spoken_or_written_text, preferred_text")
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false }),

      supabase
        .from("provider_correspondence_types")
        .select("id, type_key, label")
        .eq("provider_id", providerId)
        .order("label", { ascending: true }),

      supabase
        .from("provider_report_edit_examples")
        .select(
          "id, report_type, original_text, final_text, source, created_at, report_draft_id"
        )
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false })
        .limit(100),
    ])

    if (providerResult.error) {
      return NextResponse.json(
        { success: false, error: providerResult.error.message },
        { status: 500 }
      )
    }

    if (rulesResult.error) {
      return NextResponse.json(
        { success: false, error: rulesResult.error.message },
        { status: 500 }
      )
    }

    if (examplesResult.error) {
      return NextResponse.json(
        { success: false, error: examplesResult.error.message },
        { status: 500 }
      )
    }

    if (terminologyResult.error) {
      return NextResponse.json(
        { success: false, error: terminologyResult.error.message },
        { status: 500 }
      )
    }

    if (correspondenceTypesResult.error) {
      return NextResponse.json(
        { success: false, error: correspondenceTypesResult.error.message },
        { status: 500 }
      )
    }

    if (editExamplesResult.error) {
      return NextResponse.json(
        { success: false, error: editExamplesResult.error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      provider: providerResult.data,
      rules: rulesResult.data || [],
      examples: examplesResult.data || [],
      terminology: terminologyResult.data || [],
      correspondenceTypes: correspondenceTypesResult.data || [],
      editExamples: editExamplesResult.data || [],
    })
  } catch (error) {
    console.error("Load provider training failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load provider training.",
      },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const providerId = clean(body.providerId)
    const type = clean(body.type)

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    if (!type) {
      return NextResponse.json(
        { success: false, error: "Missing training type." },
        { status: 400 }
      )
    }

    if (type === "correspondence_type") {
      const label = clean(body.label)

      if (!label) {
        return NextResponse.json(
          { success: false, error: "Missing correspondence type label." },
          { status: 400 }
        )
      }

      const typeKey = makeTypeKey(label)

      if (!typeKey) {
        return NextResponse.json(
          { success: false, error: "Could not create correspondence type key." },
          { status: 400 }
        )
      }

      const { data, error } = await supabase
        .from("provider_correspondence_types")
        .upsert(
          {
            provider_id: providerId,
            type_key: typeKey,
            label,
            updated_at: new Date().toISOString(),
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

    if (type === "rule") {
      const reportType = clean(body.reportType) || "all"
      const ruleText = clean(body.ruleText)

      if (!ruleText) {
        return NextResponse.json(
          { success: false, error: "Missing rule text." },
          { status: 400 }
        )
      }

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
      const reportType = clean(body.reportType) || "consultation_report"
      const title = clean(body.title)
      const exampleText = clean(body.exampleText)

      if (!exampleText) {
        return NextResponse.json(
          { success: false, error: "Missing example text." },
          { status: 400 }
        )
      }

      const { data, error } = await supabase
        .from("provider_report_examples")
        .insert({
          provider_id: providerId,
          report_type: reportType,
          title: title || null,
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
      const spokenOrWrittenText = clean(body.spokenOrWrittenText)
      const preferredText = clean(body.preferredText)

      if (!spokenOrWrittenText || !preferredText) {
        return NextResponse.json(
          {
            success: false,
            error: "Missing terminology text or preferred text.",
          },
          { status: 400 }
        )
      }

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

    return NextResponse.json(
      { success: false, error: `Unsupported training type: ${type}` },
      { status: 400 }
    )
  } catch (error) {
    console.error("Save provider training failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save provider training.",
      },
      { status: 500 }
    )
  }
}
