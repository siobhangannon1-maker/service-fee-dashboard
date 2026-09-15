import { resolveWorkflow, unavailableWorkflow, type ReadJob, type WorkflowDraft } from './resolved-workflow';
import { hasLivePraktikaHelper } from '../praktika/helper-lease';
import { manualVerification } from './manual-verification';
import type { SupabaseClient } from '@supabase/supabase-js';
import { continuationChildId, continuationIntentId } from './workflow-continuation-token';
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
async function projectLegacyWorkflowRecovery<T extends { id: string; workflow_status?: string | null }>(db: SupabaseClient, drafts: T[]): Promise<T[]> {
  if (!drafts.length) return drafts;
  try {
  const { data, error } = await db.from('praktika_helper_jobs').select('id,status,response,updated_at')
    .eq('job_type', 'complete_report_workflow').in('id', drafts.map(d => continuationIntentId(d.id)))
    .abortSignal(AbortSignal.timeout(5000));
  if (error) throw new Error('Workflow status is temporarily unavailable.');
  const intents = new Map((data || []).map(j => [j.id, j]));
  return await Promise.all(drafts.map(async draft => {
    try {
    const intent = intents.get(continuationIntentId(draft.id));
    if (!intent) return draft;
    if (typeof intent.status !== 'string' || (intent.response != null &&
      (typeof intent.response !== 'object' || Array.isArray(intent.response)))) throw new Error('Invalid workflow projection');
    const verifiedPraktika = manualVerification(intent.response, 'praktika', draft.id, intent.id);
    const verifiedMediref = manualVerification(intent.response, 'mediref', draft.id, intent.id);
    if (verifiedPraktika || verifiedMediref) draft = { ...draft,
      workflow_manual_verification: [verifiedPraktika, verifiedMediref].filter(Boolean),
      ...(verifiedPraktika ? { workflow_praktika_upload_status: 'completed' } : {}),
      ...(verifiedMediref ? { workflow_mediref_status: 'completed' } : {}),
    };
    if (intent.response?.stage === 'upload' && !verifiedPraktika) {
      const uploadId = intent.response?.retryUploadId || continuationChildId(intent.id, 'upload_report_to_praktika');
      const { data: child, error: childError } = await db.from('praktika_helper_jobs').select('id,status')
        .eq('id', uploadId).eq('job_type', 'upload_report_to_praktika')
        .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
      if (childError) throw new Error('Upload projection unavailable');
      if (child?.status === 'failed') return { ...draft, workflow_status: 'failed', workflow_praktika_upload_status: 'failed',
        workflow_error: 'Praktika upload needs verification.', workflow_last_message: 'Praktika upload needs verification.',
        praktikaFailedUploadId: child.id };
    }
    if (intent.status === 'failed' && (verifiedPraktika || verifiedMediref)) {
      const message = (draft as T & { workflow_error?: string | null }).workflow_error ||
        (intent.response?.stage === 'icon' ? 'Praktika icon update needs verification.' : 'Workflow needs reconciliation. Remaining steps need attention.');
      return { ...draft, workflow_status: 'failed', workflow_error: message, workflow_last_message: message };
    }
    if (intent.status === 'failed') return { ...draft, workflow_status: 'failed', workflow_error: workflowFailureMessage, workflow_last_message: workflowFailureMessage };
    if (['waiting', 'processing'].includes(intent.status)) {
      const issue = intent.response?.issue;
      const message = issue === 'configuration_unavailable' || issue === 'continuation_unavailable' ? workflowConfigurationMessage
        : issue === 'account_unavailable' ? workflowAccountMessage
        : issue === 'periodontal_unavailable' ? 'Periodontal chart is temporarily unavailable. Queued work is retained while Praktika verification recovers.'
        : Date.parse(intent.updated_at) < Date.now() - 300_000
          ? 'Workflow is still waiting. Check Praktika connection and ask an administrator to verify the continuation worker if this persists.' : null;
      if (message) return { ...draft, workflow_status: 'running', workflow_error: null, workflow_last_message: message };
    }
    return draft;
    } catch { return staleWorkflowStatus(draft); }
  }));
  } catch {
    return drafts.map(staleWorkflowStatus);
  }
}

