import type { CurrentWorkflowPresentation } from './draft-contract';
import {projectHistoricalAttention,historicalAttentionAction,historicalAttentionInvalidated} from './historical-attention';
import {manualHistoricalMedirefActions,manualHistoricalMedirefAction,manualHistoricalMedirefContract} from './manual-historical-mediref';
import { durableHistoricalWorkflow, historicalReconciliationAction, historicalInvalidationAction, historicalRetentionReleaseAction, type HistoricalReconciliationEvent } from './historical-reconciliation';
import { resolveWorkflow, unavailableWorkflow, WORKFLOW_STALE_MS, type WorkflowEvidence, type ResolvedWorkflow, type ReadJob, type WorkflowDraft } from './resolved-workflow';
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

// Presentation only: immutable creation/completion evidence bounds waiting; polling
// timestamps never renew this window. Unknown retains the existing resolver UI.
export function currentWorkflowPresentation(draft: WorkflowDraft, evidence: WorkflowEvidence,
  resolved: ResolvedWorkflow, connectionBlocked: boolean, now: number): CurrentWorkflowPresentation {
  const parent = evidence.parent;
  const response = parent?.response as Record<string, unknown> | null;
  if (!parent || parent.id !== continuationIntentId(draft.id || '') ||
    parent.job_type !== 'complete_report_workflow' || parent.request?.reportDraftId !== draft.id ||
    !parent.app_user_id || parent.request?.actorUserId !== parent.app_user_id ||
    !['waiting', 'processing'].includes(parent.status) || !parent.created_at || evidence.hasOtherParent ||
    resolved.lookupUnavailable || resolved.praktikaRecovery || resolved.medirefRecovery ||
    !['needs_attention','completing'].includes(resolved.status) ||
    Object.values(resolved.branches).includes('failed') || response?.retryUploadId ||
    draft.periodontal_chart_attachment_error) return 'unknown';
  const jobs = [...evidence.uploads, ...evidence.icons, ...evidence.mediref];
  if (jobs.some(j => j.status === 'failed')) return 'unknown';
  const stamps = [parent.created_at, ...jobs.map(j => j.created_at),
    ...jobs.filter(j => j.status === 'completed').map(j => j.completed_at || j.updated_at)];
  const times = stamps.filter(Boolean).map(v => Date.parse(v!));
  if (times.some(t => !Number.isFinite(t) || t > now) || !times.length) return 'unknown';
  const aged = now - Math.max(...times) >= WORKFLOW_STALE_MS;
  if (evidence.uploads.length > 1 || evidence.icons.length > 1 || evidence.mediref.length > 1) return 'unknown';
  for (const job of [...evidence.uploads,...evidence.icons]) {
    if (job.id !== continuationChildId(parent.id, job.job_type as 'upload_report_to_praktika' | 'update_praktika_letter_icons') ||
      job.request?.reportDraftId !== draft.id || job.request?.continuationId !== parent.id ||
      job.app_user_id !== parent.app_user_id) return 'unknown';
  }
  if (evidence.mediref.some(j => j.payload?.draftId !== draft.id || j.payload?.workflowContinuationId !== parent.id)) return 'unknown';
  // An exact, unlocked queued icon remains a known waiting stage even when aged.
  // This is not evidence of authentication, invocation or eventual completion.
  const icon = evidence.icons[0];
  const noError = (job: ReadJob) => (job as ReadJob & { error_message?: unknown }).error_message === null;
  const exactQueuedIcon = parent.status === 'waiting' && response?.stage === 'icon' && !response.issue &&
    !parent.locked_at && !parent.locked_by && !parent.failed_at && noError(parent) &&
    evidence.uploads.length === 1 && evidence.uploads[0].status === 'completed' &&
    resolved.branches.praktika === 'completed' && evidence.icons.length === 1 &&
    icon.status === 'pending' && icon.response === null && noError(icon) &&
    !icon.locked_at && !icon.locked_by && !icon.failed_at && !icon.completed_at &&
    ![parent, ...jobs].some(j => j.request?.manualRetry) &&
    evidence.currentUploadId === evidence.uploads[0].id && evidence.currentIconId === icon.id;
  if (aged && !exactQueuedIcon) return 'unknown';
  if (response?.issue) return 'unknown';
  if (aged) return 'waiting_icon_delayed';
  if (connectionBlocked) return 'waiting_connection';
  const upload = evidence.uploads[0];
  if (response?.stage === 'upload') {
    if (!upload && parent.status === 'waiting') return 'waiting_upload';
    if (upload && ['pending','processing'].includes(upload.status) && resolved.branches.praktika === 'active' &&
      evidence.livePraktikaActors.has(parent.app_user_id) && resolved.status === 'completing') return 'uploading';
  }
  if (response?.stage === 'icon' && resolved.branches.praktika === 'completed' &&
    (parent.status === 'waiting' || resolved.status === 'completing')) return 'waiting_icon';
  if (response?.stage === 'mediref' && resolved.branches.praktika === 'completed' &&
    ['completed','skipped'].includes(resolved.branches.icon) &&
    (parent.status === 'waiting' || resolved.status === 'completing')) return 'waiting_mediref';
  return 'unknown';
}

