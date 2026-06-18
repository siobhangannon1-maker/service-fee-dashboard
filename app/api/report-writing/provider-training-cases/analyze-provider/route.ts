import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const body = await req.json()

    const providerId = clean(body.providerId)

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "Missing providerId." },
        { status: 400 }
      )
    }

    const [providerResult, rulesResult, examplesResult, casesResult] =
      await Promise.all([
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
          .select("id, report_type, title, example_text, scenario_tags, scenario_summary, is_preferred")
          .eq("provider_id", providerId)
          .order("created_at", { ascending: false })
          .limit(50),

        supabase
          .from("provider_training_cases")
          .select("id, report_type, clinical_notes, final_letter, suggested_rule_text, approved_rule_text, training_attempts, best_generated_letter, created_at")
          .eq("provider_id", providerId)
          .order("created_at", { ascending: false })
          .limit(50),
      ])

    if (providerResult.error) throw new Error(providerResult.error.message)
    if (rulesResult.error) throw new Error(rulesResult.error.message)
    if (examplesResult.error) throw new Error(examplesResult.error.message)
    if (casesResult.error) throw new Error(casesResult.error.message)

    const provider = providerResult.data
    const rules = rulesResult.data || []
    const examples = examplesResult.data || []
    const cases = casesResult.data || []

    const prompt = `
You are analysing provider-specific AI dental letter training.

Your task is to review:
- existing provider rules
- provider examples
- training cases
- generated attempts and scores
- ideal final letters

Return JSON only.

Find:
1. repeated provider style patterns
2. rules that should be added
3. possible duplicate or overlapping rules
4. possible conflicting rules
5. useful provider profile summary
6. training quality observations

Do not invent clinical preferences.
Only infer patterns that are supported by the supplied data.
Prefer rules that generalise across multiple cases.
Do not suggest a rule if it appears to apply to only one unusual case unless it is clearly important.

Return JSON with this exact shape:
{
  "provider_summary": "short summary of this provider's letter style",
  "recommended_rules": [
    {
      "report_type": "report type or all",
      "rule_text": "rule text",
      "reason": "why this rule is recommended",
      "confidence": "high|medium|low",
      "supporting_case_count": number
    }
  ],
  "possible_duplicate_rules": [
    {
      "rule_ids": ["id1", "id2"],
      "summary": "why these overlap"
    }
  ],
  "possible_conflicting_rules": [
    {
      "rule_ids": ["id1", "id2"],
      "summary": "why these may conflict"
    }
  ],
  "example_recommendations": [
    {
      "example_id": "id",
      "recommendation": "keep|review|prefer",
      "reason": "why"
    }
  ],
  "training_observations": ["..."]
}

Provider:
${provider?.name || "Unknown provider"}

Existing rules:
${rules
  .map(
    (rule, index) =>
      `Rule ${index + 1}
ID: ${rule.id}
Report type: ${rule.report_type}
Text:
${rule.rule_text}`
  )
  .join("\n\n---\n\n") || "No rules."}

Provider examples:
${examples
  .map(
    (example, index) =>
      `Example ${index + 1}
ID: ${example.id}
Report type: ${example.report_type}
Title: ${example.title || "Untitled"}
Tags: ${(example.scenario_tags || []).join(", ") || "none"}
Summary: ${example.scenario_summary || "none"}
Preferred: ${example.is_preferred ? "yes" : "no"}
Text:
${example.example_text}`
  )
  .join("\n\n---\n\n") || "No examples."}

Training cases:
${cases
  .map((trainingCase, index) => {
    const attempts = Array.isArray(trainingCase.training_attempts)
      ? trainingCase.training_attempts
      : []

    return `Training Case ${index + 1}
ID: ${trainingCase.id}
Report type: ${trainingCase.report_type}
Created: ${trainingCase.created_at}
Suggested rule:
${trainingCase.approved_rule_text || trainingCase.suggested_rule_text || "none"}

Scores:
${attempts
  .map(
    (attempt: any) =>
      `Attempt ${attempt.attempt_number}: ${attempt.score}/100
Suggested rule: ${attempt.suggested_rule || "none"}`
  )
  .join("\n") || "No attempts."}

Ideal final letter:
${trainingCase.final_letter}

Best generated letter:
${trainingCase.best_generated_letter || "none"}`
  })
  .join("\n\n---\n\n") || "No training cases."}
`

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You analyse provider-specific dental AI training data and return JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    })

    const fallback = {
      provider_summary: "",
      recommended_rules: [],
      possible_duplicate_rules: [],
      possible_conflicting_rules: [],
      example_recommendations: [],
      training_observations: [],
    }

    const analysis = safeJsonParse(
      completion.choices[0]?.message?.content || "",
      fallback
    )

    return NextResponse.json({
      success: true,
      analysis,
      counts: {
        rules: rules.length,
        examples: examples.length,
        trainingCases: cases.length,
      },
    })
  } catch (error) {
    console.error("Analyze provider training failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to analyse provider training.",
      },
      { status: 500 }
    )
  }
}