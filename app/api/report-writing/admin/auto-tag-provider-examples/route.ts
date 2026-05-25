import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing OPENAI_API_KEY." },
        { status: 500 }
      )
    }

    const { providerId, retagAll } = await req.json()

    if (!providerId) {
      return NextResponse.json(
        { success: false, error: "providerId is required." },
        { status: 400 }
      )
    }

    let query = supabase
      .from("provider_report_examples")
      .select("id, title, report_type, example_text, scenario_tags, scenario_summary")
      .eq("provider_id", providerId)
      .limit(100)

    if (!retagAll) {
      query = query.or("scenario_summary.is.null,scenario_tags.is.null")
    }

    const examplesResult = await query

    if (examplesResult.error) {
      return NextResponse.json(
        { success: false, error: examplesResult.error.message },
        { status: 500 }
      )
    }

    const examples = examplesResult.data || []
    let updated = 0
    const failures: Array<{ id: string; title: string | null; error: string }> = []

    for (const example of examples) {
      try {
        const prompt = `
Analyse this dental provider example letter.

Return JSON only.

Choose scenario_tags from this list only:
single_implant
multiple_implants
guided
graft
immediate
extraction
sinus_lift
membrane
provisionalisation
osseointegration
second_stage
socket_graft
periodontal
SPT
review
consultation
surgery
treatment
cbct_required
no_treatment
denture_implant
biopsy
crown_lengthening
frenectomy
peri_implantitis

Return:
{
  "scenario_summary": "short description",
  "scenario_tags": ["tag1", "tag2"]
}

Example title:
${example.title || ""}

Report type:
${example.report_type}

Example text:
${example.example_text}
`

        const completion = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "You classify dental provider example letters into scenario tags. Return valid JSON only.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        })

        const content = completion.choices[0]?.message?.content || ""

        const parsed = safeJsonParse<{
          scenario_summary: string
          scenario_tags: string[]
        }>(content, {
          scenario_summary: "",
          scenario_tags: [],
        })

        const allowedTags = new Set([
          "single_implant",
          "multiple_implants",
          "guided",
          "graft",
          "immediate",
          "extraction",
          "sinus_lift",
          "membrane",
          "provisionalisation",
          "osseointegration",
          "second_stage",
          "socket_graft",
          "periodontal",
          "SPT",
          "review",
          "consultation",
          "surgery",
          "treatment",
          "cbct_required",
          "no_treatment",
          "denture_implant",
          "biopsy",
          "crown_lengthening",
          "frenectomy",
          "peri_implantitis",
        ])

        const cleanTags = Array.from(
          new Set((parsed.scenario_tags || []).filter((tag) => allowedTags.has(tag)))
        )

        const updateResult = await supabase
          .from("provider_report_examples")
          .update({
            scenario_summary: parsed.scenario_summary || null,
            scenario_tags: cleanTags,
            updated_at: new Date().toISOString(),
          })
          .eq("id", example.id)

        if (updateResult.error) {
          failures.push({
            id: example.id,
            title: example.title,
            error: updateResult.error.message,
          })
        } else {
          updated += 1
        }
      } catch (error) {
        failures.push({
          id: example.id,
          title: example.title,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    return NextResponse.json({
      success: true,
      checked: examples.length,
      updated,
      failures,
    })
  } catch (error) {
    console.error("Auto-tag examples failed:", error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to auto-tag examples.",
      },
      { status: 500 }
    )
  }
}
