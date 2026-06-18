import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error("Missing Supabase environment variables.")
  return createClient(url, key)
}

function clean(value: unknown) {
  return String(value ?? "").trim()
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    const cleaned = text
      .trim()
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim()
    return JSON.parse(cleaned) as T
  } catch {
    return fallback
  }
}

type ConsolidationGroup = {
  keep_id: string
  archive_ids: string[]
  improved_behaviour_text?: string
  reason: string
}

type ConsolidationResult = {
  summary: string
  groups: ConsolidationGroup[]
  recommendations: string[]
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY.")

    const supabase = getSupabase()
    const body = await req.json()
    const providerId = clean(body.providerId)
    const reportType = clean(body.reportType) || "all"

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    let query = supabase
      .from("provider_behaviours")
      .select("id, report_type, category, behaviour_text, evidence_summary, confidence, support_count, updated_at")
      .eq("provider_id", providerId)
      .eq("status", "active")
      .order("report_type", { ascending: true })
      .order("category", { ascending: true })
      .order("confidence", { ascending: false })
      .limit(120)

    if (reportType !== "all") {
      query = query.in("report_type", [reportType, "all"])
    }

    const { data: behaviours, error } = await query
    if (error) throw new Error(error.message)

    if (!behaviours || behaviours.length < 2) {
      return NextResponse.json({
        success: true,
        result: {
          summary: "Not enough behaviours to consolidate.",
          merged_count: 0,
          archived_count: 0,
          reviewed_count: behaviours?.length || 0,
          merged_behaviours: [],
          recommendations: [],
        },
      })
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You consolidate duplicate dental provider behaviours. Return JSON only.",
        },
        {
          role: "user",
          content: `
Review these active provider behaviours and identify duplicates or near-duplicates.

Rules:
- Only merge behaviours that clearly express the same reusable provider preference.
- Do not merge behaviours that apply to different report types unless one is report_type "all" and clearly overlaps.
- Prefer keeping the behaviour with highest confidence and support_count.
- If helpful, propose improved wording for the kept behaviour.
- Do not invent new clinical preferences.

Return JSON only with this exact shape:
{
  "summary": "short summary",
  "groups": [
    {
      "keep_id": "id to keep",
      "archive_ids": ["ids to archive"],
      "improved_behaviour_text": "optional improved wording for kept behaviour",
      "reason": "why these were merged"
    }
  ],
  "recommendations": ["..."]
}

Behaviours:
${behaviours
  .map(
    (item, index) => `Behaviour ${index + 1}
ID: ${item.id}
Report type: ${item.report_type}
Category: ${item.category}
Confidence: ${item.confidence}
Seen: ${item.support_count}
Text: ${item.behaviour_text}
Evidence: ${item.evidence_summary || "none"}`
  )
  .join("\n\n---\n\n")}
`,
        },
      ],
    })

    const fallback: ConsolidationResult = {
      summary: "No consolidation performed.",
      groups: [],
      recommendations: [],
    }

    const analysis = safeJsonParse<ConsolidationResult>(
      completion.choices[0]?.message?.content || "",
      fallback
    )

    const mergedBehaviours: any[] = []
    let archivedCount = 0

    for (const group of analysis.groups || []) {
      const keepId = clean(group.keep_id)
      const archiveIds = Array.isArray(group.archive_ids)
        ? group.archive_ids.map(clean).filter(Boolean).filter((id) => id !== keepId)
        : []

      if (!keepId || archiveIds.length === 0) continue

      const kept = behaviours.find((item) => item.id === keepId)
      const archived = behaviours.filter((item) => archiveIds.includes(item.id))

      if (!kept || archived.length === 0) continue

      const totalSupport =
        Number(kept.support_count || 1) +
        archived.reduce((sum, item) => sum + Number(item.support_count || 1), 0)

      const maxConfidence = Math.max(
        Number(kept.confidence || 50),
        ...archived.map((item) => Number(item.confidence || 50))
      )

      const updatePayload: Record<string, unknown> = {
        support_count: totalSupport,
        confidence: Math.min(100, maxConfidence + 2),
        updated_at: new Date().toISOString(),
      }

      const improvedText = clean(group.improved_behaviour_text)
      if (improvedText) updatePayload.behaviour_text = improvedText

      const { error: updateError } = await supabase
        .from("provider_behaviours")
        .update(updatePayload)
        .eq("id", keepId)

      if (updateError) throw new Error(updateError.message)

      const { error: archiveError } = await supabase
        .from("provider_behaviours")
        .update({
          status: "archived",
          updated_at: new Date().toISOString(),
          evidence_summary: `Archived during consolidation. Merged into behaviour ${keepId}.`,
        })
        .in("id", archiveIds)

      if (archiveError) throw new Error(archiveError.message)

      archivedCount += archiveIds.length
      mergedBehaviours.push({
        kept_id: keepId,
        archived_ids: archiveIds,
        reason: clean(group.reason),
      })
    }

    return NextResponse.json({
      success: true,
      result: {
        summary: analysis.summary || "Consolidation complete.",
        merged_count: mergedBehaviours.length,
        archived_count: archivedCount,
        reviewed_count: behaviours.length,
        merged_behaviours: mergedBehaviours,
        recommendations: analysis.recommendations || [],
      },
    })
  } catch (error) {
    console.error("Consolidate provider behaviours failed:", error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to consolidate provider behaviours.",
      },
      { status: 500 }
    )
  }
}
