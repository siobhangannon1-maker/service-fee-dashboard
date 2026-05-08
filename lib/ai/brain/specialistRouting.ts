import OpenAI from "openai";

import { supabaseAdmin } from "@/lib/supabase/admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type OperationalRoutingKey =
  | "urgent_clinical"
  | "radiology_review"
  | "pathology_review"
  | "general_clinical";

export type SpecialistRoutingResult = {
  routing_key: OperationalRoutingKey;
  display_name: string;
  confidence: number;
  reason: string;
  should_create_trello_task: boolean;
  urgency: "low" | "medium" | "high";
  trello_board_id: string | null;
  trello_list_id: string;
  matched_rule_id: string | null;
};

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalise(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonMaybe(value: any) {
  if (!value) return value;

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function getBestSourceText(item: any) {
  return cleanText(
    [
      item.email_subject || item.subject || "",
      item.email_body || "",
      item.raw_text || "",
      item.body || "",
      item.extracted_text || "",
      item.summary || "",
      item.suggested_action || "",
      item.category || "",
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}

function getAttachmentSummary(item: any) {
  const attachmentDebug = parseJsonMaybe(item.attachment_debug);
  const importedAttachments = attachmentDebug?.imported_attachments || [];

  if (!Array.isArray(importedAttachments)) return "";

  return importedAttachments
    .map((attachment: any) => {
      const text = attachment.ocr_text || attachment.extracted_text || "";
      const status =
        attachment.ocr_status ||
        attachment.extraction_status ||
        (attachment.text_extracted ? "text_extracted" : "unknown");

      return [
        `Attachment: ${attachment.name || "Unnamed"}`,
        `Content type: ${attachment.content_type || "unknown"}`,
        `Status: ${status}`,
        text ? `Extracted text:\n${text}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

async function getActiveRoutingRules() {
  const { data, error } = await supabaseAdmin
    .from("ai_specialist_routing_rules")
    .select("*")
    .eq("is_active", true)
    .in("routing_key", [
      "urgent_clinical",
      "radiology_review",
      "pathology_review",
      "general_clinical",
    ])
    .order("priority", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

function findRule(rules: any[], routingKey: OperationalRoutingKey) {
  return rules.find((rule) => rule.routing_key === routingKey);
}

function countMatches(text: string, words: string[]) {
  return words.filter((word) => text.includes(normalise(word)));
}

function deterministicRoute({
  item,
  rules,
}: {
  item: any;
  rules: any[];
}) {
  const combinedText = normalise(
    [
      item.category,
      item.summary,
      item.suggested_action,
      item.email_subject,
      item.subject,
      item.raw_text,
      item.body,
      item.extracted_text,
      getAttachmentSummary(item),
    ]
      .filter(Boolean)
      .join(" ")
  );

  const urgentWords = [
    "urgent",
    "swelling",
    "infection",
    "severe pain",
    "bleeding",
    "trauma",
    "fever",
    "airway",
    "breathing",
    "swallowing",
    "paraesthesia",
    "numbness",
    "post op complication",
    "pus",
    "abscess",
  ];

  const pathologyWords = [
    "pathology",
    "histopathology",
    "histology",
    "biopsy",
    "specimen",
    "pathologist",
    "microscopy",
    "lab report",
  ];

  const radiologyWords = [
    "radiology",
    "radiograph",
    "xray",
    "x ray",
    "x-ray",
    "opg",
    "pa radiograph",
    "cbct",
    "scan",
    "imaging",
    "cone beam",
    "iomr",
  ];

  const urgentMatches = countMatches(combinedText, urgentWords);
  const pathologyMatches = countMatches(combinedText, pathologyWords);
  const radiologyMatches = countMatches(combinedText, radiologyWords);

  const urgentRule = findRule(rules, "urgent_clinical");
  const pathologyRule = findRule(rules, "pathology_review");
  const radiologyRule = findRule(rules, "radiology_review");
  const generalRule = findRule(rules, "general_clinical") || rules[0];

  if (urgentRule && urgentMatches.length > 0) {
    return {
      rule: urgentRule,
      confidence: Math.min(0.75 + urgentMatches.length * 0.05, 0.98),
      reason: `Urgent/high-risk wording detected: ${urgentMatches
        .slice(0, 6)
        .join(", ")}.`,
      urgency: "high" as const,
    };
  }

  if (pathologyRule && pathologyMatches.length > 0) {
    return {
      rule: pathologyRule,
      confidence: Math.min(0.75 + pathologyMatches.length * 0.05, 0.95),
      reason: `Pathology-related wording detected: ${pathologyMatches
        .slice(0, 6)
        .join(", ")}.`,
      urgency: "medium" as const,
    };
  }

  if (radiologyRule && radiologyMatches.length > 0) {
    return {
      rule: radiologyRule,
      confidence: Math.min(0.7 + radiologyMatches.length * 0.05, 0.93),
      reason: `Radiology/imaging wording detected: ${radiologyMatches
        .slice(0, 6)
        .join(", ")}.`,
      urgency: "medium" as const,
    };
  }

  return {
    rule: generalRule,
    confidence: 0.65,
    reason:
      "No urgent, radiology or pathology trigger was detected, so this was routed to the general clinician workflow.",
    urgency: "low" as const,
  };
}

function coerceRoutingKey(value: any): OperationalRoutingKey | null {
  if (
    value === "urgent_clinical" ||
    value === "radiology_review" ||
    value === "pathology_review" ||
    value === "general_clinical"
  ) {
    return value;
  }

  return null;
}

export async function routeSpecialistForInboxItem({
  inboxItemId,
  persist = true,
}: {
  inboxItemId: string;
  persist?: boolean;
}) {
  const { data: item, error: itemError } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (itemError || !item) {
    throw new Error(itemError?.message || "Inbox item not found.");
  }

  const rules = await getActiveRoutingRules();

  if (rules.length === 0) {
    throw new Error(
      "No active operational routing rules found. Expected urgent_clinical, radiology_review, pathology_review, and general_clinical."
    );
  }

  const deterministic = deterministicRoute({ item, rules });

  const sourceText = getBestSourceText(item);
  const attachmentText = getAttachmentSummary(item);

  const rulesForPrompt = rules.map((rule) => ({
    routing_key: rule.routing_key,
    display_name: rule.display_name,
    description: rule.description,
    keywords: rule.keywords,
    examples: rule.examples,
    priority: rule.priority,
  }));

  const prompt = `
You are a routing assistant for a specialist dental practice.

Your job is to route incoming email, referrals, reports, records requests and clinical correspondence into ONE operational Trello workflow bucket.

You are NOT diagnosing and NOT giving treatment advice.
You are only choosing the correct task-management bucket for staff/clinician review.

Return ONLY valid JSON:

{
  "routing_key": "urgent_clinical | radiology_review | pathology_review | general_clinical",
  "confidence": 0.0,
  "reason": "brief reason",
  "should_create_trello_task": true,
  "urgency": "low | medium | high"
}

Allowed workflow buckets:
${JSON.stringify(rulesForPrompt, null, 2)}

Hard routing rules:
- Urgent/high-risk clinical wording wins over everything else and routes to urgent_clinical.
- Pathology, histopathology, biopsy, specimen or lab result correspondence routes to pathology_review.
- Radiology, CBCT, OPG, PA radiograph, x-ray, scan, imaging or radiology report correspondence routes to radiology_review.
- Existing patient correspondence, records requests/transfers, non-urgent referral correspondence, booking/admin tasks and general clinician tasks route to general_clinical.
- If unsure and not urgent/radiology/pathology, choose general_clinical.
- Do not route by specialty type such as implant/oral surgery/perio. This practice uses operational workflow buckets.
`;

  const userContent = `
Item:
Subject: ${item.email_subject || item.subject || item.file_name || ""}
Patient: ${item.patient_name || "unknown"}
DOB: ${item.patient_dob || "unknown"}
Category: ${item.category || "unknown"}
Summary: ${item.summary || ""}
Suggested action: ${item.suggested_action || ""}

Email/body text:
${sourceText}

Attachment text:
${attachmentText}

Deterministic routing suggestion:
${JSON.stringify(
  {
    routing_key: deterministic.rule.routing_key,
    display_name: deterministic.rule.display_name,
    confidence: deterministic.confidence,
    reason: deterministic.reason,
    urgency: deterministic.urgency,
  },
  null,
  2
)}
`;

  let aiResult: any = null;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_ROUTING_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userContent },
      ],
    });

    aiResult = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch (error) {
    console.warn("AI operational routing failed, using deterministic route:", error);
  }

  const aiRoutingKey = coerceRoutingKey(aiResult?.routing_key);
  const aiRule = aiRoutingKey ? findRule(rules, aiRoutingKey) : null;
  const chosenRule = aiRule || deterministic.rule;

  const confidence =
    typeof aiResult?.confidence === "number" && aiRule
      ? Math.max(0, Math.min(aiResult.confidence, 0.99))
      : deterministic.confidence;

  const urgency =
    aiResult?.urgency === "high" ||
    aiResult?.urgency === "medium" ||
    aiResult?.urgency === "low"
      ? aiResult.urgency
      : deterministic.urgency;

  const result: SpecialistRoutingResult = {
    routing_key: chosenRule.routing_key,
    display_name: chosenRule.display_name,
    confidence,
    reason:
      (aiRule && aiResult?.reason) ||
      deterministic.reason ||
      `Routed to ${chosenRule.display_name}.`,
    should_create_trello_task:
      typeof aiResult?.should_create_trello_task === "boolean"
        ? aiResult.should_create_trello_task
        : true,
    urgency,
    trello_board_id: chosenRule.trello_board_id || null,
    trello_list_id: chosenRule.trello_list_id,
    matched_rule_id: chosenRule.id || null,
  };

  if (
    !result.trello_list_id ||
    result.trello_list_id.startsWith("REPLACE_WITH_")
  ) {
    throw new Error(
      `Routing rule ${result.routing_key} does not have a valid trello_list_id. Update ai_specialist_routing_rules in Supabase.`
    );
  }

  if (persist) {
    const { error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        recommended_specialist: result.routing_key,
        specialist_routing_reason: result.reason,
        specialist_routing_confidence: result.confidence,
        specialist_routing_status: result.should_create_trello_task
          ? "task_recommended"
          : "no_task_needed",
        specialist_routed_at: new Date().toISOString(),
        trello_board_id: result.trello_board_id,
        trello_list_id: result.trello_list_id,
      })
      .eq("id", inboxItemId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      actor_id: null,
      event_type: "operational_routing_completed",
      event_summary: `Routed to ${result.display_name}.`,
      metadata: result,
    });
  }

  return result;
}
