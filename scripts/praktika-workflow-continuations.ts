import type { PraktikaJobOwnership } from "../lib/praktika/helper-lease";
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { continuationToken, workflowAppOrigin, workflowConfigurationIssue } from '../lib/report-writing/workflow-continuation-token';
const inFlight = new Set<string>();
// Existing helper poll drives this. The HTTP request runs alongside the drain so
// upload/periodontal helper jobs created by the server can actually be processed.
export async function pollPraktikaWorkflowContinuations(db: SupabaseClient, actorId: string | null | undefined, ownership: Pick<PraktikaJobOwnership, "assertOwned" | "isShuttingDown">) {
  try {
  await ownership.assertOwned();
  if (ownership.isShuttingDown?.()) return;
  const origin = workflowAppOrigin();
  const configurationIssue = workflowConfigurationIssue();
  if (!actorId || inFlight.has(actorId)) return;
  const stale = new Date(Date.now() - 300_000).toISOString();
  const { data, error } = await db.from('praktika_helper_jobs').select('*')
    .eq('job_type', 'complete_report_workflow').eq('app_user_id', actorId)
    .or(`status.eq.waiting,and(status.eq.processing,locked_at.lt.${stale})`)
    .order('created_at').limit(1).abortSignal(AbortSignal.timeout(5000));
  if (error || !data?.length) return;
  const intent = data[0];
  await ownership.assertOwned();
  if (ownership.isShuttingDown?.()) return;
  const lock = randomUUID();
  const { data: claimed, error: claimError } = await db.from('praktika_helper_jobs').update({
    status: 'processing', locked_at: new Date().toISOString(), locked_by: lock,
    response: { ...intent.response, dispatched: false }, updated_at: new Date().toISOString(),
  }).eq('id', intent.id).eq('status', intent.status).eq('updated_at', intent.updated_at).select('id').maybeSingle();
  if (claimError || !claimed) return;
  await ownership.assertOwned();
  if (ownership.isShuttingDown?.()) return;
  const pause = async (issue: string) => {
    const rejectedBeforeExecution = issue === 'configuration_unavailable';
    // Transport uncertainty retains the dispatch lock and five-minute recovery delay.
    await db.from('praktika_helper_jobs').update({
      ...(rejectedBeforeExecution ? { status: 'waiting', locked_by: null, locked_at: null } : {}),
      response: { ...intent.response, dispatched: !rejectedBeforeExecution, issue }, updated_at: new Date().toISOString(),
    }).eq('id', intent.id).eq('locked_by', lock);
  };
  if (configurationIssue) { await pause(configurationIssue); return; }
  inFlight.add(actorId);
  void fetch(`${origin}/api/report-writing/continue-praktika-workflow`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Workflow-Token': continuationToken(intent.id, lock, process.env.SUPABASE_SERVICE_ROLE_KEY!) },
    body: JSON.stringify({ intentId: intent.id, lock }), redirect: 'error', signal: AbortSignal.timeout(180_000),
  }).then(async response => {
    if (!response.ok) await pause([401, 403, 404].includes(response.status) ? 'configuration_unavailable' : 'continuation_unavailable');
  }).catch(async () => { await pause('continuation_unavailable').catch(() => {}); })
    .finally(() => inFlight.delete(actorId));
  } catch { /* Continuation transport failure must not stop normal helper draining. */ }
}
