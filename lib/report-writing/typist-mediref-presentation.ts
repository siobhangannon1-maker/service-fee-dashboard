import type { WorkflowDraft } from './resolved-workflow';

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
