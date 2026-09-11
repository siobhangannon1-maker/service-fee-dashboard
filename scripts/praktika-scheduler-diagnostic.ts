import type { SupabaseClient } from '@supabase/supabase-js';
import type { BrowserContext } from 'playwright';
import { hasLivePraktikaHelper } from '../lib/praktika/helper-lease';
import { praktikaHelperToken } from '../lib/praktika/authentication-probe';
import { probeSchedulerCandidate, SCHEDULER_PROBE_JOB } from '../lib/praktika/scheduler-auth-candidate';

// Dedicated status is intentionally invisible to the watcher and normal job drain.
// No retry, authentication callback, session write or workflow callback is provided.
export async function pollSchedulerDiagnostic(db: SupabaseClient, context: BrowserContext,
  owner: { sessionId: string; generation: string; assertOwned(): Promise<void>; busy(): boolean }) {
  if (owner.busy()) return;
  await owner.assertOwned();
  const { data: session, error } = await db.from('praktika_sessions')
    .select('app_user_id,scope,status,helper_instance_id,helper_heartbeat_at')
    .eq('id', owner.sessionId).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (error || !session || session.scope !== 'user' || !session.app_user_id
    || session.helper_instance_id !== owner.generation || !hasLivePraktikaHelper(session)
    || !['connected', 'refreshing'].includes(session.status) || owner.busy()) return;
  const { data: rows, error: lookupError } = await db.from('praktika_helper_jobs').select('id')
    .eq('job_type', SCHEDULER_PROBE_JOB).eq('status', 'diagnostic_requested')
    .eq('app_user_id', session.app_user_id).eq('request->>helperInstanceId', owner.generation)
    .gte('created_at', new Date(Date.now() - 60_000).toISOString()).order('created_at').limit(1)
    .abortSignal(AbortSignal.timeout(5000));
  if (lookupError || !rows?.length || owner.busy()) return;
  await owner.assertOwned();
  const id = rows[0].id;
  const { data: claimed, error: claimError } = await db.from('praktika_helper_jobs')
    .update({ status: 'diagnostic_processing', attempts: 1, locked_at: new Date().toISOString(), locked_by: owner.generation })
    .eq('id', id).eq('status', 'diagnostic_requested').select('id').abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (claimError || !claimed) return;
  // Interruption leaves diagnostic_processing for inspection; never replay it.
  await owner.assertOwned();
  if (owner.busy()) return;
  const evidence = await probeSchedulerCandidate(context, praktikaHelperToken(owner.generation));
  await owner.assertOwned();
  console.log('[Praktika auth candidate] scheduler_probe', evidence);
  await db.from('praktika_helper_jobs').update({ status: 'diagnostic_completed', response: evidence,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'diagnostic_processing').eq('locked_by', owner.generation)
    .abortSignal(AbortSignal.timeout(5000));
}
