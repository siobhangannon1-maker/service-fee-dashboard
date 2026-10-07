import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {continuationChildId} from './workflow-continuation-token';
import {isConfirmedPraktikaIcon} from './praktika-icon-result';
import {isConfirmedPraktikaUpload} from './praktika-upload-result';
import {withWorkflowExecution} from './workflow-execution-context';
import type {AuditActor} from './audit';
type Parent={id:string;app_user_id:string;request:{reportDraftId:string;options:Record<string,unknown>&{actor:AuditActor}};response:Record<string,unknown>};
export async function continueResolvedWorkflow(db:SupabaseClient,intent:Parent,lock:string,url:string,handlers:Record<'praktika'|'icon'|'mediref',(req:Request)=>Promise<Response>>) {
  const resolution=intent.response.resolution as {eventId?:string};
  const {data:event,error}=await db.from('report_writing_audit_events').select('id,action,entity_id,details').eq('id',resolution.eventId).single();
  if(error || event?.action!=='workflow_resolution_resume' || event.entity_id!==intent.request.reportDraftId || event.details?.contract!=='workflow-resolution-v1')throw new Error('Recovery plan unavailable.');
  const plan=event.details.plan as string[];
  if(!Array.isArray(plan)||!plan.length||plan.some(b=>!['praktika','icon','mediref'].includes(b)))throw new Error('Unsupported recovery plan.');
  const draftId=intent.request.reportDraftId;
  async function finish(status:string,message:string) {
    const updated=await db.from('praktika_helper_jobs').update({status,locked_by:null,locked_at:null,
      response:{...intent.response,dispatched:false},...(status==='failed'?{failed_at:new Date().toISOString()}:{}),updated_at:new Date().toISOString()}).eq('id',intent.id).eq('locked_by',lock).select('id').maybeSingle();
    if(updated.error||!updated.data)throw new Error('Recovery acknowledgement unavailable.');
    await db.rpc('settle_workflow_resolution_execution',{p_draft_id:draftId,p_job_id:intent.id,p_owner:lock,p_safe_before_execution:true});
    await db.from('report_drafts').update({workflow_last_message:message,...(status==='failed'?{workflow_status:'failed'}:{}),updated_at:new Date().toISOString()}).eq('id',draftId);
    return Response.json({success:status!=='failed',pending:status==='waiting'});
  }
  for(const branch of ['praktika','icon','mediref'] as const) {
    if(!plan.includes(branch))continue;
    const med=branch==='mediref';
    const type=branch==='praktika'?'upload_report_to_praktika':'update_praktika_letter_icons';
    const query=med?db.from('mediref_helper_jobs').select('id,status,result').eq('payload->>draftId',draftId):db.from('praktika_helper_jobs').select('id,status,response').eq('id',continuationChildId(intent.id,type));
    const {data:jobs,error:lookupError}=await query;
    if(lookupError || (jobs?.length||0)>1)throw new Error('Recovery attempt lookup unavailable.');
    const job=jobs?.[0];
    if(job) {
      if(job.status==='failed')return finish('failed','A resumed step requires reconciliation. No duplicate attempt was created.');
      if(job.status!=='completed')return finish('waiting','Verified incomplete work is queued. Waiting for its exact helper result.');
      const result='result' in job?job.result:job.response;
      const valid=branch==='praktika'?isConfirmedPraktikaUpload(result):result&&typeof result==='object'&&!(result as Record<string,unknown>).error&&(result as Record<string,unknown>).success!==false&&(med?(result as Record<string,unknown>).prepared===true:isConfirmedPraktikaIcon(result));
      if(!valid)return finish('failed','The resumed helper result requires reconciliation. No duplicate attempt was created.');
      continue;
    }
    const response=await withWorkflowExecution({intentId:intent.id,draftId,actor:intent.request.options.actor,resolutionEventId:event.id},()=>handlers[branch](new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...intent.request.options,draftId})})));
    const body=await response.json().catch(()=>null);
    if(!response.ok || body?.success!==true)return finish('failed','Resumed preparation needs attention. Review the retained evidence in Resolve workflow.');
    return finish('waiting','Verified incomplete work was queued through the existing helper architecture.');
  }
  const completed=await db.rpc('complete_resolved_workflow',{p_draft_id:draftId,p_parent_id:intent.id,p_owner:lock});
  if(completed.error || !completed.data?.ok)throw new Error('Resumed workflow completion requires reconciliation.');
  return Response.json({success:true,pending:false});
}
