import { NextResponse } from 'next/server';
import { sensitiveApiAccess } from '@/lib/auth';
import { getAuditActor } from '@/lib/report-writing/audit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { continuationIntentId, validWorkflowAuthorization, workflowConfigurationIssue } from '@/lib/report-writing/workflow-continuation-token';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const denied = await sensitiveApiAccess('/api/report-writing/retry-praktika');
  if (denied) return denied;
  try {
    const body = await req.json();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(body.draftId || '') || !uuid.test(body.priorJobId || '') || body.verifiedAbsent !== true)
      return NextResponse.json({ success: false, error: 'Confirm that you checked Praktika and the letter is absent.' }, { status: 400 });
    const actor = await getAuditActor();
    const { data: intent, error } = await supabaseAdmin.from('praktika_helper_jobs').select('app_user_id,request')
      .eq('id', continuationIntentId(body.draftId)).eq('job_type', 'complete_report_workflow')
      .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (error) throw new Error();
    if (!actor.actorUserId || intent?.app_user_id !== actor.actorUserId || !validWorkflowAuthorization(
      body.draftId, actor.actorUserId, intent.request?.options, process.env.SUPABASE_SERVICE_ROLE_KEY || ''))
      return NextResponse.json({ success: false, error: 'Only the active user who started this workflow can authorize its retry.' }, { status: 403 });
    if (workflowConfigurationIssue()) return NextResponse.json({ success: false, error: 'Workflow continuation is not configured.' }, { status: 503 });
    const { data, error: reservationError } = await supabaseAdmin.rpc('reserve_praktika_upload_retry', {
      p_draft_id: body.draftId, p_prior_job_id: body.priorJobId, p_actor_user_id: actor.actorUserId,
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
  const denied = await sensitiveApiAccess('/api/report-writing/retry-praktika');
  if (denied) return denied;
  try {
    const draftId = new URL(req.url).searchParams.get('draftId') || '';
    const actor = await getAuditActor();
    const { data: parent, error } = await supabaseAdmin.from('praktika_helper_jobs').select('id,status,app_user_id,response,request')
      .eq('id', continuationIntentId(draftId)).eq('job_type', 'complete_report_workflow').abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (error) throw new Error();
    if (!actor.actorUserId || parent?.app_user_id !== actor.actorUserId || parent.status !== 'failed' || parent.response?.stage !== 'upload')
      return NextResponse.json({ eligible: false });
    const { data: jobs, error: jobsError } = await supabaseAdmin.from('praktika_helper_jobs').select('id,status,request')
      .eq('job_type', 'upload_report_to_praktika').eq('request->>reportDraftId', draftId).abortSignal(AbortSignal.timeout(5000));
    if (jobsError) throw new Error();
    const current = parent.response?.retryUploadId ? jobs?.find(j => j.id === parent.response.retryUploadId) : jobs?.length === 1 ? jobs[0] : null;
    const { data: draft, error: draftError } = await supabaseAdmin.from('report_drafts').select('status,deleted_at,uploaded_to_praktika')
      .eq('id', draftId).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
    if (draftError) throw new Error();
    const eligible = draft?.status === 'approved' && !draft.deleted_at && !draft.uploaded_to_praktika
      && current?.status === 'failed' && current.request?.continuationId === parent.id
      && jobs?.every(j => j.status === 'failed');
    return NextResponse.json({ eligible: Boolean(eligible), ...(eligible ? { priorJobId: current!.id } : {}) });
  } catch { return NextResponse.json({ eligible: false }, { status: 503 }); }
}
