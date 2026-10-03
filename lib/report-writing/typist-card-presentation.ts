import type { DraftListItem } from './draft-contract';
import { typistApprovedPresentation } from './typist-mediref-presentation';

const statusLabels = new Map([
  ['draft', 'Draft'],
  ['edited_by_typist', 'Draft'],
  ['awaiting_provider_approval', 'Awaiting provider approval'],
  ['approved', 'Approved'],
  ['uploaded_to_praktika', 'Uploaded to Praktika'],
]);
const unavailableMessage = 'Workflow status may be temporarily out of date.';

// Display only. Pre-approval cards do not require Approved-workflow evidence.
// Never infer completion, tab membership or action eligibility from these labels.
export function typistCardPresentation(draft: DraftListItem) {
  const resolved = draft.workflow_resolved;
  const preApproval = ['draft', 'edited_by_typist', 'awaiting_provider_approval'].includes(draft.status);
  const recordedWorkflow = Boolean(
    draft.workflow_continuation_context === 'present' ||
    (draft.workflow_status && draft.workflow_status !== 'not_started') ||
    draft.workflow_praktika_upload_status || draft.workflow_mediref_status ||
    draft.workflow_icon_update_status || draft.workflow_periodontal_chart_status ||
    draft.workflow_started_at || draft.workflow_completed_at ||
    draft.uploaded_to_praktika || draft.uploaded_to_praktika_at || draft.emailed_to_referrer_at ||
    draft.workflow_error || draft.workflow_last_message || draft.periodontal_chart_attachment_error ||
    resolved?.praktikaRecovery || resolved?.medirefRecovery ||
    (resolved && Object.values(resolved.branches).includes('failed'))
  );
  const normalPreApproval = preApproval && !recordedWorkflow && (
    !resolved || resolved.lookupUnavailable || resolved.status === 'not_started'
  );
  const workflow = normalPreApproval
    ? { kind: 'pre_approval', tone: 'neutral', label: null, message: null }
    : typistApprovedPresentation(draft);
  return {
    ...workflow,
    // Unknown backend statuses are deliberately not mechanically humanised.
    statusLabel: statusLabels.get(draft.status) ?? null,
    reconciliationWarning: normalPreApproval && draft.workflow_reconciliation_warning === unavailableMessage
      ? null : draft.workflow_reconciliation_warning,
  };
}
