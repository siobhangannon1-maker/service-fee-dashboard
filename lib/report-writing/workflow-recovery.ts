import { historicalReconciliationAction, historicalInvalidationAction, historicalRetentionReleaseAction, type HistoricalReconciliationEvent } from './historical-reconciliation';
import { resolveWorkflow, unavailableWorkflow, type ReadJob, type WorkflowDraft } from './resolved-workflow';
import { hasLivePraktikaHelper } from '../praktika/helper-lease';
import { manualVerification } from './manual-verification';
import type { SupabaseClient } from '@supabase/supabase-js';
import { continuationChildId, continuationIntentId } from './workflow-continuation-token';
import { createWorkflowEvidenceReader, workflowJobColumns } from './historical-workflow-reader';
export const workflowFailureMessage = 'Workflow needs reconciliation. The approved letter and queued intent are retained.';
export const workflowConfigurationMessage = 'Workflow continuation is unavailable. Ask an administrator to check the web/Praktika worker URL and signing configuration. Queued work is retained.';
export const workflowAccountMessage = 'Staff account status could not be verified. Queued work is paused; contact an administrator if this persists.';
export async function workflowAccountState(db: SupabaseClient, actorId: string): Promise<'active' | 'inactive' | 'unavailable'> {
  try {
    const { data, error } = await db.from('user_status').select('is_active').eq('user_id', actorId)
      .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (error || typeof data?.is_active !== 'boolean') return 'unavailable';
    return data.is_active ? 'active' : 'inactive';
  } catch { return 'unavailable'; }
}
export const workflowStatusWarning = 'Workflow status may be temporarily out of date.';
export function staleWorkflowStatus<T>(draft: T) {
  return { ...draft, workflowStatusStale: true, workflow_reconciliation_warning: workflowStatusWarning };
}
// Read projection is intentionally independent of the best-effort draft update.
// A terminal intent remains authoritative after interruption, including on page refresh.
function projectLegacyWorkflowRecovery<T extends { id: string; workflow_status?: string | null }>(drafts: T[],
  intents: ReadonlyMap<string, ReadJob>, children: ReadonlyMap<string, ReadJob>, unavailable: ReadonlySet<string>): T[] {
  return drafts.map(draft => {
    try {
    if (unavailable.has(draft.id)) return staleWorkflowStatus(draft);
    const intent = intents.get(continuationIntentId(draft.id));
    if (!intent) return draft;
    if (typeof intent.status !== 'string' || (intent.response != null &&
      (typeof intent.response !== 'object' || Array.isArray(intent.response)))) throw new Error('Invalid workflow projection');
    const response = intent.response as Record<string, unknown> | null;
    const verifiedPraktika = manualVerification(intent.response, 'praktika', draft.id, intent.id);
    const verifiedMediref = manualVerification(intent.response, 'mediref', draft.id, intent.id);
    if (verifiedPraktika || verifiedMediref) draft = { ...draft,
      workflow_manual_verification: [verifiedPraktika, verifiedMediref].filter(Boolean),
      ...(verifiedPraktika ? { workflow_praktika_upload_status: 'completed' } : {}),
      ...(verifiedMediref ? { workflow_mediref_status: 'completed' } : {}),
    };
    if (response?.stage === 'upload' && !verifiedPraktika) {
      const uploadId = response?.retryUploadId || continuationChildId(intent.id, 'upload_report_to_praktika');
      const child = children.get(String(uploadId));
      if (child?.status === 'failed') return { ...draft, workflow_status: 'failed', workflow_praktika_upload_status: 'failed',
        workflow_error: 'Praktika upload needs verification.', workflow_last_message: 'Praktika upload needs verification.',
        praktikaFailedUploadId: child.id };
    }
    if (intent.status === 'failed' && (verifiedPraktika || verifiedMediref)) {
      const message = (draft as T & { workflow_error?: string | null }).workflow_error ||
        (response?.stage === 'icon' ? 'Praktika icon update needs verification.' : 'Workflow needs reconciliation. Remaining steps need attention.');
      return { ...draft, workflow_status: 'failed', workflow_error: message, workflow_last_message: message };
    }
    if (intent.status === 'failed') return { ...draft, workflow_status: 'failed', workflow_error: workflowFailureMessage, workflow_last_message: workflowFailureMessage };
    if (['waiting', 'processing'].includes(intent.status)) {
      const issue = response?.issue;
      const message = issue === 'configuration_unavailable' || issue === 'continuation_unavailable' ? workflowConfigurationMessage
        : issue === 'account_unavailable' ? workflowAccountMessage
        : issue === 'periodontal_unavailable' ? 'Periodontal chart is temporarily unavailable. Queued work is retained while Praktika verification recovers.'
        : Date.parse(intent.updated_at || '') < Date.now() - 300_000
          ? 'Workflow is still waiting. Check Praktika connection and ask an administrator to verify the continuation worker if this persists.' : null;
      if (message) return { ...draft, workflow_status: 'running', workflow_error: null, workflow_last_message: message };
    }
    return draft;
    } catch { return staleWorkflowStatus(draft); }
  });
}