// Additive display evidence only. Keep existing durable fields/audit data for History
// and existing callers; neither this resolver nor its queries can execute a workflow.
export async function projectWorkflowRecovery<T extends { id: string; workflow_status?: string | null }>(db: SupabaseClient, drafts: T[]): Promise<T[]> {
  // One clock starts BEFORE any lookup. Every database read uses this reader.
  const reader = createWorkflowEvidenceReader(AbortSignal.timeout(5000));
  const originalDrafts = drafts;
  const approvedIds = drafts.filter(d=>['approved','uploaded_to_praktika'].includes((d as T & WorkflowDraft).status || '')).map(d=>d.id);
  const reconciliations = await reader.read<HistoricalReconciliationEvent>(approvedIds,batch=>db.from('report_writing_audit_events')
    .select('id,action,entity_id,details').in('action',[historicalReconciliationAction,historicalInvalidationAction,historicalRetentionReleaseAction,...manualHistoricalMedirefActions,historicalAttentionAction,historicalAttentionInvalidated]).in('entity_id',batch));
  const eventsByDraft = new Map<string, HistoricalReconciliationEvent[]>();
  for (const event of reconciliations.rows) {
    const events = eventsByDraft.get(event.entity_id) || [];
    events.push(event); eventsByDraft.set(event.entity_id,events);
  }
  const completed = new Map<string,T>();
  const historicalNow = Date.now();
  for (const draft of drafts) {
    const events = eventsByDraft.get(draft.id);
    if (!events || reconciliations.failed.has(draft.id)) continue;
    // Existing database fences atomically append invalidation evidence for later
    // relevant draft/helper activity. Only a complete event read can take this path.
    const evidence = { uploads:[], icons:[], mediref:[], livePraktikaActors:new Set<string>(),
      liveMediref:false, reconciliations:events };
    const resolved = durableHistoricalWorkflow(draft as T & WorkflowDraft,evidence,historicalNow);
    if (resolved?.status === 'completed') completed.set(draft.id,{...draft,workflow_resolved:resolved,workflow_continuation_context:'unknown',workflow_connection_block:'unknown',workflow_current_presentation:'unknown'});
  }
  // Discovery only: the existing resolver remains the authority for the full
  // verification contract. Source changes are covered by the audit invalidation
  // fences, as for durable reconciliation above; read every event before deciding.
  const manualCandidates = new Map<string,string[]>();
  for (const draft of drafts) {
    if (completed.has(draft.id) || reconciliations.failed.has(draft.id)) continue;
    const ids = (eventsByDraft.get(draft.id) || []).flatMap(event=>{
      const v = event.details as Record<string,unknown> | null;
      if (event.action!==manualHistoricalMedirefAction || !v || typeof v!=='object' || Array.isArray(v)
        || v.contract!==manualHistoricalMedirefContract || v.version!==1 || v.source!=='human_external_verification'
        || v.draftId!==draft.id || !Array.isArray(v.failedJobIds) || v.failedJobIds.length<1 || v.failedJobIds.length>2
        || !v.failedJobIds.every((id:unknown)=>typeof id==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))) return [];
      return v.failedJobIds as string[];
    });
    if (ids.length) manualCandidates.set(draft.id,ids);
  }
  const manualJobs = await reader.read<ReadJob>([...manualCandidates.values()].flat(),batch=>db.from('mediref_helper_jobs')
    .select('id,job_type,status,payload,result,created_at,updated_at,locked_at,locked_by')
    .eq('job_type','send_mediref_letter').in('id',batch));
  for (const draft of drafts) {
    const ids = manualCandidates.get(draft.id);
    if (!ids || ids.some(id=>manualJobs.failed.has(id))) continue;
    const evidence = {uploads:[],icons:[],
      mediref:manualJobs.rows.filter(j=>ids.includes(j.id) || j.payload?.draftId===draft.id),
      reconciliations:eventsByDraft.get(draft.id) || [],livePraktikaActors:new Set<string>(),liveMediref:false};
    const resolved = resolveWorkflow(draft as T & WorkflowDraft,evidence,historicalNow);
    if (resolved.status==='completed' && resolved.historicalMedirefVerification)
      completed.set(draft.id,{...draft,workflow_resolved:resolved,workflow_continuation_context:'unknown',workflow_connection_block:'unknown',workflow_current_presentation:'unknown'});
  }
  drafts = drafts.filter(d=>!completed.has(d.id));
  if (!drafts.length) return originalDrafts.map(d=>completed.get(d.id) || d);
  const indexes = drafts.map((d,i)=>({d:d as T & WorkflowDraft,i}))
    .filter(({d})=>['approved','uploaded_to_praktika'].includes(d.status || ''));
  const ids = indexes.map(({d})=>d.id);
  const [parentRead, praktikaRead, medirefRead] = await Promise.all([
    // Two bounded ID lists: canonical IDs also detect malformed requests, while
    // reportDraftId finds noncanonical/superseding parents. Never all IDs at once.
    reader.read<ReadJob>(drafts.map(d=>d.id),batch=>db.from('praktika_helper_jobs').select(`${workflowJobColumns},error_message`)
      .eq('job_type','complete_report_workflow')
      .or(`id.in.(${batch.map(continuationIntentId).join(',')}),request->>reportDraftId.in.(${batch.join(',')})`),50),
    reader.read<ReadJob>(ids,batch=>db.from('praktika_helper_jobs').select(`${workflowJobColumns},error_message`)
      .in('job_type',['upload_report_to_praktika','update_praktika_letter_icons']).in('request->>reportDraftId',batch)),
    reader.read<ReadJob>(ids,batch=>db.from('mediref_helper_jobs')
      .select('id,job_type,status,payload,result,created_at,updated_at,locked_at,locked_by')
      .eq('job_type','send_mediref_letter').in('payload->>draftId',batch)),
  ]);
  const parents = new Map(parentRead.rows.map(j=>[j.id,j]));
  // Presentation metadata only. A skipped/failed parent read never proves absence.
  const continuationContexts = new Map(drafts.map(d=>[d.id,
    parentRead.failed.has(d.id) ? 'unknown' :
      parents.has(continuationIntentId(d.id)) || parentRead.rows.some(j=>j.request?.reportDraftId===d.id)
        ? 'present' : 'absent',
  ] as const));
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
  const [childRead,praktikaLive,medirefLive] = await Promise.all([
    reader.read<ReadJob>([...childIds.values()].filter(id=>!uploads.has(id)),batch=>db.from('praktika_helper_jobs')
      .select(`${workflowJobColumns},error_message`).eq('job_type','upload_report_to_praktika').in('id',batch)),
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
  const connectionBlocked = new Set<string>();
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
      output[i]={...staleWorkflowStatus(projected[i]),workflow_resolved:unavailableWorkflow(),workflow_current_presentation:'unknown'};continue;
    }
    const parent=parents.get(continuationIntentId(d.id));
    const response=parent?.response as {retryUploadId?:string}|null;
    const evidence = {
      parent,hasOtherParent:parentRead.rows.some(j=>j.request?.reportDraftId===d.id && j.id!==parent?.id),
      uploads:jobs.filter(j=>j.job_type==='upload_report_to_praktika'),icons:jobs.filter(j=>j.job_type==='update_praktika_letter_icons'),mediref,
      currentUploadId:parent?response?.retryUploadId || continuationChildId(parent.id,'upload_report_to_praktika'):undefined,
      currentIconId:parent?continuationChildId(parent.id,'update_praktika_letter_icons'):undefined,
      livePraktikaActors,liveMediref,reconciliations:eventsByDraft.get(d.id) || [],
    };
    // Display evidence only: require the unambiguous original pending upload and
    // its exact execution user's explicit credential challenge, never missing liveness.
    const child = evidence.uploads[0];
    const sessions = praktikaLive.rows.filter(s=>s.app_user_id===parent?.app_user_id);
    if (parent && parent.status==='waiting' && parent.request?.reportDraftId===d.id &&
      parent.app_user_id && parent.request?.actorUserId===parent.app_user_id &&
      (parent.response as {stage?:string}|null)?.stage==='upload' && !response?.retryUploadId &&
      !evidence.hasOtherParent && parentRead.rows.filter(p=>p.id===parent.id).length===1 &&
      evidence.uploads.length===1 && child.id===continuationChildId(parent.id,'upload_report_to_praktika') &&
      child.request?.reportDraftId===d.id && child.request?.continuationId===parent.id &&
      !child.request?.manualRetry && child.status==='pending' && child.app_user_id===parent.app_user_id &&
      !child.locked_at && !child.locked_by && child.response==null &&
      !manualVerification(parent.response,'praktika',d.id,parent.id) &&
      !praktikaLive.failed.has(parent.app_user_id) && sessions.length===1 &&
      sessions[0].status==='waiting_for_credentials') connectionBlocked.add(d.id);
    const resolved = resolveWorkflow(d,evidence,now);
    output[i]={...projected[i],workflow_resolved:resolved,workflow_attention:projectHistoricalAttention(d,evidence,now),
      workflow_current_presentation:currentWorkflowPresentation(d,evidence,resolved,connectionBlocked.has(d.id),now)};
  }
  const recovered = new Map(output.map(d=>[d.id,d]));
  return originalDrafts.map(d=>completed.get(d.id) || {...(recovered.get(d.id) || d),
    workflow_current_presentation:(recovered.get(d.id) as T & {workflow_current_presentation?:CurrentWorkflowPresentation})?.workflow_current_presentation || 'unknown',
    workflow_continuation_context:continuationContexts.get(d.id) || 'unknown',
    workflow_connection_block:connectionBlocked.has(d.id)?'praktika_credentials_required':'unknown'});
}
