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

function suggestRuleFromCase(input: {
  reportType: string
  templateFamily?: string
  aiDraft?: string
  finalLetter: string
}) {
  const ai = input.aiDraft || ""
  const final = input.finalLetter || ""
  const family = input.templateFamily || input.reportType

  const suggestions: string[] = []

  if (
    /savacol|articaine|lignocaine|suture|irrigat|haemostasis|postoperative instructions/i.test(ai) &&
    !/savacol|articaine|lignocaine|suture|irrigat|haemostasis|postoperative instructions/i.test(final)
  ) {
    suggestions.push(
      `For ${family}, do not convert clinical notes into procedural summaries. Follow the provider template and omit routine operative details unless abnormal or clinically important.`
    )
  }

  if (/Implant details|Implant Details|Site:|Implant type:|catalogue/i.test(final)) {
    suggestions.push(
      `For ${family}, include the structured implant details section when implant details are available: Site, implant type, implant catalogue number, healing cap, and expected healing period where documented.`
    )
  }

  if (/ready for restoration/i.test(final)) {
    suggestions.push(
      `For osseointegration letters, prefer outcome-focused wording such as "the implant is osseointegrated and ready for restoration" rather than reporting individual test values or procedural steps.`
    )
  }

  if (/Can you please|Please discuss|As discussed with you|your practice/i.test(final)) {
    suggestions.push(
      `When the provider is communicating with the referring dentist, preserve direct referrer communication such as "Can you please review..." or "Please discuss..." rather than converting it into a third-person summary.`
    )
  }

  if (/thanks again for referring|please contact me/i.test(final)) {
    suggestions.push(
      `For ${family}, include the provider-style closing paragraph when shown in provider examples. Use the referring dentist's first name when available.`
    )
  }

  if (suggestions.length === 0) {
    suggestions.push(
      `For ${family}, use this training case as an example of the provider's preferred structure, content selection, and wording. Follow the corrected final letter more closely than the original AI draft.`
    )
  }

  return suggestions.join("\n\n")
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(req.url)
    const providerId = searchParams.get("providerId")

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from("provider_training_cases")
      .select("*")
      .eq("provider_id", providerId)
      .order("created_at", { ascending: false })

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, cases: data || [] })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load training cases.",
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
    const reportType = clean(body.reportType) || "consultation_report"
    const templateFamily = clean(body.templateFamily)
    const clinicalNotes = clean(body.clinicalNotes)
    const aiDraft = clean(body.aiDraft)
    const finalLetter = clean(body.finalLetter)

    const modifiers = Array.isArray(body.modifiers)
      ? body.modifiers.map(clean).filter(Boolean)
      : []

    if (!providerId || !clinicalNotes || !finalLetter) {
      return NextResponse.json(
        {
          success: false,
          error: "Provider, clinical notes and final letter are required.",
        },
        { status: 400 }
      )
    }

    const suggestedRuleText = suggestRuleFromCase({
      reportType,
      templateFamily,
      aiDraft,
      finalLetter,
    })

    const { data, error } = await supabase
      .from("provider_training_cases")
      .insert({
        provider_id: providerId,
        report_type: reportType,
        template_family: templateFamily || null,
        modifiers,
        clinical_notes: clinicalNotes,
        ai_draft: aiDraft || null,
        final_letter: finalLetter,
        suggested_rule_text: suggestedRuleText,
        status: "draft",
      })
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, case: data })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to save training case.",
      },
      { status: 500 }
    )
  }
}