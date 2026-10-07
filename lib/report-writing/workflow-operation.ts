import { assertMedirefNotAcknowledged, MedirefAcknowledgementError } from '../mediref/manual-acknowledgement';
import 'server-only';
import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {sensitiveApiAccess} from '@/lib/auth';
import {supabaseAdmin} from '@/lib/supabase/admin';
import {currentWorkflowExecution} from './workflow-execution-context';
// The permit outlives request timeouts. Only a fully acknowledged successful
// request settles it; failures retain uncertainty rather than permitting replay.
export async function withWorkflowOperationRequest(req:Request,branch:string,route:string,run:()=>Promise<Response>) {
  const denied=currentWorkflowExecution()?null:await sensitiveApiAccess(route);
  if(denied)return denied;
  const input=await req.clone().json().catch(()=>null);
  const draftId=String(input?.draftId||'');
  if(!draftId)return run();
  if(branch==='mediref') {
    try { await assertMedirefNotAcknowledged(supabaseAdmin,draftId); }
    catch(error) { return NextResponse.json({success:false,code:error instanceof MedirefAcknowledgementError?'manually_acknowledged':'lookup_unavailable',error:'MediRef execution is fenced or cannot be verified.'},{status:409}); }
  }
  if(input.attachPeriodontalChart===true) {
    const chart=await supabaseAdmin.rpc('workflow_resolution_fenced',{p_draft_id:draftId,p_branch:'periodontal'});
    if(chart.error || chart.data===true)return NextResponse.json({success:false,error:'A verified attachment must be reused. This path cannot safely recreate it.'},{status:409});
  }
  const permit=randomUUID();
  const opened=await supabaseAdmin.rpc('begin_workflow_resolution_operation',{p_draft_id:draftId,p_branch:branch,p_permit_id:permit,p_resolution_event:currentWorkflowExecution()?.resolutionEventId || null});
  if(opened.error || !opened.data?.ok)return NextResponse.json({success:false,error:'Workflow execution is fenced or cannot be safely authorized.'},{status:409});
  const response=await run();
  {
    const body=await response.clone().json().catch(()=>null);
    const safePreInsertion=body?.insertionOutcome==='not_attempted' && body?.deadlineExceeded===false;
    const safeNoBrowserOperation=branch==='praktika' || branch==='icon';
    if(body?.success===true || safePreInsertion || safeNoBrowserOperation) {
      const settled=await supabaseAdmin.rpc('settle_workflow_resolution_operation',{p_draft_id:draftId,p_permit_id:permit});
      if(settled.error)return NextResponse.json({success:false,error:'Execution acknowledgement requires reconciliation. Do not repeat the operation.'},{status:503});
    }
  }
  return response;
}
