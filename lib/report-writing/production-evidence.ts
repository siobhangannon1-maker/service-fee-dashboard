import { allowedPraktikaRead } from '../praktika/read-operations';
import { isConfirmedPraktikaUpload } from './praktika-upload-result';
import { isConfirmedPraktikaIcon } from './praktika-icon-result';
import type { ReadJob } from './resolved-workflow';
export type ProductionJobClass = 'read_only' | 'external_mutation' | 'workflow_execution' | 'unknown';
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function productionJobClass(j: ReadJob): ProductionJobClass {
  if (allowedPraktikaRead(j.job_type,j.request)) return 'read_only';
  if (['upload_report_to_praktika','update_praktika_letter_icons','send_mediref_letter'].includes(j.job_type)) return 'external_mutation';
  return j.job_type === 'complete_report_workflow' ? 'workflow_execution' : 'unknown';
}
export function executionConflict(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(executionConflict);
  const r = obj(value);
  return ('requestInvoked' in r && r.requestInvoked !== false) || ('externalExecution' in r && r.externalExecution !== 'not_started') ||
    ('deadlineExceeded' in r && r.deadlineExceeded !== false) || ('dispatched' in r && r.dispatched !== false) ||
    ('insertionOutcome' in r && r.insertionOutcome !== 'not_attempted') ||
    ['uploadFailure', 'medirefPreparationFailure', 'manualWorkflowCompletion'].some(k => k in r && (!r[k] || typeof r[k] !== 'object' || Array.isArray(r[k]))) ||
    Object.values(r).some(v => v !== null && typeof v === 'object' && executionConflict(v));
}
// Missing/null read results are legacy absence, not proof of attachment. Read rows
// may be objects or arrays of objects. Scalar roots/elements are malformed.
// Mutation receipts must still satisfy their object-only branch contracts.
export function supportedResponseContainer(value: unknown): boolean {
  return value == null || Array.isArray(value) && value.every(v => v !== null && typeof v === 'object' && !Array.isArray(v)) ||
    value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function productionJobSettled(j: ReadJob): boolean {
  const kind = productionJobClass(j), r = obj(j.response ?? j.result);
  // Inspect both retained containers before selecting the receipt. Never erase
  // contradictory evidence by converting an array or falling back from null.
  if ([j.response, j.result].some(v => !supportedResponseContainer(v) || executionConflict(v))) return false;
  if (kind === 'read_only') return ['completed','failed'].includes(j.status);
  if (j.status === 'completed') {
    if (j.job_type === 'upload_report_to_praktika') return !('error' in r || 'errors' in r) && isConfirmedPraktikaUpload(r);
    if (j.job_type === 'update_praktika_letter_icons') return isConfirmedPraktikaIcon(r,j.request);
    if (j.locked_at || j.locked_by) return false;
    if (j.job_type === 'send_mediref_letter') return !('error' in r || 'errors' in r) && r.success !== false && (r.sent === true || r.prepared === true && r.sent === false);
    const manual = obj(r.manualWorkflowCompletion);
    return j.job_type === 'complete_report_workflow' && (r.stage === 'mediref' || manual.contract === 'workflow-resolution-v1' && ['operator_manual_completion','controlled_resume'].includes(String(manual.source)));
  }
  if (j.status !== 'failed' || j.locked_at || j.locked_by) return false;
  if (j.job_type === 'upload_report_to_praktika') { const f = obj(r.uploadFailure); return f.requestInvoked === false && ['preparation','pre_dispatch'].includes(String(f.stage)); }
  if (j.job_type !== 'complete_report_workflow') return false;
  const f = obj(r.medirefPreparationFailure);
  return f.contract === 'mediref-no-job-failure-v1' && f.insertionOutcome === 'not_attempted' && f.externalExecution === 'not_started' && f.deadlineExceeded === false &&
    ['patient_validation','pdf_generation','pdf_validation','storage_upload','storage_verification','attachment_validation'].includes(String(f.stage)) && f.code === `MEDIREF_${String(f.stage).toUpperCase()}_FAILED`;
}
// Every queue audit must retain the same-draft helper it claims was inserted.
export function productionExecutionSafe(draftId: string, jobs: ReadJob[], events: { action: string; details: Record<string, unknown> }[]): boolean {
  const parent=jobs.find(j => j.job_type === 'complete_report_workflow' && j.request?.reportDraftId === draftId);
  return jobs.every(j => (!j.request?.continuationId || j.request.continuationId === parent?.id) && (!j.payload?.workflowContinuationId || j.payload.workflowContinuationId === parent?.id) && (!j.request?.reportDraftId || j.request.reportDraftId === draftId) && (!j.payload?.draftId || j.payload.draftId === draftId) && productionJobSettled(j)) && events.filter(a => a.action === 'Queued MediRef send').every(a => jobs.some(j => j.id === a.details.jobId && j.payload?.draftId === draftId && j.job_type === 'send_mediref_letter' && j.status === 'completed' && productionJobSettled(j)));
}
