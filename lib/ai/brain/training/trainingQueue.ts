import { supabaseAdmin } from "@/lib/supabase/admin";

function textLength(value: string | null | undefined) {
  return String(value || "").trim().length;
}

export function calculateEditSeverity({
  originalBody,
  finalBody,
}: {
  originalBody?: string | null;
  finalBody?: string | null;
}) {
  const originalLength = textLength(originalBody);
  const finalLength = textLength(finalBody);

  if (originalLength === 0 && finalLength > 0) return "major";
  if (originalLength === 0 && finalLength === 0) return "none";

  const diff = Math.abs(finalLength - originalLength);
  const ratio = diff / Math.max(originalLength, 1);

  if (ratio > 0.5) return "major";
  if (ratio > 0.15) return "minor";
  return "none";
}

export function approvalScoreFromSeverity(severity: string) {
  if (severity === "none") return 100;
  if (severity === "minor") return 75;
  if (severity === "major") return 35;
  return 50;
}

export async function maybeCreateTrainingQueueItem({
  inboxItemId,
  feedbackId,
  caseId,
  category,
  originalBody,
  finalBody,
  notes,
}: {
  inboxItemId: string;
  feedbackId?: string | null;
  caseId?: string | null;
  category?: string | null;
  originalBody?: string | null;
  finalBody?: string | null;
  notes?: string | null;
}) {
  const severity = calculateEditSeverity({ originalBody, finalBody });

  if (severity === "none" && !notes) {
    return {
      created: false,
      severity,
      reason: "no_meaningful_edit",
    };
  }

  const priority = severity === "major" ? 20 : severity === "minor" ? 50 : 80;

  const { data, error } = await supabaseAdmin
    .from("ai_training_queue")
    .insert({
      inbox_item_id: inboxItemId,
      feedback_id: feedbackId || null,
      case_id: caseId || null,
      category: category || "unknown",
      issue_type:
        severity === "major"
          ? "major_receptionist_edit"
          : severity === "minor"
          ? "minor_receptionist_edit"
          : "feedback_note",
      title:
        severity === "major"
          ? "Major receptionist edit needs review"
          : severity === "minor"
          ? "Minor receptionist edit available for learning"
          : "Reception feedback note available",
      description:
        notes ||
        "Review this feedback and decide whether to create a rule, template, or approved example.",
      source: "feedback_learning",
      status: "open",
      priority,
    })
    .select()
    .single();

  if (error) {
    return {
      created: false,
      severity,
      error: error.message,
    };
  }

  return {
    created: true,
    severity,
    item: data,
  };
}
