import { supabaseAdmin } from "@/lib/supabase/admin";

type ApplyFeedbackLearningParams = {
  inboxItemId: string;

  originalSubject?: string | null;
  originalBody?: string | null;

  finalSubject?: string | null;
  finalBody?: string | null;

  category?: string | null;

  notes?: string | null;
};

function normalise(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasMeaningfulText(value: string | null | undefined, minLength = 20) {
  return normalise(value).length >= minLength;
}

function calculateChanged({
  originalSubject,
  originalBody,
  finalSubject,
  finalBody,
}: {
  originalSubject?: string | null;
  originalBody?: string | null;
  finalSubject?: string | null;
  finalBody?: string | null;
}) {
  const subjectChanged = normalise(originalSubject) !== normalise(finalSubject);
  const bodyChanged = normalise(originalBody) !== normalise(finalBody);

  return {
    subjectChanged,
    bodyChanged,
    changed: subjectChanged || bodyChanged,
  };
}

function buildIncomingMessage(item: any) {
  return [
    item.email_subject || item.subject || "",
    item.email_body || "",
    item.body || "",
    item.raw_text || "",
    item.extracted_text || "",
    item.summary ? `Summary:\n${item.summary}` : "",
    item.suggested_action ? `Suggested action:\n${item.suggested_action}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function shouldCreateTemplate(finalBody?: string | null) {
  const text = normalise(finalBody);

  if (text.length < 120) return false;

  const verySpecificSignals = [
    "your appointment on",
    "your surgery on",
    "your procedure on",
    "your biopsy result",
    "your pathology result",
  ];

  const lower = text.toLowerCase();
  return !verySpecificSignals.some((signal) => lower.includes(signal));
}

export async function applyFeedbackLearning({
  inboxItemId,
  originalSubject,
  originalBody,
  finalSubject,
  finalBody,
  category,
  notes,
}: ApplyFeedbackLearningParams) {
  const comparison = calculateChanged({
    originalSubject,
    originalBody,
    finalSubject,
    finalBody,
  });

  const { data: inboxItem } = await supabaseAdmin
    .from("ai_inbox_items")
    .select("*")
    .eq("id", inboxItemId)
    .maybeSingle();

  const { data: aiCase } = await supabaseAdmin
    .from("ai_cases")
    .select("id, title, category, risk_level, confidence")
    .eq("inbox_item_id", inboxItemId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const finalCategory =
    category || inboxItem?.category || aiCase?.category || "unknown";

  const result = {
    feedback_saved: false,
    approved_example_created: false,
    template_created: false,
    learning_rule_created: false,
    changed: comparison.changed,
    subject_changed: comparison.subjectChanged,
    body_changed: comparison.bodyChanged,
  };

  const { error: feedbackError } = await supabaseAdmin
    .from("ai_feedback")
    .insert({
      inbox_item_id: inboxItemId,
      case_id: aiCase?.id || null,

      original_subject: originalSubject || null,
      original_body: originalBody || null,

      final_subject: finalSubject || null,
      final_body: finalBody || null,

      feedback_type: comparison.changed
        ? "receptionist_edited"
        : "approved_without_changes",

      notes: notes || null,
    });

  if (feedbackError) {
    console.warn("AI feedback save failed:", feedbackError.message);
  } else {
    result.feedback_saved = true;
  }

  if (hasMeaningfulText(finalBody, 40) && inboxItem) {
    const incomingMessage = buildIncomingMessage(inboxItem);

    const { error: exampleError } = await supabaseAdmin
      .from("ai_approved_examples")
      .insert({
        title:
          inboxItem.email_subject ||
          inboxItem.subject ||
          aiCase?.title ||
          `Approved example ${new Date().toISOString()}`,

        category: finalCategory,

        incoming_message: incomingMessage || "No source message saved.",

        approved_reply_subject: finalSubject || null,
        approved_reply_body: finalBody || "",

        tone_notes: comparison.changed
          ? "Learned from receptionist-edited approved response."
          : "Approved without changes from Workbench review.",

        avoid_notes: null,

        source: comparison.changed
          ? "workbench_feedback_edited"
          : "workbench_feedback_approved",

        is_active: true,
      });

    if (exampleError) {
      console.warn("Approved example creation failed:", exampleError.message);
    } else {
      result.approved_example_created = true;
    }
  }

  if (shouldCreateTemplate(finalBody)) {
    const { error: templateError } = await supabaseAdmin
      .from("ai_response_templates")
      .insert({
        category: finalCategory,
        title: `Learned ${finalCategory} template`,
        subject_template: finalSubject || null,
        body_template: finalBody || "",
        tone_notes:
          "Auto-learned from a receptionist-reviewed Workbench response.",
        avoid_notes:
          "Review before relying on this as a reusable template.",
        source: "workbench_feedback",
        is_active: true,
        updated_at: new Date().toISOString(),
      });

    if (templateError) {
      console.warn("Response template creation failed:", templateError.message);
    } else {
      result.template_created = true;
    }
  }

  if (hasMeaningfulText(notes, 30)) {
    const { error: ruleError } = await supabaseAdmin
      .from("ai_learning_rules")
      .insert({
        title: `Reception feedback rule ${new Date().toLocaleDateString("en-AU")}`,
        category: finalCategory,
        rule_type: "general",
        priority: 70,
        rule: notes,
        source: "workbench_feedback",
        is_active: true,
      });

    if (ruleError) {
      console.warn("Learning rule creation failed:", ruleError.message);
    } else {
      result.learning_rule_created = true;
    }
  }

  return result;
}
