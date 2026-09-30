import type { DraftListItem } from './draft-contract';
import { shouldAppearInApproved } from './resolved-workflow';
import { typistApprovedPresentation } from './typist-mediref-presentation';

// "Requires Verification" is the generic destination for workflow outcomes that cannot safely be resolved automatically.
// Current membership is deliberately narrower and evidence-driven; future uncertainty types must be explicitly added rather than inferred.
// Workspace list membership only; never completion or authorization evidence.
export function requiresWorkflowVerification(draft: DraftListItem): boolean {
  if (!shouldAppearInApproved(draft) || draft.workflow_continuation_context !== 'absent' ||
    !draft.workflow_resolved || draft.workflow_resolved.lookupUnavailable || draft.workflowStatusStale) return false;
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
