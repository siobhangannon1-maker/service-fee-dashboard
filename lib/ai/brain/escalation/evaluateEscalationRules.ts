import { supabaseAdmin } from "@/lib/supabase/admin";

function normalise(value: string | null | undefined) {
  return String(value || "").toLowerCase();
}

function categoryMatches(
  ruleCategory: string | null | undefined,
  itemCategory: string | null | undefined,
) {
  const rule = normalise(ruleCategory || "all");
  const category = normalise(itemCategory || "unknown");

  return rule === "all" || rule === category || category.includes(rule) || rule.includes(category);
}

export async function evaluateEscalationRules({
  inboxItemId,
  category,
  sourceText,
}: {
  inboxItemId: string;
  category?: string | null;
  sourceText: string;
}) {
  const { data: rules, error } = await supabaseAdmin
    .from("ai_escalation_rules")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (error) {
    return {
      matched: false,
      error: error.message,
      matches: [],
    };
  }

  const text = normalise(sourceText);
  const matches: any[] = [];

  for (const rule of rules || []) {
    if (!categoryMatches(rule.category, category)) continue;

    const triggerTerms = Array.isArray(rule.trigger_terms)
      ? rule.trigger_terms
      : [];

    const matchedTerms = triggerTerms.filter((term: string) =>
      term && text.includes(normalise(term)),
    );

    if (matchedTerms.length > 0) {
      matches.push({
        rule_id: rule.id,
        title: rule.title,
        category: rule.category,
        matched_terms: matchedTerms,
        action_label: rule.action_label,
        escalation_level: rule.escalation_level,
        instructions: rule.instructions,
        priority: rule.priority ?? 100,
      });
    }
  }

  if (matches.length > 0) {
    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "escalation_rules_matched",
      event_label: "Escalation rules matched",
      details: {
        matches,
      },
    });
  }

  return {
    matched: matches.length > 0,
    matches,
  };
}
