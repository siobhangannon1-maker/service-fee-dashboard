import { NextResponse } from "next/server";
import OpenAI from "openai";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createEmbedding } from "@/lib/openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildKnowledgeSearchText({
  inboxItem,
  aiCase,
  latestDecision,
  draftCategory,
}: {
  inboxItem: any;
  aiCase: any;
  latestDecision: any;
  draftCategory: string;
}) {
  return `
Category: ${draftCategory}

Patient/inbox summary:
${inboxItem.summary || ""}

Suggested action:
${inboxItem.suggested_action || ""}

Reception notes:
${inboxItem.reception_notes || ""}

Sender:
${inboxItem.sender_name || ""} ${inboxItem.sender_email || ""}

AI case:
${JSON.stringify(aiCase, null, 2)}

Latest decision:
${JSON.stringify(latestDecision, null, 2)}
`.trim();
}

function formatKnowledgeChunks(chunks: any[]) {
  if (!chunks || chunks.length === 0) {
    return "No relevant Obsidian clinic knowledge was retrieved.";
  }

  return chunks
    .map((chunk, index) => {
      return `
Knowledge Source ${index + 1}
Title: ${chunk.title}
Heading: ${chunk.heading || "No heading"}
Similarity: ${Math.round((chunk.similarity || 0) * 100)}%

${chunk.content}
`.trim();
    })
    .join("\n\n---\n\n");
}

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await req.json();
    const { inboxItemId } = body;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId" },
        { status: 400 }
      );
    }

    const { data: inboxItem, error: inboxError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (inboxError || !inboxItem) {
      return NextResponse.json(
        { error: inboxError?.message || "Inbox item not found" },
        { status: 404 }
      );
    }

    const { data: aiCase, error: caseError } = await supabaseAdmin
      .from("ai_cases")
      .select("*")
      .eq("inbox_item_id", inboxItemId)
      .maybeSingle();

    if (caseError) {
      return NextResponse.json({ error: caseError.message }, { status: 500 });
    }

    if (!aiCase) {
      return NextResponse.json(
        { error: "Please run AI Brain analysis before generating a draft." },
        { status: 400 }
      );
    }

    const { data: latestDecision } = await supabaseAdmin
      .from("ai_decisions")
      .select("*")
      .eq("case_id", aiCase.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const draftCategory =
      aiCase.category ||
      inboxItem.category ||
      latestDecision?.decision?.category ||
      "unknown";

    const knowledgeSearchText = buildKnowledgeSearchText({
      inboxItem,
      aiCase,
      latestDecision,
      draftCategory,
    });

    const knowledgeEmbedding = await createEmbedding(knowledgeSearchText);

    const { data: knowledgeChunks, error: knowledgeError } =
      await supabaseAdmin.rpc("match_knowledge_chunks", {
        query_embedding: knowledgeEmbedding,
        match_count: 10,
        match_threshold: 0.2,
      });

    if (knowledgeError) {
      return NextResponse.json(
        { error: knowledgeError.message },
        { status: 500 }
      );
    }

    const formattedKnowledgeChunks = formatKnowledgeChunks(
      knowledgeChunks || []
    );

    const { data: learningRules, error: learningRulesError } =
      await supabaseAdmin
        .from("ai_learning_rules")
        .select("*")
        .eq("is_active", true)
        .or(`category.eq.${draftCategory},category.eq.all,category.is.null`)
        .order("created_at", { ascending: false })
        .limit(10);

    if (learningRulesError) {
      return NextResponse.json(
        { error: learningRulesError.message },
        { status: 500 }
      );
    }

    const { data: approvedExamples, error: examplesError } =
      await supabaseAdmin
        .from("ai_approved_examples")
        .select("*")
        .eq("is_active", true)
        .or(`category.eq.${draftCategory},category.eq.all,category.is.null`)
        .order("created_at", { ascending: false })
        .limit(5);

    if (examplesError) {
      return NextResponse.json(
        { error: examplesError.message },
        { status: 500 }
      );
    }

    const formattedLearningRules =
      learningRules && learningRules.length > 0
        ? learningRules
            .map((rule, index) => {
              return `${index + 1}. ${rule.title || "Untitled rule"}: ${
                rule.rule
              }`;
            })
            .join("\n")
        : "No active learning rules found for this category.";

    const formattedApprovedExamples =
      approvedExamples && approvedExamples.length > 0
        ? approvedExamples
            .map((example, index) => {
              return `
Example ${index + 1}: ${example.title || "Untitled example"}
Category: ${example.category || "all"}

Incoming message:
${example.incoming_message}

Approved reply subject:
${example.approved_reply_subject || ""}

Approved reply body:
${example.approved_reply_body}

Tone notes:
${example.tone_notes || ""}

Avoid notes:
${example.avoid_notes || ""}
`;
            })
            .join("\n---\n")
        : "No active approved examples found for this category.";

    const prompt = `
You are drafting a receptionist email for a specialist oral and maxillofacial surgery and periodontal practice.

Use:
1. The AI Brain analysis
2. The latest AI decision
3. The inbox item
4. Active learning rules
5. Active approved examples
6. Retrieved Obsidian clinic knowledge

Return ONLY valid JSON:

{
  "subject": "email subject",
  "body": "email body",
  "used_learning_rules": ["short list of rules you applied"],
  "used_examples": ["short list of examples that influenced the tone"],
  "used_knowledge": ["short list of Obsidian knowledge sources used"],
  "safety_notes": ["short list of safety considerations"]
}

Clinical and privacy rules:
- Do not give medical advice.
- Do not diagnose.
- Do not promise treatment.
- Do not say the patient has been accepted unless explicitly confirmed.
- Do not invent appointment times, fees, availability, clinician opinions, treatment plans, or clinical findings.
- Do not include unnecessary patient identifiers.
- If patient identity is uncertain, ask for confirmation rather than assuming.
- If DOB is missing and required, politely ask for DOB.
- If clinically urgent, do not provide clinical instructions; recommend urgent human clinical review.
- Escalate swelling, bleeding, trauma, severe pain, fever, breathing difficulty, swallowing difficulty, medication reactions and infection concerns.
- Human review is always required before sending.

Tone rules:
- Warm, calm, professional and concise.
- Sound like a specialist dental reception team.
- Match the style of approved examples, but do not copy patient details.
- Prefer clear next steps over long explanations.

Knowledge rules:
- Use retrieved Obsidian clinic knowledge where relevant.
- If retrieved knowledge conflicts with safety rules, follow safety rules.
- Do not mention "Obsidian", "knowledge chunks", embeddings, or internal source names to the patient.
`;

    const userContent = `
Draft category:
${draftCategory}

Retrieved Obsidian clinic knowledge:
${formattedKnowledgeChunks}

Practice learning rules:
${formattedLearningRules}

Approved historical examples:
${formattedApprovedExamples}

AI Brain case:
${JSON.stringify(aiCase, null, 2)}

Latest AI decision:
${JSON.stringify(latestDecision, null, 2)}

Inbox item:
${JSON.stringify(inboxItem, null, 2)}

Task:
Draft a safe receptionist reply using the approved practice style and relevant clinic knowledge.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
    });

    const raw = completion.choices[0]?.message?.content;

    if (!raw) {
      return NextResponse.json(
        { error: "No AI draft returned." },
        { status: 500 }
      );
    }

    const draft = JSON.parse(raw);

    const guidance = {
      category: draftCategory,
      used_learning_rules: draft.used_learning_rules || [],
      used_examples: draft.used_examples || [],
      used_knowledge: draft.used_knowledge || [],
      safety_notes: draft.safety_notes || [],
      learning_rules_count: learningRules?.length || 0,
      approved_examples_count: approvedExamples?.length || 0,
      knowledge_chunks_count: knowledgeChunks?.length || 0,
      learning_rule_ids: learningRules?.map((rule) => rule.id) || [],
      approved_example_ids: approvedExamples?.map((example) => example.id) || [],
      knowledge_sources:
        knowledgeChunks?.map((chunk: any) => ({
          id: chunk.id,
          document_id: chunk.document_id,
          title: chunk.title,
          heading: chunk.heading,
          similarity: chunk.similarity,
        })) || [],
    };

    const { data: savedDraft, error: draftError } = await supabaseAdmin
      .from("ai_email_drafts")
      .insert({
        inbox_item_id: inboxItemId,
        case_id: aiCase.id,
        subject: draft.subject,
        body: draft.body,
        status: "draft",
        guidance,
      })
      .select()
      .single();

    if (draftError) {
      return NextResponse.json({ error: draftError.message }, { status: 500 });
    }

    await supabaseAdmin.from("ai_case_events").insert({
      case_id: aiCase.id,
      event_type: "draft_generated",
      event_summary:
        "AI generated a receptionist email draft using Brain analysis, learning rules, approved examples and Obsidian clinic knowledge.",
      metadata: {
        draft,
        guidance,
        retrieved_knowledge: knowledgeChunks || [],
      },
    });

    return NextResponse.json({
      success: true,
      draft: savedDraft,
      guidance,
    });
  } catch (error: any) {
    console.error("Generate draft error:", error);

    return NextResponse.json(
      { error: error.message || "Something went wrong generating draft." },
      { status: 500 }
    );
  }
}