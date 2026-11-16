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

// Missing evidence is a separate state, never proof of unfinished or completed work.
export function workflowStatusUnavailable(draft: DraftListItem): boolean {
  return Boolean(draft.workflowStatusStale || !draft.workflow_resolved || draft.workflow_resolved.lookupUnavailable);
}

// A known not-started letter is for the normal workflow, not an override.
export function canOfferManualWorkflowCompletion(draft: DraftListItem): boolean {
  return hasClinicalApproval(draft) && !workflowStatusUnavailable(draft) &&
    ['needs_attention', 'completing'].includes(draft.workflow_resolved!.status);
}

export function partitionApprovedForVerification<T extends DraftListItem>(drafts: readonly T[]) {
  const approved: T[] = [], verificationItems: T[] = [], uncertaintyItems: T[] = [];
  for (const draft of drafts) {
    // Keep existing non-operational/attention exclusions, but do not trust a stale
    // completed projection either. No old result is carried forward as authority.
    if (hasClinicalApproval(draft) && workflowStatusUnavailable(draft) &&
      shouldAppearInApproved({...draft, workflow_resolved: undefined})) {
      uncertaintyItems.push(draft); continue;
    }
    // An unavailable lookup's "completed" is not evidence: it must not drop the letter.
    const membership = workflowStatusUnavailable(draft) ? { ...draft, workflow_resolved: undefined } : draft;
    if (!shouldAppearInApproved(membership)) continue;
    (requiresWorkflowVerification(membership) ? verificationItems : approved).push(draft);
  }
  return { approved, verificationItems, uncertaintyItems };
}
