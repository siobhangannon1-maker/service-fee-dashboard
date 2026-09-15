import { NextResponse } from 'next/server';
import { ApiAuthorizationError, requireActiveApiUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { continuationIntentId, validWorkflowAuthorization, workflowConfigurationIssue } from '@/lib/report-writing/workflow-continuation-token';
export const runtime = 'nodejs';
// Both endpoints derive role, actor and provider from server-side records only.
async function retryAccess() {
  try {
    const { user } = await requireActiveApiUser(['admin', 'super_admin', 'practice_manager', 'typist']);
    return { actorId: user.id, denied: null };
  } catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 403;
    const reason = status === 401 ? 'unauthenticated'
      : error instanceof ApiAuthorizationError && error.message === 'An active account is required.' ? 'inactive_user' : 'unauthorized_for_provider';
    return { actorId: null, denied: NextResponse.json({ eligible: false, success: false, reason,
      error: status === 401 ? 'Authentication required.' : 'An active authorized Typist account is required.' }, { status }) };
  }
}
async function retryDraft(draftId: string) {
  const { data: draft, error } = await supabaseAdmin.from('report_drafts')
    .select('status,deleted_at,uploaded_to_praktika,provider_id').eq('id', draftId)
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (error) throw new Error();
  if (!draft) return { draft: null, providerActive: false };
  const { data: provider, error: providerError } = await supabaseAdmin.from('providers')
    .select('id').eq('id', draft.provider_id).eq('is_active', true)
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (providerError) throw new Error();
  return { draft, providerActive: Boolean(provider) };
}
export async function POST(req: Request) {
  const { actorId, denied } = await retryAccess();
  if (denied) return denied;
  try {
    const body = await req.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(body.draftId || '') || !uuid.test(body.priorJobId || '') || body.verifiedAbsent !== true)
      return NextResponse.json({ success: false, error: 'Confirm that you checked Praktika and the letter is absent.' }, { status: 400 });
    const { draft, providerActive } = await retryDraft(body.draftId);
    if (!draft || !providerActive) return NextResponse.json({ success: false, reason: 'unauthorized_for_provider',
      error: 'You do not have permission to retry Praktika for this provider.' }, { status: 403 });
    const { data: intent, error } = await supabaseAdmin.from('praktika_helper_jobs').select('app_user_id,request')
      .eq('id', continuationIntentId(body.draftId)).eq('job_type', 'complete_report_workflow')
      .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (error) throw new Error();
    if (!intent?.app_user_id || !validWorkflowAuthorization(
      body.draftId, intent.app_user_id, intent.request?.options, process.env.SUPABASE_SERVICE_ROLE_KEY || ''))
      return NextResponse.json({ success: false, error: 'Workflow authorization could not be verified.' }, { status: 403 });
    if (workflowConfigurationIssue()) return NextResponse.json({ success: false, error: 'Workflow continuation is not configured.' }, { status: 503 });
    const { data, error: reservationError } = await supabaseAdmin.rpc('reserve_praktika_upload_retry', {
      p_draft_id: body.draftId, p_prior_job_id: body.priorJobId, p_actor_user_id: actorId,
    }).abortSignal(AbortSignal.timeout(5000));
    if (reservationError) throw new Error();
    if (!data?.ok) return NextResponse.json({ success: false, error: 'This attempt cannot be retried. Refresh to check the current workflow.' }, { status: 409 });
    return NextResponse.json({ success: true, accepted: true, ...data }, { status: 202 });
  } catch {
    return NextResponse.json({ success: false, error: 'Retry acknowledgement is unavailable. Refresh and confirm the same attempt again; any existing replacement will be reconciled.' }, { status: 503 });
  }
}

// Eligibility is advisory; POST/RPC revalidate under the draft lock.
export async function GET(req: Request) {
  const { denied } = await retryAccess();
  if (denied) return denied;
  try {
    const draftId = new URL(req.url).searchParams.get('draftId') || '';
    const { draft, providerActive } = await retryDraft(draftId);
    if (!draft) return NextResponse.json({ eligible: false, reason: 'invalid_state' });
    if (!providerActive) return NextResponse.json({ eligible: false, reason: 'unauthorized_for_provider' }, { status: 403 });
    const { data: parent, error } = await supabaseAdmin.from('praktika_helper_jobs').select('id,status,app_user_id,response,request')
      .eq('id', continuationIntentId(draftId)).eq('job_type', 'complete_report_workflow').abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (error) throw new Error();
    if (!parent) return NextResponse.json({ eligible: false, reason: 'invalid_state' });
    const { data: jobs, error: jobsError } = await supabaseAdmin.from('praktika_helper_jobs').select('id,status,request')
      .eq('job_type', 'upload_report_to_praktika').eq('request->>reportDraftId', draftId).abortSignal(AbortSignal.timeout(5000));
    if (jobsError) throw new Error();
    const current = parent.response?.retryUploadId ? jobs?.find(j => j.id === parent.response.retryUploadId) : jobs?.length === 1 ? jobs[0] : null;
    if (jobs?.some(j => ['waiting', 'pending', 'processing', 'running'].includes(j.status)))
      return NextResponse.json({ eligible: false, reason: 'replacement_active' });
    if (parent.status !== 'failed') return NextResponse.json({ eligible: false, reason: 'workflow_not_terminal' });
    if (parent.response?.stage !== 'upload') return NextResponse.json({ eligible: false, reason: 'invalid_state' });
    if (current && current.status !== 'failed') return NextResponse.json({ eligible: false, reason: 'upload_not_failed' });
    const eligible = draft?.status === 'approved' && !draft.deleted_at && !draft.uploaded_to_praktika
      && current?.status === 'failed' && current.request?.continuationId === parent.id
      && jobs?.every(j => j.status === 'failed');
    return NextResponse.json({ eligible: Boolean(eligible), reason: eligible ? 'eligible' : 'invalid_state', ...(eligible ? { priorJobId: current!.id } : {}) });
  } catch { return NextResponse.json({ eligible: false, reason: 'lookup_unavailable' }, { status: 503 }); }
}