// Additive display evidence only. Keep existing durable fields/audit data for History
// and existing callers; neither this resolver nor its queries can execute a workflow.
export async function projectWorkflowRecovery<T extends { id: string; workflow_status?: string | null }>(db: SupabaseClient, drafts: T[]): Promise<T[]> {
  const projected = await projectLegacyWorkflowRecovery(db, drafts);
  const output = [...projected];
  const indexes = drafts.map((d,i) => ({ d: d as T & WorkflowDraft, i }))
    .filter(({d}) => ['approved','uploaded_to_praktika'].includes(d.status || ''));
  // Bound additional read-time enrichment as a whole, not five seconds per batch.
  // A large History list must still return its durable rows when enrichment is slow.
  const signal = AbortSignal.timeout(5000);
  let offset = 0;
  async function readBatch(batch: typeof indexes) {
    try {
      signal.throwIfAborted();
      const ids = batch.map(({d}) => d.id);
      const readJobs = async (table: 'praktika_helper_jobs' | 'mediref_helper_jobs'): Promise<ReadJob[]> => {
        const rows: ReadJob[] = [];
        for (let start = 0; ; start += 500) {
          const query = table === 'praktika_helper_jobs'
            ? db.from(table).select('id,job_type,status,app_user_id,request,response,created_at,updated_at,locked_at,locked_by,completed_at,failed_at')
              .in('job_type', ['complete_report_workflow','upload_report_to_praktika','update_praktika_letter_icons'])
              .in('request->>reportDraftId', ids)
            : db.from(table).select('id,job_type,status,payload,result,created_at,updated_at,locked_at,locked_by')
              .eq('job_type','send_mediref_letter').in('payload->>draftId', ids);
          const { data, error } = await query.order('id').range(start,start+499).abortSignal(signal);
          if (error || !Array.isArray(data)) throw new Error('Workflow evidence unavailable');
          rows.push(...data);
          if (data.length < 500) return rows;
        }
      };
      const [praktika, mediref] = await Promise.all([readJobs('praktika_helper_jobs'), readJobs('mediref_helper_jobs')]);
      const active = (j: ReadJob) => ['pending','waiting','processing','running'].includes(j.status);
      const actors = [...new Set(praktika.filter(j => j.job_type !== 'complete_report_workflow' && active(j))
        .map(j => j.app_user_id).filter((id): id is string => Boolean(id)))];
      const now = Date.now();
      const livePraktikaActors = new Set<string>();
      if (actors.length) {
        const {data,error} = await db.from('praktika_sessions').select('app_user_id,status,helper_instance_id,helper_heartbeat_at')
          .eq('scope','user').in('app_user_id',actors).abortSignal(signal);
        if (error || !data) throw new Error('Workflow liveness unavailable');
        for (const session of data) if (['connected','refreshing'].includes(session.status) && hasLivePraktikaHelper(session,now))
          livePraktikaActors.add(session.app_user_id);
      }
      let liveMediref = false;
      if (mediref.some(active)) {
        const {data,error} = await db.from('mediref_sessions').select('status,helper_instance_id,helper_heartbeat_at,helper_expires_at,helper_stopping_at')
          .eq('scope','practice').is('app_user_id',null).abortSignal(signal);
        if (error || !data) throw new Error('Workflow liveness unavailable');
        liveMediref = data.length === 1 && ['connected','refreshing'].includes(data[0].status) &&
          Boolean(data[0].helper_instance_id) && !data[0].helper_stopping_at && Date.parse(data[0].helper_expires_at) > now &&
          Date.parse(data[0].helper_heartbeat_at) <= now && now - Date.parse(data[0].helper_heartbeat_at) < 120000;
      }
      for (const {d,i} of batch) {
        const jobs = praktika.filter(j => j.request?.reportDraftId === d.id);
        const parent = jobs.find(j => j.id === continuationIntentId(d.id) && j.job_type === 'complete_report_workflow');
        const response = parent?.response as { retryUploadId?: string } | null;
        output[i] = { ...projected[i], workflow_resolved: resolveWorkflow(d, {
          parent, hasOtherParent: jobs.some(j => j.job_type === 'complete_report_workflow' && j.id !== parent?.id), uploads: jobs.filter(j => j.job_type === 'upload_report_to_praktika'),
          icons: jobs.filter(j => j.job_type === 'update_praktika_letter_icons'),
          mediref: mediref.filter(j => j.payload?.draftId === d.id),
          currentUploadId: parent ? response?.retryUploadId || continuationChildId(parent.id,'upload_report_to_praktika') : undefined,
          currentIconId: parent ? continuationChildId(parent.id,'update_praktika_letter_icons') : undefined,
          livePraktikaActors, liveMediref,
        }, now) };
      }
    } catch {
      for (const {i} of batch) output[i] = { ...staleWorkflowStatus(projected[i]), workflow_resolved: unavailableWorkflow() };
    }
  }
  // Four bounded readers; each owns distinct indexes and paginates its evidence.
  await Promise.all(Array.from({length: Math.min(4, Math.ceil(indexes.length / 50))}, async () => {
    while (offset < indexes.length) {
      const batch = indexes.slice(offset, offset + 50);
      offset += 50;
      await readBatch(batch);
    }
  }));
  return output;
}
