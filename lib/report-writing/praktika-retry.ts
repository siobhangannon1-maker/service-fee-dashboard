export const praktikaVerificationMessage = 'Praktika upload needs verification.';
export function remainsInApproved(draft: { status: string; emailed_to_referrer_at?: string | null;
  workflow_periodontal_chart_status?: string | null; workflow_status?: string | null; workflow_praktika_upload_status?: string | null; workflow_icon_update_status?: string | null; workflow_mediref_status?: string | null }) {
  if (!['approved', 'uploaded_to_praktika'].includes(draft.status)) return false;
  if (draft.workflow_status) return ['pending', 'running', 'failed', 'error', 'waiting_for_authentication', 'waiting_for_periodontal'].includes(draft.workflow_periodontal_chart_status || '')
    || draft.workflow_praktika_upload_status !== 'completed'
    || !['completed', 'skipped', 'not_requested'].includes(draft.workflow_icon_update_status || '')
    || !['completed', 'skipped', 'not_requested'].includes(draft.workflow_mediref_status || '');
  return draft.status === 'approved' && !draft.emailed_to_referrer_at;
}
