import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing Supabase environment variables.")
  return createClient(url, key)
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function makeKnowledgeKey(reportType: string, knowledgeType: string, category: string, text: string) {
  return `${reportType}_${knowledgeType}_${category}_${text}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 150)
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(req.url)
    const providerId = clean(searchParams.get("providerId"))
    const reportType = clean(searchParams.get("reportType"))
    const status = clean(searchParams.get("status")) || "active"

    if (!providerId) {
      return NextResponse.json({ success: false, error: "Missing providerId." }, { status: 400 })
    }

    let query = supabase
      .from("provider_knowledge")
      .select("*")
      .eq("provider_id", providerId)
      .eq("status", status)
      .order("confidence", { ascending: false })
      .order("updated_at", { ascending: false })

    if (reportType && reportType !== "all") {
      query = query.in("report_type", [reportType, "all"])
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const summary = (data || []).reduce((acc: Record<string, number>, item: any) => {
      acc[item.knowledge_type] = (acc[item.knowledge_type] || 0) + 1
      return acc
    }, {})

    return NextResponse.json({ success: true, knowledge: data || [], summary })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load provider knowledge." },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const body = await req.json()

    const providerId = clean(body.providerId)
    const reportType = clean(body.reportType) || "all"
    const knowledgeType = clean(body.knowledgeType) || "manual_rule"
    const category = clean(body.category) || "manual_rule"
    const knowledgeText = clean(body.knowledgeText)
    const evidenceSummary = clean(body.evidenceSummary)
    const confidence = Math.max(1, Math.min(100, Number(body.confidence || 100)))

    if (!providerId || !knowledgeText) {
      return NextResponse.json(
        { success: false, error: "Provider and knowledge text are required." },
        { status: 400 }
      )
    }

    const knowledgeKey = makeKnowledgeKey(reportType, knowledgeType, category, knowledgeText)

    const { data, error } = await supabase
      .from("provider_knowledge")
      .upsert(
        {
          provider_id: providerId,
          report_type: reportType,
          knowledge_type: knowledgeType,
          category,
          knowledge_key: knowledgeKey,
          knowledge_text: knowledgeText,
          evidence_summary: evidenceSummary || null,
          source: body.source || "manual",
          confidence,
          evidence_count: Number(body.evidenceCount || 1),
          status: "active",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider_id,report_type,knowledge_type,knowledge_key" }
      )
      .select()
      .maybeSingle()

    if (error) throw new Error(error.message)
    return NextResponse.json({ success: true, item: data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to save provider knowledge." },
      { status: 500 }
    )
  }
}
