import type { SupabaseClient } from '@supabase/supabase-js';
import { continuationIntentId } from '../report-writing/workflow-continuation-token';

import { hasMedirefAcknowledgement, MedirefAcknowledgementError } from './manual-acknowledgement-contract';
export { hasMedirefAcknowledgement, MedirefAcknowledgementError, manuallyAcknowledgedMessage } from './manual-acknowledgement-contract';

export async function assertMedirefNotAcknowledged(db: SupabaseClient, draftId: string): Promise<void> {
  const { data, error } = await db.from('praktika_helper_jobs').select('response')
    .eq('id', continuationIntentId(draftId.toLowerCase())).eq('job_type', 'complete_report_workflow')
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (error) throw new Error('MediRef execution eligibility could not be checked.');
  if (hasMedirefAcknowledgement(data?.response)) throw new MedirefAcknowledgementError();
}