// Additive display evidence only. Keep existing durable fields/audit data for History
// and existing callers; neither this resolver nor its queries can execute a workflow.
export async function projectWorkflowRecovery<T extends { id: string; workflow_status?: string | null }>(db: SupabaseClient, drafts: T[]): Promise<T[]> {
  // One clock starts BEFORE any lookup. Every database read uses this reader.
  const reader = createWorkflowEvidenceReader(AbortSignal.timeout(5000));
  const indexes = drafts.map((d,i)=>({d:d as T & WorkflowDraft,i}))
    .filter(({d})=>['approved','uploaded_to_praktika'].includes(d.status || ''));
  const ids = indexes.map(({d})=>d.id);
  const [parentRead, praktikaRead, medirefRead] = await Promise.all([
    // Two bounded ID lists: canonical IDs also detect malformed requests, while
    // reportDraftId finds noncanonical/superseding parents. Never all IDs at once.
    reader.read<ReadJob>(drafts.map(d=>d.id),batch=>db.from('praktika_helper_jobs').select(workflowJobColumns)
      .eq('job_type','complete_report_workflow')
      .or(`id.in.(${batch.map(continuationIntentId).join(',')}),request->>reportDraftId.in.(${batch.join(',')})`),50),
    reader.read<ReadJob>(ids,batch=>db.from('praktika_helper_jobs').select(workflowJobColumns)
      .in('job_type',['upload_report_to_praktika','update_praktika_letter_icons']).in('request->>reportDraftId',batch)),
    reader.read<ReadJob>(ids,batch=>db.from('mediref_helper_jobs')
      .select('id,job_type,status,payload,result,created_at,updated_at,locked_at,locked_by')
      .eq('job_type','send_mediref_letter').in('payload->>draftId',batch)),
  ]);
  const parents = new Map(parentRead.rows.map(j=>[j.id,j]));
  const uploads = new Map(praktikaRead.rows.filter(j=>j.job_type==='upload_report_to_praktika').map(j=>[j.id,j]));
  const childIds = new Map<string,string>();
  for (const d of drafts) {
    const parent = parents.get(continuationIntentId(d.id));
    const response = parent?.response as {stage?:string;retryUploadId?:string} | null;
    if (parent && response?.stage==='upload' && !manualVerification(parent.response,'praktika',d.id,parent.id))
      childIds.set(d.id,response.retryUploadId || continuationChildId(parent.id,'upload_report_to_praktika'));
  }
  const active = (j:ReadJob)=>['pending','waiting','processing','running'].includes(j.status);
  const actors = [...new Set(praktikaRead.rows.filter(active).map(j=>j.app_user_id).filter((id):id is string=>Boolean(id)))];
  type PraktikaLive = {app_user_id:string;status:string;helper_instance_id:string|null;helper_heartbeat_at:string|null};
  type MedirefLive = {status:string;helper_instance_id:string|null;helper_heartbeat_at:string|null;helper_expires_at:string|null;helper_stopping_at:string|null};
  const [childRead,reconciliations,praktikaLive,medirefLive] = await Promise.all([
    reader.read<ReadJob>([...childIds.values()].filter(id=>!uploads.has(id)),batch=>db.from('praktika_helper_jobs')
      .select(workflowJobColumns).eq('job_type','upload_report_to_praktika').in('id',batch)),
    reader.read<HistoricalReconciliationEvent>(ids,batch=>db.from('report_writing_audit_events')
      .select('id,action,entity_id,details').in('action',[historicalReconciliationAction,historicalInvalidationAction,historicalRetentionReleaseAction]).in('entity_id',batch)),
    reader.read<PraktikaLive>(actors,batch=>db.from('praktika_sessions').select('id,app_user_id,status,helper_instance_id,helper_heartbeat_at')
      .eq('scope','user').in('app_user_id',batch)),
    reader.read<MedirefLive>(medirefRead.rows.some(active)?['practice']:[],()=>db.from('mediref_sessions')
      .select('id,status,helper_instance_id,helper_heartbeat_at,helper_expires_at,helper_stopping_at').eq('scope','practice').is('app_user_id',null)),
  ]);
  for (const j of childRead.rows) uploads.set(j.id,j);
  const projectionUnavailable = new Set(parentRead.failed);
  for (const [draftId,jobId] of childIds) if (childRead.failed.has(jobId)) projectionUnavailable.add(draftId);
  const projected = projectLegacyWorkflowRecovery(drafts,parents,uploads,projectionUnavailable);
  const output = [...projected],now=Date.now();
  const livePraktikaActors = new Set(praktikaLive.rows.filter(j=>['connected','refreshing'].includes(j.status) && hasLivePraktikaHelper(j,now)).map(j=>j.app_user_id));
  const m=medirefLive.rows[0];
  const liveMediref=medirefLive.rows.length===1 && ['connected','refreshing'].includes(m.status) && Boolean(m.helper_instance_id) &&
    !m.helper_stopping_at && Date.parse(m.helper_expires_at || '')>now && Date.parse(m.helper_heartbeat_at || '')<=now &&
    now-Date.parse(m.helper_heartbeat_at || '')<120000;
  for (const {d,i} of indexes) {
    const jobs=praktikaRead.rows.filter(j=>j.request?.reportDraftId===d.id);
    const mediref=medirefRead.rows.filter(j=>j.payload?.draftId===d.id);
    if (projectionUnavailable.has(d.id) || praktikaRead.failed.has(d.id) || medirefRead.failed.has(d.id) ||
      reconciliations.failed.has(d.id) ||
      jobs.some(j=>active(j) && j.app_user_id && praktikaLive.failed.has(j.app_user_id)) || mediref.some(active) && medirefLive.failed.size>0) {
      output[i]={...staleWorkflowStatus(projected[i]),workflow_resolved:unavailableWorkflow()};continue;
    }
    const parent=parents.get(continuationIntentId(d.id));
    const response=parent?.response as {retryUploadId?:string}|null;
    output[i]={...projected[i],workflow_resolved:resolveWorkflow(d,{
      parent,hasOtherParent:parentRead.rows.some(j=>j.request?.reportDraftId===d.id && j.id!==parent?.id),
      uploads:jobs.filter(j=>j.job_type==='upload_report_to_praktika'),icons:jobs.filter(j=>j.job_type==='update_praktika_letter_icons'),mediref,
      currentUploadId:parent?response?.retryUploadId || continuationChildId(parent.id,'upload_report_to_praktika'):undefined,
      currentIconId:parent?continuationChildId(parent.id,'update_praktika_letter_icons'):undefined,
      livePraktikaActors,liveMediref,reconciliations:reconciliations.rows.filter(event=>event.entity_id===d.id),
    },now)};
  }
  return output;
}
