import { isConfirmedPraktikaUpload } from "@/lib/report-writing/praktika-upload-result";
import { NextResponse } from 'next/server';
import { supabaseAdmin as db } from '@/lib/supabase/admin';
import { validContinuationToken, continuationChildId, validWorkflowAuthorization } from '@/lib/report-writing/workflow-continuation-token';
import { withWorkflowExecution } from '@/lib/report-writing/workflow-execution-context';
import { isUserPraktikaReady } from '@/lib/report-writing/praktika-readiness';
import { workflowAccountState, workflowAccountMessage } from '@/lib/report-writing/workflow-recovery';
import { POST as upload } from '../upload-to-praktika/route';
import { POST as icon } from '../update-praktika-letter-icons/route';
import { POST as mediref } from '../send-via-mediref/route';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const intentId = body?.intentId;
  const lock = body?.lock;
  if (typeof intentId !== 'string' || typeof lock !== 'string' || !validContinuationToken(
    req.headers.get('X-Workflow-Token') || '', intentId, lock, process.env.SUPABASE_SERVICE_ROLE_KEY || '')) {
    return NextResponse.json({ success: false }, { status: 403 });
  }
  const { data: intent, error } = await db.from('praktika_helper_jobs').select('*').eq('id', intentId)
    .eq('job_type', 'complete_report_workflow').eq('status', 'processing').eq('locked_by', lock).single();
  if (error || !intent || intent.request?.actorUserId !== intent.app_user_id
    || intent.request?.options?.actor?.actorUserId !== intent.app_user_id) return NextResponse.json({ success: false }, { status: 409 });
  if (!validWorkflowAuthorization(intent.request.reportDraftId, intent.app_user_id, intent.request.options, process.env.SUPABASE_SERVICE_ROLE_KEY || '')) {
    return NextResponse.json({ success: false }, { status: 403 });
  }
  const stage = intent.response?.stage;
  if (!['upload', 'icon', 'mediref'].includes(stage)) return NextResponse.json({ success: false }, { status: 409 });
  // Consume this dispatch token exactly once, even if the HTTP call is duplicated.
  const { data: dispatched, error: dispatchError } = await db.from('praktika_helper_jobs')
    .update({ response: { stage, dispatched: true } }).eq('id', intentId).eq('locked_by', lock)
    .eq('response->>dispatched', 'false').select('id').maybeSingle();
  if (dispatchError || !dispatched) return NextResponse.json({ success: true, pending: true });
  const draftId = intent.request.reportDraftId;
  async function finish(status: string, nextStage = stage, message?: string, issue?: string) {
    if (status === 'failed' && !message) message = 'Workflow needs reconciliation. The approved letter and intent are retained.';
    const { data: finished, error: finishError } = await db.from('praktika_helper_jobs').update({
      status, response: { stage: nextStage, ...(issue ? { issue } : {}) }, locked_by: null, locked_at: null,
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      ...(status === 'failed' ? { error_message: 'Workflow needs reconciliation.', failed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', intentId).eq('locked_by', lock).select('id').maybeSingle();
    if (finishError || !finished) throw new Error('Could not save continuation state.');
    if (message) await db.from('report_drafts').update({ workflow_last_message: message,
      ...(status === 'failed' ? { workflow_status: 'failed', workflow_error: message } : status === 'waiting' ? { workflow_status: 'running', workflow_error: null } : {}),
      updated_at: new Date().toISOString() }).eq('id', draftId);
    return NextResponse.json({ success: status !== 'failed', pending: status === 'waiting' });
  }
  try {
    const account = await workflowAccountState(db, intent.app_user_id);
    if (account === 'unavailable') return await finish('waiting', stage, workflowAccountMessage, 'account_unavailable');
    if (account === 'inactive') return await finish('failed', stage, 'An active staff account is required. Queued work is retained.');
    const { data: draft, error: draftError } = await db.from('report_drafts').select('*').eq('id', draftId).is('deleted_at', null).single();
    if (draftError || !draft || !['approved', 'uploaded_to_praktika'].includes(draft.status)) return await finish('failed');
    // Independent branch: use the existing preparation/claim path and reconcile
    // every helper status before considering another insertion (including legacy intents).
    const options = intent.request.options;
    const findMediref = () => db.from('mediref_helper_jobs').select('id,status')
      .eq('job_type', 'send_mediref_letter').eq('payload->>draftId', draftId).limit(1);
    let { data: medirefJobs, error: medirefError } = await findMediref();
    if (medirefError) throw new Error('MediRef lookup unavailable.');
    let perioWaiting = false;
    if (!medirefJobs?.length && draft.workflow_mediref_status !== 'completed') {
      const prepared = await withWorkflowExecution<Response>({ intentId, actor: options.actor }, () => mediref(new Request(req.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...options, draftId }),
      })));
      const preparedResult = await prepared.json();
      const lookup = await findMediref();
      if (lookup.error) throw new Error('MediRef enqueue acknowledgement unavailable.');
      medirefJobs = lookup.data;
      if (!medirefJobs?.length) {
        if (preparedResult.stage === 'periodontal_preparation' && preparedResult.insertionOutcome === 'not_attempted') {
          perioWaiting = true;
          await db.from('report_drafts').update({ workflow_status: 'running', workflow_error: null,
            workflow_mediref_status: 'waiting_for_periodontal', workflow_last_message: 'MediRef is waiting for the requested periodontal chart.' }).eq('id', draftId);
        } else return await finish('failed', stage, 'MediRef preparation needs reconciliation. No replacement job was created.');
      }
    }
    if (medirefJobs?.some(job => job.status === 'failed')) return await finish('failed', stage, 'MediRef needs reconciliation. No duplicate job was created.');
    // Re-read because MediRef can finish concurrently. Do not overwrite its step state.
    const { data: progress, error: progressError } = await db.from('report_drafts').select('workflow_mediref_status').eq('id', draftId).single();
    if (progressError) throw new Error('Workflow progress unavailable.');
    const medirefComplete = progress?.workflow_mediref_status === 'completed';
    const praktikaStep = stage === 'icon' ? 'icon update' : 'upload';
    const waitingMessage = perioWaiting ? 'MediRef is waiting for the requested periodontal chart.'
      : medirefComplete ? `MediRef prepared. Praktika ${praktikaStep} is waiting for session verification and will continue automatically.`
      : `MediRef preparation is underway. Praktika session refreshing — Praktika ${praktikaStep} queued.`;
    if (stage !== 'upload' || draft.uploaded_to_praktika) {
      const { data: confirmed, error: confirmationError } = await db.from('praktika_helper_jobs').select('status,response')
        .eq('id', continuationChildId(intentId, 'upload_report_to_praktika')).eq('app_user_id', intent.app_user_id)
        .eq('request->>continuationId', intentId).maybeSingle();
      if (confirmationError) throw new Error('Confirmation lookup unavailable.');
      if (confirmed?.status !== 'completed' || !isConfirmedPraktikaUpload(confirmed.response)) return await finish('failed');
    }
    if (stage === 'upload' && draft.uploaded_to_praktika && draft.workflow_praktika_upload_status === 'completed') return await finish('waiting', 'icon');
    if (stage === 'icon' && ['completed', 'skipped'].includes(draft.workflow_icon_update_status)) return await finish('waiting', 'mediref');
    if (stage !== 'upload' && (!draft.uploaded_to_praktika || draft.workflow_praktika_upload_status !== 'completed')) return await finish('failed');
    if (stage === 'mediref' && !['completed', 'skipped'].includes(draft.workflow_icon_update_status)) return await finish('failed');
    if (stage === 'mediref') {
      if (!medirefComplete) return await finish('waiting', stage,
        perioWaiting ? 'MediRef is waiting for the requested periodontal chart.' : 'Praktika steps complete. Waiting for MediRef preparation.',
        perioWaiting ? 'periodontal_unavailable' : undefined);
      const { error: completeError } = await db.from('report_drafts').update({ workflow_status: 'completed',
        workflow_completed_at: new Date().toISOString(), workflow_error: null,
        workflow_last_message: 'All required workflow steps completed.' }).eq('id', draftId)
        .eq('workflow_praktika_upload_status', 'completed').in('workflow_icon_update_status', ['completed', 'skipped'])
        .eq('workflow_mediref_status', 'completed');
      if (completeError) throw new Error('Workflow completion unavailable.');
      return await finish('completed');
    } else {
      const jobType = stage === 'upload' ? 'upload_report_to_praktika' : 'update_praktika_letter_icons';
      const { data: child, error: childError } = await db.from('praktika_helper_jobs').select('status,locked_at,response')
        .eq('id', continuationChildId(intentId, jobType)).maybeSingle();
      if (childError) throw new Error('Helper lookup unavailable.');
      if (child?.status === 'completed' && (stage === 'upload' ? !isConfirmedPraktikaUpload(child.response)
        : !child.response || typeof child.response !== 'object' || child.response.error || child.response.success === false || child.response.empty === true)) {
        return await finish('failed', stage, 'The Praktika result could not be confirmed. Reconciliation is required.');
      }
      if (child?.status === 'failed' || (child?.status === 'processing' && Date.parse(child.locked_at || '') < Date.now() - 300_000)) {
        return await finish('failed', stage, 'External outcome needs reconciliation. The approved letter and queued intent are retained.');
      }
      if (child?.status === 'processing' || child?.status === 'pending') return await finish('waiting', stage,
        perioWaiting ? 'MediRef is waiting for the requested periodontal chart.' : 'Waiting for the confirmed Praktika result. Independent MediRef preparation continues.',
        perioWaiting ? 'periodontal_unavailable' : undefined);
    }
    if (!await isUserPraktikaReady(db, intent.app_user_id)) return await finish('waiting', stage, waitingMessage, perioWaiting ? 'periodontal_unavailable' : undefined);
    const handler = stage === 'upload' ? upload : icon;
    const response = await withWorkflowExecution<Response>({ intentId, actor: options.actor }, () => handler(new Request(req.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...options, draftId }),
    })));
    const result = await response.json();
    if (response.ok && result.success) return await finish('waiting', stage === 'upload' ? 'icon' : 'mediref');
    // A queued helper can outlive the route's bounded wait. Reconcile its exact ID;
    // never insert a replacement or infer external success from HTTP alone.
    if (stage !== 'mediref') {
      const jobType = stage === 'upload' ? 'upload_report_to_praktika' : 'update_praktika_letter_icons';
      const { data: child } = await db.from('praktika_helper_jobs').select('status')
        .eq('id', continuationChildId(intentId, jobType)).maybeSingle();
      if (stage === 'icon' && child?.status === 'completed') return await finish('failed', stage, 'The completed icon target or result needs reconciliation. No new icon action was created.');
      if (child && ['pending', 'processing', 'completed'].includes(child.status)) {
        await db.from('report_drafts').update({ workflow_status: 'running', workflow_error: null,
          ...(stage === 'upload' ? { workflow_praktika_upload_status: 'waiting_for_authentication' } : {}),
        }).eq('id', draftId);
        return await finish('waiting', stage, 'Waiting for the confirmed Praktika result. This workflow will continue automatically.');
      }
    }
    return await finish('failed', stage, 'Workflow preparation needs attention. The approved letter and intent are retained.');
  } catch {
    // Retain processing + stage on DB/transport uncertainty for later reconciliation.
    return NextResponse.json({ success: false, pending: true }, { status: 503 });
  }
}
