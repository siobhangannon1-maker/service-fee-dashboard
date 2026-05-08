import OpenAI from "openai";

import {
  classifyOperationalWorkflow,
  getWorkflowSourceText,
} from "@/lib/ai/brain/operationalWorkflow";
import { supabaseAdmin } from "@/lib/supabase/admin";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type ClinicianRoutingResult = {
  clinician_key: string | null;
  clinician_name: string | null;
  confidence: number;
  reason: string;
  trello_board_id: string | null;
  trello_list_id: string | null;
  workflow_kind: string;
};

function normalise(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(normalise(word)));
}

async function getClinicians() {
  const { data, error } = await supabaseAdmin
    .from("ai_clinicians")
    .select("*")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);

  return data || [];
}

async function getRules() {
  const { data, error } = await supabaseAdmin
    .from("ai_clinician_routing_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error) throw new Error(error.message);

  return data || [];
}

function listIdForWorkflow(clinician: any, workflowKind: string) {
  if (workflowKind === "urgent_clinical") return clinician.urgent_list_id;
  if (workflowKind === "radiology_review") return clinician.radiology_results_list_id;
  if (workflowKind === "pathology_review") return clinician.pathology_results_list_id;
  return clinician.general_list_id;
}

function deterministicClinicianRoute({
  text,
  workflowKind,
  clinicians,
  rules,
}: {
  text: string;
  workflowKind: string;
  clinicians: any[];
  rules: any[];
}) {
  const normalisedText = normalise(text);

  for (const rule of rules) {
    const workflowKinds = Array.isArray(rule.workflow_kinds)
      ? rule.workflow_kinds
      : [];

    if (workflowKinds.length > 0 && !workflowKinds.includes(workflowKind)) {
      continue;
    }

    if (rule.match_type === "fallback") continue;

    const keywords = [
      ...(Array.isArray(rule.keywords) ? rule.keywords : []),
      ...(Array.isArray(rule.referring_practitioner_keywords)
        ? rule.referring_practitioner_keywords
        : []),
    ];

    if (keywords.length && includesAny(normalisedText, keywords)) {
      const clinician = clinicians.find(
        (candidate) => candidate.clinician_key === rule.clinician_key
      );

      if (clinician) {
        return {
          clinician,
          confidence: 0.85,
          reason: `Matched clinician routing rule: ${rule.rule_name}.`,
        };
      }
    }
  }

  for (const clinician of clinicians) {
    const keywords = [
      ...(Array.isArray(clinician.keywords) ? clinician.keywords : []),
      ...(Array.isArray(clinician.referring_practitioner_keywords)
        ? clinician.referring_practitioner_keywords
        : []),
    ];

    if (keywords.length && includesAny(normalisedText, keywords)) {
      return {
        clinician,
        confidence: 0.75,
        reason: `Matched clinician keyword for ${clinician.display_name}.`,
      };
    }
  }

  const fallbackRule = rules.find((rule) => {
    const workflowKinds = Array.isArray(rule.workflow_kinds)
      ? rule.workflow_kinds
      : [];

    return (
      rule.match_type === "fallback" &&
      (workflowKinds.length === 0 || workflowKinds.includes(workflowKind))
    );
  });

  if (fallbackRule) {
    const clinician = clinicians.find(
      (candidate) => candidate.clinician_key === fallbackRule.clinician_key
    );

    if (clinician) {
      return {
        clinician,
        confidence: 0.45,
        reason: `Used fallback clinician routing rule: ${fallbackRule.rule_name}.`,
      };
    }
  }

  return null;
}

export async function routeClinicianForInboxItem({
  inboxItemId,
  persist = true,
}: {
  inboxItemId: string;
  persist?: boolean;
}): Promise<ClinicianRoutingResult> {
  const { data: item, error } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .single();

  if (error || !item) {
    throw new Error(error?.message || "Inbox item not found.");
  }

  const workflow = await classifyOperationalWorkflow({
    inboxItemId,
    persist,
  });

  const clinicians = await getClinicians();
  const rules = await getRules();
  const sourceText = getWorkflowSourceText(item);

  if (clinicians.length === 0) {
    return {
      clinician_key: null,
      clinician_name: null,
      confidence: 0,
      reason: "No active clinicians configured.",
      trello_board_id: null,
      trello_list_id: null,
      workflow_kind: workflow.workflow_kind,
    };
  }

  const deterministic = deterministicClinicianRoute({
    text: sourceText,
    workflowKind: workflow.workflow_kind,
    clinicians,
    rules,
  });

  let aiResult: any = null;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_CLINICIAN_ROUTING_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `
You choose the most likely clinician owner for dental practice correspondence.

Return ONLY JSON:
{
  "clinician_key": "one configured clinician_key or null",
  "confidence": 0.0,
  "reason": "brief reason"
}

Rules:
- Do not invent clinicians.
- Use only configured clinician_key values.
- If unclear, use deterministic/fallback suggestion.
- Existing patient correspondence should go to the known/treating clinician if indicated in text.
- Radiology/pathology results should go to the responsible clinician if indicated; otherwise fallback is acceptable.
`,
        },
        {
          role: "user",
          content: `
Workflow:
${JSON.stringify(workflow, null, 2)}

Configured clinicians:
${JSON.stringify(
  clinicians.map((clinician) => ({
    clinician_key: clinician.clinician_key,
    display_name: clinician.display_name,
    role: clinician.role,
    keywords: clinician.keywords,
    referring_practitioner_keywords: clinician.referring_practitioner_keywords,
  })),
  null,
  2
)}

Deterministic suggestion:
${JSON.stringify(
  deterministic
    ? {
        clinician_key: deterministic.clinician.clinician_key,
        display_name: deterministic.clinician.display_name,
        confidence: deterministic.confidence,
        reason: deterministic.reason,
      }
    : null,
  null,
  2
)}

Content:
${sourceText.slice(0, 10000)}
`,
        },
      ],
    });

    aiResult = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch (error) {
    console.warn("AI clinician routing failed, using deterministic result:", error);
  }

  const aiClinician = clinicians.find(
    (clinician) => clinician.clinician_key === aiResult?.clinician_key
  );

  const clinician = aiClinician || deterministic?.clinician || null;

  const confidence =
    aiClinician && typeof aiResult?.confidence === "number"
      ? Math.max(0, Math.min(aiResult.confidence, 0.99))
      : deterministic?.confidence || 0;

  const reason =
    (aiClinician && aiResult?.reason) ||
    deterministic?.reason ||
    "No clinician could be confidently matched.";

  const trelloListId = clinician
    ? listIdForWorkflow(clinician, workflow.workflow_kind)
    : null;

  const result: ClinicianRoutingResult = {
    clinician_key: clinician?.clinician_key || null,
    clinician_name: clinician?.display_name || null,
    confidence,
    reason,
    trello_board_id: clinician?.default_trello_board_id || null,
    trello_list_id: trelloListId || null,
    workflow_kind: workflow.workflow_kind,
  };

  if (persist) {
    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        assigned_clinician_key: result.clinician_key,
        assigned_clinician_name: result.clinician_name,
        clinician_routing_reason: result.reason,
        clinician_routing_confidence: result.confidence,
        trello_board_id: result.trello_board_id,
        trello_list_id: result.trello_list_id,
      })
      .eq("id", inboxItemId);
  }

  return result;
}
