import { NextResponse } from 'next/server';
import { requireActiveApiUser, ApiAuthorizationError } from '@/lib/auth';
import { getAuditActor } from '@/lib/report-writing/audit';
import { supabaseAdmin as db } from '@/lib/supabase/admin';
import { branches, deriveResolution, type ResolutionChoices } from '@/lib/report-writing/workflow-resolution';
import { sealResolutionPreview,openResolutionPreview,resolutionSnapshot } from '@/lib/report-writing/workflow-resolution-server';
import { workflowAuthorization, validWorkflowAuthorization } from '@/lib/report-writing/workflow-continuation-token';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(req:Request,confirm:boolean) {
  try {
    const {user}=await requireActiveApiUser(['typist','practice_manager','admin','super_admin']);
    const input=confirm ? await req.json() : Object.fromEntries(new URL(req.url).searchParams);
    const draftId=String(input.draftId || '');
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(draftId)) return NextResponse.json({success:false,error:'Invalid letter.'},{status:400});
    const secret=process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const preview=confirm ? openResolutionPreview(String(input.preview || ''),secret) : null;
    if (preview && (preview.actorId!==user.id || preview.draftId!==draftId)) throw new Error('Preview changed.');
    const {data,error}=await db.rpc('workflow_resolution_snapshot',{p_draft_id:draftId,p_actor_user_id:user.id}).abortSignal(AbortSignal.timeout(5000));
    if(error || !data?.fingerprint) throw new Error('Authoritative state unavailable.');
    const state=resolutionSnapshot(data);
    if(state.evidence.parent && (!state.evidence.parent.app_user_id || !validWorkflowAuthorization(draftId,state.evidence.parent.app_user_id,state.evidence.parent.request?.options as Record<string,unknown>,secret))) {state.executionSafe=false;state.reason='The canonical signed workflow contract could not be validated.';}
    if(preview && (preview.fingerprint!==state.fingerprint || preview.letterFingerprint!==state.letterFingerprint)) return NextResponse.json({success:false,error:'The letter or workflow changed. Check again before confirming.'},{status:409});
    const choices:ResolutionChoices={};
    if(confirm) {
      if(!input.choices || typeof input.choices!=='object' || Array.isArray(input.choices) || Object.keys(input.choices).some(k=>!branches.includes(k as typeof branches[number]))) return NextResponse.json({success:false,error:'Invalid verification choices.'},{status:400});
      for(const branch of branches) if(input.choices[branch]!==undefined) {
        if(!['completed','incomplete'].includes(input.choices[branch])) return NextResponse.json({success:false,error:'Explicit external verification is required.'},{status:400});
        choices[branch]=input.choices[branch];
      }
    }
    const decision=deriveResolution(state,choices);
    if(!confirm || input.review===true) return NextResponse.json({success:true,...decision,preview:sealResolutionPreview({draftId,actorId:user.id,fingerprint:state.fingerprint,letterFingerprint:state.letterFingerprint,expiresAt:Date.now()+300000},secret)});
    if(!decision.eligible || !decision.action || input.action!==decision.action) return NextResponse.json({success:false,error:decision.reason || 'Classify all unresolved required work before confirming.'},{status:409});
    const parent=state.evidence.parent;
    let options=parent?.request?.options as Record<string,unknown> | undefined;
    if(decision.action==='resume' && parent && (!parent.app_user_id || !options || !validWorkflowAuthorization(draftId,parent.app_user_id,options,secret))) return NextResponse.json({success:false,error:'The signed recovery contract cannot be validated.'},{status:409});
    const actor=await getAuditActor();
    if(actor.actorUserId!==user.id) throw new Error('Audit account changed.');
    if(decision.action==='resume' && !parent) {
      const payload={actor,praktikaPatientId:state.draft.praktika_patient_id,attachPeriodontalChart:false};
      options={...payload,authorization:workflowAuthorization(draftId,user.id,payload,secret)};
    }
    const result=await db.rpc('confirm_workflow_resolution',{p_draft_id:draftId,p_actor_user_id:user.id,p_expected_fingerprint:state.fingerprint,
      p_letter_fingerprint:state.letterFingerprint,p_outcomes:decision.outcomes,p_required:decision.rows.filter(r=>r.required).map(r=>r.branch),
      p_action:decision.action,p_plan:decision.plan,p_options:options || null,p_completed:decision.rows.filter(r=>r.automated==='completed').map(r=>r.branch)}).abortSignal(AbortSignal.timeout(10000));
    if(result.error || !result.data?.ok) return NextResponse.json({success:false,error:'Confirmation could not be acknowledged. Reconcile the letter before trying again.'},{status:409});
    return NextResponse.json({success:true,...result.data});
  } catch(error) {
    return NextResponse.json({success:false,error:error instanceof ApiAuthorizationError ? 'An active authorized account is required.' : 'Workflow resolution is unavailable. Check again before confirming.'},{status:error instanceof ApiAuthorizationError ? error.status : 503});
  }
}
export const GET=(req:Request)=>handle(req,false);
export const POST=(req:Request)=>handle(req,true);
