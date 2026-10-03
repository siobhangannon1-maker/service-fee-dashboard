import type { AuditActor } from "./audit"
import { clean, makeFingerprint } from "./edit-learning-analysis"

export type ApprovedEditInput = {
  providerId: string
  draftId: string
  reportType: string
  originalText: string
  finalText: string
  source: string
  actor: AuditActor
  approvedByProvider?: boolean
}

// Both execution paths save exactly this input. Processing never rewrites it.
export function prepareApprovedEdit(input: ApprovedEditInput) {
  const originalText = clean(input.originalText)
  const finalText = clean(input.finalText)
  if (!originalText || !finalText || originalText === finalText) return null
  return {
    provider_id: input.providerId,
    report_type: input.reportType,
    original_text: originalText,
    final_text: finalText,
    report_draft_id: input.draftId,
    source: input.source,
    editor_role: input.actor.actorRole,
    editor_id: input.actor.actorUserId,
    editor_name: input.actor.actorFullName,
    approved_by_provider: input.approvedByProvider ??
      (input.actor.actorRole === "provider" || input.actor.actorRole === "admin"),
    edit_fingerprint: makeFingerprint({
      draftId: input.draftId, originalText, finalText, source: input.source,
    }),
  }
}
