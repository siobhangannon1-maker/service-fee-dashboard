import type { DraftListItem } from './draft-contract';
import { shouldAppearInApproved } from './resolved-workflow';
import { typistApprovedPresentation } from './typist-mediref-presentation';

// Clinical approval is independent of integration status and verification labels.
export function hasClinicalApproval(draft: DraftListItem): boolean {
  return ['approved', 'uploaded_to_praktika'].includes(draft.status) &&
    typeof draft.provider_approved_at === 'string' && Number.isFinite(Date.parse(draft.provider_approved_at));
}

// Historical evidence review must not jump back into Approved during a failed
// enrichment read. Current continuations (including failures) stay operational.
export function requiresWorkflowVerification(draft: DraftListItem): boolean {
  if (!shouldAppearInApproved(draft)) return false;
  if (!hasClinicalApproval(draft)) return true;
  if (draft.workflow_continuation_context === 'present') return false;
  const historical = Number.isFinite(Date.parse(draft.created_at)) &&
    Date.parse(draft.created_at) < Date.parse('2026-09-16T00:00:00Z');
  const recorded = Boolean(draft.uploaded_to_praktika || draft.uploaded_to_praktika_at ||
    draft.emailed_to_referrer_at || ['failed', 'completed', 'running'].includes(draft.workflow_status || ''));
  if (historical && recorded &&
    (!draft.workflow_started_at || Date.parse(draft.workflow_started_at) < Date.parse('2026-09-16T00:00:00Z'))) return true;
  if (draft.workflow_continuation_context !== 'absent' || !draft.workflow_resolved ||
    draft.workflow_resolved.lookupUnavailable || draft.workflowStatusStale) return false;
  const { kind } = typistApprovedPresentation(draft);
  return kind === 'historical_mediref' || kind === 'historical_review';
}

export function partitionApprovedForVerification<T extends DraftListItem>(drafts: readonly T[]) {
  const approved: T[] = [], verificationItems: T[] = [];
  for (const draft of drafts) {
    if (!shouldAppearInApproved(draft)) continue;
    (requiresWorkflowVerification(draft) ? verificationItems : approved).push(draft);
  }
  return { approved, verificationItems };
}
