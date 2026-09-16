import type { ResolvedWorkflow } from './resolved-workflow';
import type { ManualVerification } from './manual-verification';

// One response contract for Typist, Provider and History. No letter bodies.
export type DraftListItem = {
  id: string;
  provider_id: string;
  patient_name: string | null;
  patient_dob: string | null;
  referrer_name: string | null;
  report_type: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  uploaded_to_praktika?: boolean | null;
  has_final_text: boolean | null; // null means availability lookup was unavailable.
  workflow_resolved?: ResolvedWorkflow;
  workflow_manual_verification?: ManualVerification[];
  workflowStatusStale?: boolean;
  workflow_reconciliation_warning?: string | null;
  praktikaFailedUploadId?: string;
  provider_name?: string | null;
  provider_approved_at?: string | null;
  attached_to_praktika_at?: string | null;
  uploaded_to_praktika_at?: string | null;
  emailed_to_referrer_at?: string | null;
  emailed_to_referrer_email?: string | null;
  emailed_to_referrer_resend_id?: string | null;
  completed_at?: string | null;
  sensitive_source_deleted_at?: string | null;
  ai_text_deleted_at?: string | null;
  final_text_deleted_at?: string | null;
  retention_status?: string | null;
  drafted_by_initials?: string | null;
  drafted_by_name?: string | null;
  approved_by_initials?: string | null;
  approved_by_name?: string | null;
  emailed_by_initials?: string | null;
  emailed_by_name?: string | null;
  uploaded_by_initials?: string | null;
  uploaded_by_name?: string | null;
  workflow_status?: string | null;
  workflow_started_at?: string | null;
  workflow_completed_at?: string | null;
  workflow_error?: string | null;
  workflow_praktika_upload_status?: string | null;
  workflow_icon_update_status?: string | null;
  workflow_mediref_status?: string | null;
  workflow_periodontal_chart_status?: string | null;
  workflow_last_message?: string | null;
  periodontal_chart_attached_at?: string | null;
  periodontal_chart_attachment_name?: string | null;
  periodontal_chart_attachment_error?: string | null;
  praktika_letter_icon_updated_at?: string | null;
  praktika_letter_icon_appointment_id?: string | null;
  praktika_letter_icon_update_mode?: string | null;
  sent_for_provider_review_at?: string | null;
  praktika_patient_id?: string | null;
};

export type DraftDetail = DraftListItem & {
  source_type: string;
  source_text: string | null;
  edited_text: string | null;
  ai_generated_text: string | null;
  referrer_address: string | null;
  typist_instructions: string | null;
  typist_queries: string | null;
  clinical_notes: string | null;
  source_clinical_notes: string | null;
};

export const draftListColumns = [
  'id',
  'provider_id',
  'patient_name',
  'patient_dob',
  'referrer_name',
  'report_type',
  'status',
  'created_at',
  'updated_at',
  'uploaded_to_praktika',
  'provider_approved_at',
  'attached_to_praktika_at',
  'uploaded_to_praktika_at',
  'emailed_to_referrer_at',
  'emailed_to_referrer_email',
  'emailed_to_referrer_resend_id',
  'completed_at',
  'sensitive_source_deleted_at',
  'ai_text_deleted_at',
  'final_text_deleted_at',
  'retention_status',
  'drafted_by_initials',
  'drafted_by_name',
  'approved_by_initials',
  'approved_by_name',
  'emailed_by_initials',
  'emailed_by_name',
  'uploaded_by_initials',
  'uploaded_by_name',
  'workflow_status',
  'workflow_started_at',
  'workflow_completed_at',
  'workflow_error',
  'workflow_praktika_upload_status',
  'workflow_icon_update_status',
  'workflow_mediref_status',
  'workflow_periodontal_chart_status',
  'workflow_last_message',
  'periodontal_chart_attached_at',
  'periodontal_chart_attachment_name',
  'periodontal_chart_attachment_error',
  'praktika_letter_icon_updated_at',
  'praktika_letter_icon_appointment_id',
  'praktika_letter_icon_update_mode',
  'sent_for_provider_review_at',
  'praktika_patient_id',
] as const;
// This preview is evidence for historical icon association. Keep it server-side.
export const draftListSelect = [...draftListColumns, 'praktika_letter_icon_update_response_preview'].join(',');
const projectionFields = ['workflow_resolved', 'workflow_manual_verification', 'workflowStatusStale',
  'workflow_reconciliation_warning', 'praktikaFailedUploadId'] as const;
export function toDraftListItem(row: Record<string, unknown>, availability: boolean | null): DraftListItem {
  const output: Record<string, unknown> = { has_final_text: availability };
  for (const key of [...draftListColumns, ...projectionFields]) if (key in row) output[key] = row[key];
  output.status = row.status || 'draft';
  return output as DraftListItem;
}
export function toDraftDetail(row: Record<string, unknown>): DraftDetail {
  return { ...row, status: row.status || 'draft',
    clinical_notes: row.clinical_notes || row.source_clinical_notes || row.source_text || null,
    source_clinical_notes: row.source_clinical_notes || row.clinical_notes || row.source_text || null,
    typist_instructions: row.typist_instructions || null,
    has_final_text: Boolean(String(row.edited_text || row.ai_generated_text || '').trim()),
  } as DraftDetail;
}
const workflowFields = [
  'status', 'provider_approved_at', 'uploaded_to_praktika', 'uploaded_to_praktika_at',
  'emailed_to_referrer_at', 'emailed_to_referrer_email', 'emailed_to_referrer_resend_id',
  'completed_at', 'workflow_status', 'workflow_started_at', 'workflow_completed_at', 'workflow_error',
  'workflow_praktika_upload_status', 'workflow_icon_update_status', 'workflow_mediref_status',
  'workflow_periodontal_chart_status', 'workflow_last_message', ...projectionFields,
] as const;
export function mergeDraftWorkflow(detail: DraftDetail, item: DraftListItem): DraftDetail {
  if (detail.id !== item.id || detail.provider_id !== item.provider_id) return detail;
  const next = { ...detail };
  // Deliberately exclude updated_at: a list refresh is not an editor revision load.
  for (const key of workflowFields) {
    if (Object.prototype.hasOwnProperty.call(item, key)) Object.assign(next, { [key]: item[key] });
    else if ((projectionFields as readonly string[]).includes(key)) delete next[key];
  }
  return next;
}
