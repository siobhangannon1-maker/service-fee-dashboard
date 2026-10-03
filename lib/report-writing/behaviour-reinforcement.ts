import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuditActor } from "./audit"
import { clean, getEvidenceWeight, type AnalysedBehaviour } from "./edit-learning-analysis"

// Compare-and-swap retries use the unique behaviour key and persisted evidence.
// A concurrent winner forces a fresh read and recalculation of both increments.
export async function createOrReinforceBehaviour(params: {
  providerId: string
  reportType: string
  behaviour: AnalysedBehaviour
  source: string
  actor: AuditActor
}, supabase: SupabaseClient) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const { data: existing, error: existingError } = await supabase
      .from("provider_behaviours")
      .select("id, confidence, support_count, evidence_summary")
      .eq("provider_id", params.providerId)
      .eq("report_type", params.reportType)
      .eq("behaviour_key", params.behaviour.behaviour_key)
      .maybeSingle()

    if (existingError) throw new Error(existingError.message)

    const roleWeight = getEvidenceWeight(params.actor, params.source)
    const confidenceIncrease = Math.max(
      1,
      Math.round((roleWeight * params.behaviour.confidence_delta) / 5)
    )
    const now = new Date().toISOString()

    if (existing) {
      const nextConfidence = Math.min(
        100,
        Number(existing.confidence || 50) + confidenceIncrease
      )
      const nextSupportCount = Number(existing.support_count || 1) + 1

      const evidenceSummary = [
        clean(existing.evidence_summary),
        params.behaviour.evidence_summary,
      ]
        .filter(Boolean)
        .slice(-6)
        .join(" | ")

      let update = supabase
        .from("provider_behaviours")
        .update({
          category: params.behaviour.category,
          knowledge_type: params.behaviour.knowledge_type,
          behaviour_text: params.behaviour.behaviour_text,
          preferred_phrase: params.behaviour.preferred_phrase,
          template_block: params.behaviour.template_block,
          applies_when: params.behaviour.applies_when,
          evidence_summary: evidenceSummary,
          confidence: nextConfidence,
          support_count: nextSupportCount,
          status: "active",
          source: "approved_edit_learning",
          updated_at: now,
        })
        .eq("id", existing.id)
        .eq("support_count", existing.support_count)
        .eq("confidence", existing.confidence)
      update = existing.evidence_summary === null
        ? update.is("evidence_summary", null)
        : update.eq("evidence_summary", existing.evidence_summary)
      const { data: updated, error } = await update.select("id")

      if (error) throw new Error(error.message)
      if (!updated?.length) continue
      return "reinforced" as const
    }

    const initialConfidence = Math.min(90, 45 + confidenceIncrease)

    const { error } = await supabase.from("provider_behaviours").insert({
      provider_id: params.providerId,
      report_type: params.reportType,
      behaviour_key: params.behaviour.behaviour_key,
      category: params.behaviour.category,
      behaviour_text: params.behaviour.behaviour_text,
      evidence_summary: params.behaviour.evidence_summary,
      confidence: initialConfidence,
      support_count: 1,
      status: "active",
      source: "approved_edit_learning",
      knowledge_type: params.behaviour.knowledge_type,
      preferred_phrase: params.behaviour.preferred_phrase,
      template_block: params.behaviour.template_block,
      applies_when: params.behaviour.applies_when,
      created_at: now,
      updated_at: now,
    })

    if (error?.code === "23505") continue
    if (error) throw new Error(error.message)
    return "created" as const
  }
  throw new Error("Behaviour reinforcement contention limit reached")
}
