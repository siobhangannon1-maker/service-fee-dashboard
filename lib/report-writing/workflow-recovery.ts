import type { SupabaseClient } from '@supabase/supabase-js';
import { continuationIntentId } from './workflow-continuation-token';
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
export async function projectWorkflowRecovery<T extends { id: string; workflow_status?: string | null }>(db: SupabaseClient, drafts: T[]): Promise<T[]> {
  if (!drafts.length) return drafts;
  try {
  const { data, error } = await db.from('praktika_helper_jobs').select('id,status,response,updated_at')
    .eq('job_type', 'complete_report_workflow').in('id', drafts.map(d => continuationIntentId(d.id)))
    .abortSignal(AbortSignal.timeout(5000));
  if (error) throw new Error('Workflow status is temporarily unavailable.');
  const intents = new Map((data || []).map(j => [j.id, j]));
  return drafts.map(draft => {
    try {
    const intent = intents.get(continuationIntentId(draft.id));
    if (!intent) return draft;
    if (typeof intent.status !== 'string' || (intent.response != null &&
      (typeof intent.response !== 'object' || Array.isArray(intent.response)))) throw new Error('Invalid workflow projection');
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
  });
  } catch {
    return drafts.map(staleWorkflowStatus);
  }
}
