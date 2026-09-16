import { durableHistoricalWorkflow, type HistoricalReconciliationEvent } from './historical-reconciliation';
import { manualVerification } from './manual-verification';
import { isConfirmedPraktikaUpload } from './praktika-upload-result';
import { historicalWorkflowAssociation, type HistoricalEvidence } from './historical-workflow-evidence';

export const WORKFLOW_STALE_MS = 30 * 60_000;
export const staleWorkflowMessage = 'Workflow has not progressed. Review the unfinished workflow steps.';
export type BranchState = 'completed' | 'skipped' | 'failed' | 'active' | 'unknown';
export type ResolvedWorkflow = {
  status: 'not_started' | 'completing' | 'needs_attention' | 'completed';
  message: string | null;
  branches: { praktika: BranchState; mediref: BranchState; icon: BranchState; periodontal: BranchState };
  lastProgressAt: number | null;
  lookupUnavailable: boolean;
  praktikaRecovery: boolean;
  medirefRecovery: boolean;
  // Retention only: never inferred from approval, job creation or polling.
  completedAt?: number | null;
  historicalRetention?: { reconciliationId: string; released: boolean };
};
export type WorkflowDraft = {
  id?: string; created_at?: string | null; status?: string; workflow_status?: string | null;
  workflow_praktika_upload_status?: string | null; workflow_mediref_status?: string | null;
  workflow_icon_update_status?: string | null; workflow_periodontal_chart_status?: string | null;
  periodontal_chart_attached_at?: string | null; periodontal_chart_attachment_name?: string | null;
  periodontal_chart_attachment_error?: string | null; uploaded_to_praktika?: boolean | null;
  emailed_to_referrer_at?: string | null; workflow_resolved?: ResolvedWorkflow;
  praktika_patient_id?: string | null; praktika_letter_icon_appointment_id?: string | null;
  praktika_letter_icon_updated_at?: string | null; praktika_letter_icon_update_response_preview?: string | null;
  provider_approved_at?: string | null;
};
export type ReadJob = {
  id: string; status: string; job_type: string; app_user_id?: string | null;
  request?: Record<string, unknown> | null; payload?: Record<string, unknown> | null;
  response?: unknown; result?: unknown; created_at?: string | null; locked_at?: string | null; locked_by?: string | null;
  completed_at?: string | null; failed_at?: string | null; updated_at?: string | null;
};
export type WorkflowEvidence = {
  parent?: ReadJob; hasOtherParent?: boolean; uploads: ReadJob[]; icons: ReadJob[]; mediref: ReadJob[];
  currentUploadId?: string; currentIconId?: string;
  historical?: HistoricalEvidence;
  reconciliations?: HistoricalReconciliationEvent[];
  // Liveness is corroboration only; never a workflow-progress timestamp or write gate.
  livePraktikaActors: ReadonlySet<string>; liveMediref: boolean;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const skipped = (v: unknown) => v === 'skipped' || v === 'not_requested';
const terminal = (s: BranchState) => s === 'completed' || s === 'skipped';
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0;
function progress(job: ReadJob): number {
  // updated_at on a terminal child is the completion/failure write in older workers.
  // Never use a parent's updated_at: continuation polling rewrites it repeatedly.
  return Math.max(time(job.created_at), time(job.locked_at),
    ...(['completed', 'failed'].includes(job.status) ? [time(job.completed_at), time(job.failed_at), time(job.updated_at)] : []));
}
function childState(job: ReadJob | undefined, success: (j: ReadJob) => boolean): BranchState {
  if (!job) return 'unknown';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'completed') return success(job) ? 'completed' : 'failed';
  return ['waiting', 'pending', 'processing', 'running'].includes(job.status) ? 'active' : 'unknown';
}
export function unavailableWorkflow(): ResolvedWorkflow {
  return { status: 'needs_attention', message: 'Workflow status may be temporarily out of date.',
    branches: { praktika: 'unknown', mediref: 'unknown', icon: 'unknown', periodontal: 'unknown' },
    lastProgressAt: null, lookupUnavailable: true, praktikaRecovery: false, medirefRecovery: false };
}
export function resolveWorkflow(d: WorkflowDraft, e: WorkflowEvidence, now = Date.now()): ResolvedWorkflow {
  const durable=durableHistoricalWorkflow(d,e,now);
  if (durable) return durable;
  const parent = e.parent;
  const parentValid = Boolean(parent && parent.request?.reportDraftId === d.id && parent.app_user_id &&
    parent.request?.actorUserId === parent.app_user_id);
  if (parent && !parentValid) return unavailableWorkflow();
  const response = record(parent?.response);
  const linked = (j: ReadJob) => j.request?.reportDraftId === d.id && j.request?.continuationId === parent?.id;
  // Pre-continuation workflows used random child IDs and no continuation linkage.
  // Only a terminal draft with one unambiguous legacy attempt per required branch
  // can use those IDs. Never fall back here for a modern/malformed/retry workflow.
  const historical = historicalWorkflowAssociation(d,e);
  const legacy = Boolean(historical) || !parent && !e.hasOtherParent && d.workflow_status === 'completed'
    && d.workflow_praktika_upload_status === 'completed'
    && (d.workflow_icon_update_status === 'completed' || skipped(d.workflow_icon_update_status))
    && (d.workflow_mediref_status === 'completed' || skipped(d.workflow_mediref_status))
    && e.uploads.length === 1 && e.icons.length <= 1 && e.mediref.length <= 1
    && [...e.uploads, ...e.icons].every(j => j.request?.reportDraftId === d.id &&
      !j.request?.continuationId && !j.request?.manualRetry)
    && e.mediref.every(j => j.payload?.draftId === d.id && !j.payload?.workflowContinuationId && !j.payload?.retryMediref);
  const upload = parent ? e.uploads.find(j => j.id === e.currentUploadId && linked(j)) : historical?.upload || (legacy ? e.uploads[0] : undefined);
  const icon = parent ? e.icons.find(j => j.id === e.currentIconId && linked(j)) : historical?.icon || (legacy ? e.icons[0] : undefined);
  const medJobs = e.mediref.filter(j => j.payload?.draftId === d.id &&
    (!j.payload?.workflowContinuationId || j.payload?.workflowContinuationId === parent?.id));
  const med = [...medJobs].sort((a,b) => time(b.created_at) - time(a.created_at) || b.id.localeCompare(a.id))[0];
  const verifiedUpload = parent && manualVerification(parent.response, 'praktika', d.id!, parent.id);
  const verifiedMed = parent && manualVerification(parent.response, 'mediref', d.id!, parent.id);
  const medSuccess = (j: ReadJob) => {
    const result = record(j.result);
    return !result.error && !result.errors && result.success !== false && (result.prepared === true || result.sent === true);
  };
  const branches: ResolvedWorkflow['branches'] = {
    praktika: verifiedUpload ? 'completed' : childState(upload, j => isConfirmedPraktikaUpload(j.response)),
    mediref: verifiedMed ? 'completed' : med ? childState(med, medSuccess) : skipped(d.workflow_mediref_status) ? 'skipped' : 'unknown',
    icon: icon ? childState(icon, j => { const r = record(j.response); return Object.keys(r).length > 0 && !r.error && r.success !== false && r.empty !== true; })
      : skipped(d.workflow_icon_update_status) ? 'skipped' : d.workflow_icon_update_status === 'failed' ? 'failed' : 'unknown',
    periodontal: skipped(d.workflow_periodontal_chart_status) ? 'skipped' : 'unknown',
  };
  const options = record(parent?.request?.options);
  // Attachment metadata can survive an explicitly skipped chart step. It does not
  // itself make that step required again. Actual errors/explicit requirements win.
  const chartRequired = options.attachPeriodontalChart === true || Boolean(d.periodontal_chart_attachment_error) ||
    (!skipped(d.workflow_periodontal_chart_status) && Boolean(d.periodontal_chart_attachment_name || d.periodontal_chart_attached_at ||
      ['pending','running','completed','failed','error'].includes(d.workflow_periodontal_chart_status || '')));
  if (!chartRequired && !d.workflow_periodontal_chart_status && parentValid && options.attachPeriodontalChart === false)
    branches.periodontal = 'skipped';
  const attachments = med?.payload?.attachments;
  const chartProof = ['pending','completed'].includes(d.workflow_periodontal_chart_status || '') && (parent?.status === 'completed' || legacy) && branches.mediref === 'completed' && med?.status === 'completed' && medSuccess(med)
    && Boolean(time(d.periodontal_chart_attached_at) && d.periodontal_chart_attachment_name) && !d.periodontal_chart_attachment_error
    && Array.isArray(attachments) && attachments.filter(a => record(a).fileName === d.periodontal_chart_attachment_name).length === 1;
  if (chartRequired) branches.periodontal = chartProof ? 'completed' : d.periodontal_chart_attachment_error ? 'failed' : 'unknown';
  // Historical best-effort preparation explicitly skipped an unavailable chart.
  // Preserve its error as audit data; this proves a permitted skip, not attachment.
  if (legacy && branches.praktika === 'completed' && terminal(branches.icon) && branches.mediref === 'completed'
    && d.workflow_periodontal_chart_status === 'skipped'
    && d.periodontal_chart_attachment_error === 'Periodontal chart was requested, but no periodontal chart was found.'
    && !d.periodontal_chart_attached_at && !d.periodontal_chart_attachment_name)
    branches.periodontal = 'skipped';
  // A contradictory active attempt must never be hidden behind an older success/manual audit.
  const competing = e.uploads.some(j => j.id !== upload?.id && j.status !== 'failed');
  if (competing) branches.praktika = 'unknown';
  const jobs = [upload, icon, med].filter((j): j is ReadJob => Boolean(j));
  const last = Math.max(0, ...jobs.map(progress), time(verifiedUpload && verifiedUpload.verifiedAt), time(verifiedMed && verifiedMed.verifiedAt));
  const recent = last > 0 && last <= now && now - last < WORKFLOW_STALE_MS;
  const active = jobs.some(j => ['waiting','pending','processing','running'].includes(j.status) &&
    (!['processing','running'].includes(j.status) || Boolean(j.locked_by && time(j.locked_at))) && progress(j) <= now &&
    now - progress(j) < WORKFLOW_STALE_MS && (j === med ? e.liveMediref : Boolean(j.app_user_id && e.livePraktikaActors.has(j.app_user_id))));
  const conflictingMediref = e.mediref.some(j => !medJobs.includes(j));
  const allDone = !conflictingMediref && Object.values(branches).every(terminal) && ((parentValid && parent?.status === 'completed') || legacy) && !competing;
  const terminalTime = (job: ReadJob | undefined) => job?.status === 'completed' ? time(job.completed_at) || time(job.updated_at) : 0;
  const branchTimes = [
    verifiedUpload ? time(verifiedUpload.verifiedAt) : terminalTime(upload),
    ...(branches.mediref === 'completed' ? [verifiedMed ? time(verifiedMed.verifiedAt) : terminalTime(med)] : []),
    ...(branches.icon === 'completed' ? [terminalTime(icon)] : []),
    ...(branches.periodontal === 'completed' ? [time(d.periodontal_chart_attached_at)] : []),
  ];
  const parentCompletedAt = parentValid && parent?.status === 'completed' ? time(parent.completed_at) : 0;
  const completionTime = Math.max(parentCompletedAt, ...branchTimes);
  const completedAt = allDone && (parentCompletedAt > 0 || branchTimes.every(t => t > 0)) &&
    completionTime > 0 && completionTime <= now ? completionTime : null;
  const started = Boolean(d.workflow_status || d.workflow_praktika_upload_status || d.workflow_mediref_status ||
    d.workflow_icon_update_status || d.workflow_periodontal_chart_status || parent || e.uploads.length || e.icons.length || e.mediref.length || d.status === 'uploaded_to_praktika' || d.emailed_to_referrer_at || d.uploaded_to_praktika);
  const failed = Object.values(branches).includes('failed');
  const currentBranchMissing = parent && ((response.stage === 'upload' && !upload && !verifiedUpload) ||
    (response.stage === 'icon' && !icon && !terminal(branches.icon)) ||
    (response.stage === 'mediref' && !med && !verifiedMed && !terminal(branches.mediref)));
  const status = allDone ? 'completed' : !started ? 'not_started' : !failed && !currentBranchMissing && parent?.status !== 'failed' && recent && active ? 'completing' : 'needs_attention';
  const message = status !== 'needs_attention' ? null : branches.praktika === 'failed' ? 'Praktika upload needs verification.'
    : branches.mediref === 'failed' ? 'MediRef needs verification.'
    : branches.icon === 'failed' ? 'Praktika appointment icon update needs attention.' : staleWorkflowMessage;
  return { status, message, branches, lastProgressAt: last || null, lookupUnavailable: false, ...(allDone ? { completedAt } : {}),
    praktikaRecovery: parent?.status === 'failed' && response.stage === 'upload' && upload?.status === 'failed' && !verifiedUpload
      && !competing && d.status === 'approved' && !d.uploaded_to_praktika,
    medirefRecovery: Boolean(parent && ['failed','waiting'].includes(parent.status) && med?.status === 'failed'
      && d.workflow_mediref_status === 'failed' && !verifiedMed && e.mediref.every(j => j.status === 'failed')) };
}
export function shouldAppearInApproved(draft: WorkflowDraft): boolean {
  return ['approved','uploaded_to_praktika'].includes(draft.status || '') && draft.workflow_resolved?.status !== 'completed';
}
// Missing/failed enrichment must never fall back to raw error text or an endless spinner.
export function approvedWorkflow(draft: WorkflowDraft): ResolvedWorkflow {
  if (draft.workflow_resolved) return draft.workflow_resolved;
  const fallback = unavailableWorkflow();
  if (!draft.workflow_status && !draft.workflow_praktika_upload_status && !draft.workflow_mediref_status &&
    !draft.workflow_icon_update_status && !draft.workflow_periodontal_chart_status && draft.status === 'approved' && !draft.emailed_to_referrer_at && !draft.uploaded_to_praktika)
    return { ...fallback, status: 'not_started', message: null };
  return fallback;
}
