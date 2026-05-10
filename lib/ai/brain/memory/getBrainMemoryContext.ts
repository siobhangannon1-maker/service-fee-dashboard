import { supabaseAdmin } from "@/lib/supabase/admin";

type BrainMemoryInput = {
  category?: string | null;
  operationalIntent?: string | null;
  limit?: number;
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function escapePostgrestValue(value: string) {
  return String(value).replace(/"/g, '\\"');
}

function buildCategoryOrFilter(categories: string[]) {
  const cleaned = uniqueStrings(categories);

  if (cleaned.length === 0) {
    return "category.eq.all,category.is.null";
  }

  const categoryFilter = cleaned
    .map((category) => `category.eq."${escapePostgrestValue(category)}"`)
    .join(",");

  return `${categoryFilter},category.is.null`;
}

function normalise(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTemplateCategories(
  category: string | null | undefined,
  operationalIntent?: string | null,
) {
  const rawCategory = String(category || "unknown").trim() || "unknown";
  const value = normalise(rawCategory);
  const intent = normalise(operationalIntent);

  if (
    value.includes("new referral") ||
    value.includes("referral") ||
    intent.includes("new referral") ||
    intent.includes("referral")
  ) {
    return ["referral_received", "new_referral", "all"];
  }

  if (
    value.includes("existing patient correspondence") ||
    intent.includes("general correspondence") ||
    intent.includes("records request")
  ) {
    return [
      "existing_patient_correspondence_received",
      "existing_patient_correspondence",
      "all",
    ];
  }

  if (value.includes("appointment") || intent.includes("appointment")) {
    return ["appointment_availability", "appointment_request", "all"];
  }

  if (value.includes("billing") || intent.includes("billing")) {
    return ["invoice_request", "billing", "all"];
  }

  if (value.includes("post op") || intent.includes("post op")) {
    return ["post_op_concern", "post_op", "all"];
  }

  if (value.includes("clinical question") || intent.includes("clinical review")) {
    return ["procedure_question", "clinical_question", "all"];
  }

  return [rawCategory, "all"];
}

export function formatRulesForPrompt(rules: any[]) {
  if (!rules?.length) return "No active learning rules found for this category.";

  return rules
    .map((r, index) =>
      `
Rule ${index + 1}
Title: ${r.title || "Rule"}
Type: ${r.rule_type || "general"}
Priority: ${r.priority ?? 100}
Instruction:
${r.rule || ""}
`.trim(),
    )
    .join("\n\n---\n\n");
}

export function formatTemplatesForPrompt(templates: any[]) {
  if (!templates?.length) {
    return "No active response templates found for this category.";
  }

  return templates
    .map((template, index) =>
      `
Template ${index + 1}: ${template.title || "Untitled template"}
Category: ${template.category || "unknown"}

Subject template:
${template.subject_template || ""}

Body template:
${template.body_template || ""}

Tone notes:
${template.tone_notes || ""}

Avoid notes:
${template.avoid_notes || ""}
`.trim(),
    )
    .join("\n\n---\n\n");
}

export function formatExamplesForPrompt(examples: any[]) {
  if (!examples?.length) return "No active approved examples found for this category.";

  return examples
    .map((e, index) =>
      `
Example ${index + 1}: ${e.title || "Untitled example"}
Category: ${e.category || "all"}

Incoming example:
${e.incoming_message || ""}

Approved reply subject:
${e.approved_reply_subject || ""}

Approved reply body:
${e.approved_reply_body || ""}

Tone notes:
${e.tone_notes || ""}

Avoid notes:
${e.avoid_notes || ""}
`.trim(),
    )
    .join("\n\n---\n\n");
}

export async function getBrainMemoryContext({
  category,
  operationalIntent,
  limit = 8,
}: BrainMemoryInput) {
  const templateCategories = getTemplateCategories(category, operationalIntent);
  const categoryFilter = buildCategoryOrFilter(templateCategories);

  const [rulesResult, templatesResult, examplesResult, feedbackResult] =
    await Promise.all([
      supabaseAdmin
        .from("ai_learning_rules")
        .select("*")
        .eq("is_active", true)
        .or(categoryFilter)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(30),

      supabaseAdmin
        .from("ai_response_templates")
        .select("*")
        .eq("is_active", true)
        .in("category", templateCategories)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit),

      supabaseAdmin
        .from("ai_approved_examples")
        .select("*")
        .eq("is_active", true)
        .or(categoryFilter)
        .order("created_at", { ascending: false })
        .limit(limit),

      supabaseAdmin
        .from("ai_feedback")
        .select("id, feedback_type, edit_severity, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const rules = rulesResult.data || [];
  const templates = templatesResult.data || [];
  const examples = examplesResult.data || [];
  const feedback = feedbackResult.data || [];

  const primaryTemplate = templates[0] || null;

  return {
    category: category || "unknown",
    operationalIntent: operationalIntent || null,
    templateCategories,
    rules,
    templates,
    examples,
    feedback,
    primaryTemplate,
    promptText: {
      rules: formatRulesForPrompt(rules),
      templates: formatTemplatesForPrompt(templates),
      examples: formatExamplesForPrompt(examples),
      primaryTemplate: primaryTemplate
        ? `
Primary template title:
${primaryTemplate.title || "Untitled template"}

Primary subject template:
${primaryTemplate.subject_template || ""}

Primary body template:
${primaryTemplate.body_template || ""}

Primary tone notes:
${primaryTemplate.tone_notes || ""}

Primary avoid notes:
${primaryTemplate.avoid_notes || ""}
`.trim()
        : "No primary response template selected.",
    },
    counts: {
      rules: rules.length,
      templates: templates.length,
      examples: examples.length,
      feedback: feedback.length,
    },
  };
}
