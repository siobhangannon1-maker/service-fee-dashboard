import {NextResponse} from 'next/server';
import {requireActiveApiUser,ApiAuthorizationError} from '@/lib/auth';
import {supabaseAdmin as db} from '@/lib/supabase/admin';
import {openResolutionPreview,sealResolutionPreview} from '@/lib/report-writing/workflow-resolution-server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(req:Request,confirm:boolean){
 try{
  const {user}=await requireActiveApiUser(['typist','practice_manager','admin','super_admin']);
  const input=confirm?await req.json():Object.fromEntries(new URL(req.url).searchParams);
  const draftId=String(input?.draftId||'');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(draftId)||(confirm&&input.allStepsConfirmed!==true))
   return NextResponse.json({success:false,error:'Confirm that all required workflow steps were completed manually or independently verified.'},{status:400});
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
  if(confirm){
   const preview=openResolutionPreview(String(input.preview||''),secret);
   if(preview.actorId!==user.id||preview.draftId!==draftId)return NextResponse.json({success:false,error:'Refresh the letter before continuing.'},{status:409});
   const {data,error}=await db.rpc('confirm_manual_workflow_completion',{p_draft_id:draftId,p_actor_user_id:user.id,
    p_fingerprint:preview.fingerprint,p_letter_fingerprint:preview.letterFingerprint,p_all_steps_confirmed:true}).abortSignal(AbortSignal.timeout(10000));
   if(error||!data?.ok)return NextResponse.json({success:false,error:'Completion could not be confirmed. Refresh the letter before trying again.'},{status:409});
   return NextResponse.json({success:true},{headers:{'Cache-Control':'private, no-store'}});
  }
  const deadline=AbortSignal.timeout(5000);
  const {data,error}=await db.rpc('inspect_manual_workflow_completion',{p_draft_id:draftId,p_actor_user_id:user.id}).abortSignal(deadline);
  if(error||!data?.fingerprint){
   const timedOut=deadline.aborted||error?.code==='57014';
   console.warn('[manual-workflow-check]',{outcome:timedOut?'timeout':'unavailable'});
   return NextResponse.json({success:false,code:timedOut?'manual_workflow_check_timeout':'manual_workflow_check_unavailable',error:'The workflow could not be checked.'},{status:503});
  }
  const reason=data.reasonCode==='already_resolved'?'This workflow has already been resolved. Refresh the list.':
   'External work is active or its execution state is uncertain. Finish or stop it safely before marking the workflow complete.';
  return NextResponse.json({success:true,eligible:data.eligible===true,reason:data.eligible===true?'':reason,
   preview:sealResolutionPreview({draftId,actorId:user.id,fingerprint:data.fingerprint,letterFingerprint:data.letterFingerprint,expiresAt:Date.now()+300000},secret)},
   {headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  return NextResponse.json({success:false,error:'Manual workflow completion is unavailable. Refresh the letter before continuing.'},
   {status:error instanceof ApiAuthorizationError?error.status:503});
 }
}
export const GET=(req:Request)=>handle(req,false);
export const POST=(req:Request)=>handle(req,true);
