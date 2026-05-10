import { supabaseAdmin } from "@/lib/supabase/admin";

export async function logBrainDebug({
  inboxItemId,
  caseId,
  eventType = "draft_generation",
  model,
  prompt,
  memoryContext,
  aiResponse,
  parsedResponse,
  metadata,
}: {
  inboxItemId?: string | null;
  caseId?: string | null;
  eventType?: string;
  model?: string | null;
  prompt?: string | null;
  memoryContext?: any;
  aiResponse?: any;
  parsedResponse?: any;
  metadata?: any;
}) {
  const promptPreview = prompt ? String(prompt).slice(0, 12000) : null;

  const { error } = await supabaseAdmin.from("ai_brain_debug_logs").insert({
    inbox_item_id: inboxItemId || null,
    case_id: caseId || null,
    event_type: eventType,
    model: model || null,
    prompt_preview: promptPreview,
    memory_context: memoryContext || null,
    ai_response: aiResponse || null,
    parsed_response: parsedResponse || null,
    metadata: metadata || null,
  });

  if (error) {
    console.warn("AI brain debug log failed:", error.message);
  }
}
