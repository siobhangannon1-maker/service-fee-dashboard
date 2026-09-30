import { approvedWorkflow, type WorkflowDraft } from './resolved-workflow';
import type { DraftListItem } from './draft-contract';

// Display only. Workflow completion can include preparation without final send,
// so even authoritative branch completion must not be labelled delivery.
export function typistMedirefPresentation(draft: WorkflowDraft | null | undefined) {
  const resolved = draft?.workflow_resolved;
  const completed = Boolean(resolved && !resolved.lookupUnavailable && resolved.branches.mediref === 'completed');
  return {
    completed,
    label: completed ? 'MediRef step completed.' : 'MediRef delivery not confirmed.',
    showCardLabel: Boolean(draft?.emailed_to_referrer_at) && (completed ? resolved?.status === 'completed' : !(
      resolved?.medirefRecovery || /mediref|delivery/i.test(resolved?.message || '')
    )),
  };
}

// Card wording only: never resolves completion, eligibility or list membership.
export function typistApprovedPresentation(draft: WorkflowDraft & Pick<DraftListItem, 'workflow_continuation_context'>) {
  const workflow = approvedWorkflow(draft);
  if (draft.workflow_resolved && !workflow.lookupUnavailable) {
    if (workflow.status === 'not_started') return {
      kind: 'ready', tone: 'neutral', label: 'Ready for workflow',
      message: 'No workflow is currently recorded for this letter.',
    };
    if (workflow.status === 'needs_attention' && draft.workflow_continuation_context === 'absent') {
      if (['failed', 'unknown'].includes(workflow.branches.mediref)) return {
        kind: 'historical_mediref', tone: 'amber', label: 'MediRef delivery not confirmed',
        message: 'Historical records do not confirm final MediRef delivery.',
      };
      if (workflow.branches.mediref === 'completed' &&
        Object.values(workflow.branches).some(branch => !['completed', 'skipped'].includes(branch))) return {
        kind: 'historical_review', tone: 'amber', label: 'Historical workflow requires review',
        message: 'One or more historical workflow steps cannot be verified.',
      };
    }
  }
  return { kind: 'current', tone: workflow.status === 'needs_attention' ? 'danger' : 'amber',
    label: workflow.status === 'needs_attention' ? 'Needs attention' : workflow.status === 'completing' ? 'Completing...' : null,
    message: workflow.message,
  };
}
