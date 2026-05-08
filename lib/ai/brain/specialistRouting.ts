import { classifyOperationalWorkflow } from "@/lib/ai/brain/operationalWorkflow";
import { routeClinicianForInboxItem } from "@/lib/ai/brain/clinicianRouting";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type SpecialistRoutingResult = {
  routing_key: string;
  display_name: string;
  confidence: number;
  reason: string;
  should_create_trello_task: boolean;
  urgency: "low" | "medium" | "high";
  trello_board_id: string | null;
  trello_list_id: string;
  matched_rule_id: string | null;
  clinician_key?: string | null;
  clinician_name?: string | null;
};

function displayNameForWorkflow(workflowKind: string) {
  if (workflowKind === "urgent_clinical") return "Urgent Clinical";
  if (workflowKind === "radiology_review") return "Radiology Results";
  if (workflowKind === "pathology_review") return "Pathology Results";
  if (workflowKind === "existing_patient_correspondence") return "General";
  if (workflowKind === "new_referral") return "General";
  if (workflowKind === "marketing_or_spam") return "Marketing/System";
  return "General";
}

function routingKeyForWorkflow(workflowKind: string) {
  if (workflowKind === "radiology_review") return "radiology_review";
  if (workflowKind === "pathology_review") return "pathology_review";
  if (workflowKind === "urgent_clinical") return "urgent_clinical";
  return "general_clinical";
}

function shouldCreateTrelloForWorkflow(workflow: any) {
  if (workflow.workflow_kind === "radiology_review") return true;
  if (workflow.workflow_kind === "pathology_review") return true;
  if (workflow.workflow_kind === "urgent_clinical") return true;
  if (workflow.workflow_kind === "existing_patient_correspondence") return true;

  if (
    workflow.workflow_kind === "new_referral" &&
    workflow.modifiers?.should_auto_create_trello === true
  ) {
    return true;
  }

  return false;
}

function urgencyForWorkflow(workflow: any): "low" | "medium" | "high" {
  if (workflow.workflow_kind === "urgent_clinical") return "high";
  if (workflow.modifiers?.urgent === true) return "high";
  if (workflow.modifiers?.abnormal_findings === true) return "medium";
  if (workflow.workflow_kind === "radiology_review") return "medium";
  if (workflow.workflow_kind === "pathology_review") return "medium";
  return "low";
}

async function getFallbackListId(routingKey: string) {
  const { data } = await supabaseAdmin
    .from("ai_specialist_routing_rules")
    .select("id, trello_list_id")
    .eq("is_active", true)
    .eq("routing_key", routingKey)
    .maybeSingle();

  return {
    matchedRuleId: data?.id || null,
    trelloListId: data?.trello_list_id || null,
  };
}

export async function routeSpecialistForInboxItem({
  inboxItemId,
  persist = true,
}: {
  inboxItemId: string;
  persist?: boolean;
}): Promise<SpecialistRoutingResult> {
  const workflow = await classifyOperationalWorkflow({
    inboxItemId,
    persist,
  });

  const clinician = await routeClinicianForInboxItem({
    inboxItemId,
    persist,
  });

  const routingKey = routingKeyForWorkflow(workflow.workflow_kind);
  const fallback = await getFallbackListId(routingKey);

  const trelloListId = clinician.trello_list_id || fallback.trelloListId;

  if (!trelloListId || trelloListId.startsWith("REPLACE_WITH_")) {
    throw new Error(
      `No valid Trello list ID for workflow ${workflow.workflow_kind}. Configure ai_clinicians or ai_specialist_routing_rules.`
    );
  }

  const result: SpecialistRoutingResult = {
    routing_key: routingKey,
    display_name: displayNameForWorkflow(workflow.workflow_kind),
    confidence: workflow.confidence,
    reason: workflow.reason,
    should_create_trello_task: shouldCreateTrelloForWorkflow(workflow),
    urgency: urgencyForWorkflow(workflow),
    trello_board_id: clinician.trello_board_id,
    trello_list_id: trelloListId,
    matched_rule_id: fallback.matchedRuleId,
    clinician_key: clinician.clinician_key,
    clinician_name: clinician.clinician_name,
  };

  if (persist) {
    await supabaseAdmin
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

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      actor_id: null,
      event_type: "workflow_and_clinician_routing_completed",
      event_summary: `Routed to ${result.display_name}${
        result.clinician_name ? ` for ${result.clinician_name}` : ""
      }.`,
      metadata: {
        workflow,
        clinician,
        result,
      },
    });
  }

  return result;
}
