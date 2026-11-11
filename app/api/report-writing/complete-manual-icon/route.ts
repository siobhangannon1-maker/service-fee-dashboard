import { NextResponse } from 'next/server';
import { requireActiveApiUser, ApiAuthorizationError } from '@/lib/auth';
import { supabaseAdmin as db } from '@/lib/supabase/admin';
import { openResolutionPreview, sealResolutionPreview } from '@/lib/report-writing/workflow-resolution-server';
import { validWorkflowAuthorization } from '@/lib/report-writing/workflow-continuation-token';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(req: Request, confirm: boolean) {
  try {
    const {user}=await requireActiveApiUser(['typist','practice_manager','admin','super_admin']);
    const input=confirm ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);
    const draftId=String(input.draftId || '');
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(draftId) || (confirm && input.iconConfirmed!==true))
      return NextResponse.json({success:false,error:'Confirm the icon was updated manually for this approved letter.'},{status:400});
    const secret=process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const preview=confirm ? openResolutionPreview(String(input.preview || ''),secret) : null;
    if (preview && (preview.actorId!==user.id || preview.draftId!==draftId)) throw new Error('Invalid preview');
    const snapshotDeadline=AbortSignal.timeout(5000);
    const {data:s,error}=await db.rpc('inspect_manual_letter_icon',{p_draft_id:draftId,p_actor_user_id:user.id}).abortSignal(snapshotDeadline);
    if (error) {
      const timedOut=snapshotDeadline.aborted || error.code==='57014';
      console.warn('[manual-icon-check]',{stage:'snapshot',outcome:timedOut?'timeout':'unavailable'});
      return NextResponse.json({success:false,code:timedOut?'manual_icon_check_timeout':'manual_icon_check_unavailable',
        error:timedOut?'The workflow check timed out. No completion was requested.':'The workflow could not be checked.'},{status:503});
    }
    if (!s?.fingerprint || !s.parent?.app_user_id ||
      !validWorkflowAuthorization(draftId,s.parent.app_user_id,s.parent.request?.options,secret)) throw new Error('Unavailable contract');
    if (!confirm) {
      const med=s.mediref?.[0]?.result;
      return NextResponse.json({success:true,eligible:s.manualIconReady===true,
        reason:s.manualIconReady===true ? '' : 'Completion is blocked: check active jobs, the linked appointment and any unfinished PDF, MediRef or chart steps.',
        mediref:med?.sent===true?'sent':med?.prepared===true&&med?.sent===false?'prepared':'unverified',
        chart:s.parent.request?.options?.attachPeriodontalChart===true?'required':'not_required',
        preview:sealResolutionPreview({draftId,actorId:user.id,fingerprint:s.fingerprint,letterFingerprint:s.letterFingerprint,expiresAt:Date.now()+300000},secret)});
    }
    if (!preview || preview.letterFingerprint!==s.letterFingerprint) return NextResponse.json({success:false,error:'The letter changed. Check again.'},{status:409});
    // The locked RPC validates the original preview and acknowledges duplicate submissions atomically.
    const result=await db.rpc('confirm_manual_letter_icon',{p_draft_id:draftId,p_actor_user_id:user.id,
      p_fingerprint:preview.fingerprint,p_letter_fingerprint:preview.letterFingerprint,p_icon_confirmed:true}).abortSignal(AbortSignal.timeout(10000));
    if(result.error || !result.data?.ok) return NextResponse.json({success:false,error:'Completion could not be confirmed. Refresh the letter before trying again.'},{status:409});
    return NextResponse.json({success:true});
  } catch(error) {
    return NextResponse.json({success:false,error:'Manual icon completion is unavailable. Refresh the letter before continuing.'},
      {status:error instanceof ApiAuthorizationError?error.status:503});
  }
}
export const GET=(req:Request)=>handle(req,false);
export const POST=(req:Request)=>handle(req,true);
