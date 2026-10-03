import { approvedWorkflow, type WorkflowDraft } from './resolved-workflow';
import type { DraftListItem } from './draft-contract';

// Display only. Workflow completion can include preparation without final send,
// so even authoritative branch completion must not be labelled delivery.
export function typistMedirefPresentation(draft: (WorkflowDraft & Pick<DraftListItem, 'workflow_manual_verification'>) | null | undefined) {
  const resolved = draft?.workflow_resolved;
  const completed = Boolean(resolved && !resolved.lookupUnavailable && resolved.branches.mediref === 'completed');
  const acknowledged = completed && draft?.workflow_manual_verification?.some(entry => entry.source === 'manually_sent' && entry.recoveryClass === 'no_prior_helper_job_v1');
  return {
    completed,
    label: acknowledged ? 'Manually acknowledged as sent' : completed ? 'MediRef step completed.' : 'MediRef delivery not confirmed.',
    showCardLabel: Boolean(acknowledged) || Boolean(draft?.emailed_to_referrer_at) && (completed ? resolved?.status === 'completed' : !(
      resolved?.medirefRecovery || /mediref|delivery/i.test(resolved?.message || '')
    )),
  };
}

// Card wording only: never resolves completion, eligibility or list membership.
export function typistApprovedPresentation(draft: WorkflowDraft & Pick<DraftListItem, 'workflow_continuation_context' | 'workflow_connection_block' | 'workflow_current_presentation'>) {
  const workflow = approvedWorkflow(draft);
  if (draft.workflow_resolved && !workflow.lookupUnavailable) {
    if (workflow.status === 'not_started') return {
      kind: 'ready', tone: 'neutral', label: 'Ready for workflow',
      message: 'No workflow is currently recorded for this letter.',
    };
    const currentLabels = {
      waiting_upload: 'Completing… Waiting for upload',
      uploading: 'Completing… Uploading to Praktika',
      waiting_icon: 'Completing… Waiting for icon update',
      waiting_icon_delayed: 'Completing… Waiting for icon update',
      waiting_mediref: 'Completing… Waiting for MediRef',
      waiting_connection: 'Completing… Waiting for Praktika connection',
    };
    const current = draft.workflow_current_presentation;
    if (['needs_attention','completing'].includes(workflow.status) && current && current !== 'unknown') return {
      kind: 'current', tone: 'amber', label: currentLabels[current],
      message: current === 'waiting_icon_delayed' ? 'Taking longer than expected.' : null,
    };
    if (['needs_attention','completing'].includes(workflow.status) &&
      draft.workflow_continuation_context==='present' && draft.workflow_connection_block==='praktika_credentials_required') return {
        kind: 'connection_blocked', tone: 'amber', label: 'Waiting for Praktika connection',
        message: 'This workflow will continue automatically when the required Praktika connection is restored.',
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
