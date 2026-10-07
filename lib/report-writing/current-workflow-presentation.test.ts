import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentWorkflowPresentation } from './workflow-recovery';
import { continuationIntentId, continuationChildId } from './workflow-continuation-token';
import { resolveWorkflow, type WorkflowEvidence } from './resolved-workflow';
import { typistApprovedPresentation } from './typist-mediref-presentation';
import { toDraftListItem, mergeDraftWorkflow, toDraftDetail } from './draft-contract';
const now = Date.now(), stamp = new Date(now - 1000).toISOString();
function fixture(stage='upload') {
 const draft={id:'synthetic',status:'approved'};
 const parent={id:continuationIntentId(draft.id),job_type:'complete_report_workflow',status:'waiting',app_user_id:'actor',created_at:stamp,
 request:{reportDraftId:draft.id,actorUserId:'actor',options:{attachPeriodontalChart:false}},response:{stage}};
 const evidence:WorkflowEvidence={parent,uploads:[],icons:[],mediref:[],livePraktikaActors:new Set(['actor']),liveMediref:true,
 currentUploadId:continuationChildId(parent.id,'upload_report_to_praktika'),currentIconId:continuationChildId(parent.id,'update_praktika_letter_icons')};
 const child=(type:string,status:string)=>({id:continuationChildId(parent.id,type as 'upload_report_to_praktika'),job_type:type,status,app_user_id:'actor',created_at:stamp,completed_at:status==='completed'?stamp:null,
 request:{reportDraftId:draft.id,continuationId:parent.id},response:type==='upload_report_to_praktika'?{patient_communication:{iFileId:123}}:{appointment_icon1id:6597,appointment_icon2id:0,appointment_icon3id:0,appointment_icon4id:0}});
 const project=()=>currentWorkflowPresentation(draft,evidence,resolveWorkflow(draft,evidence,now),false,now);
 return {draft,parent,evidence,child,project};
}
test('canonical waiting upload and active exact child have explicit amber presentation',()=>{
 const f=fixture();assert.equal(f.project(),'waiting_upload');
 f.evidence.uploads.push(f.child('upload_report_to_praktika','pending'));assert.equal(f.project(),'uploading');
});
for(const stage of ['icon','mediref'])test(`confirmed preceding branches permit waiting ${stage}`,()=>{
 const f=fixture(stage);f.evidence.uploads.push(f.child('upload_report_to_praktika','completed'));
 if(stage==='mediref')f.evidence.icons.push(f.child('update_praktika_letter_icons','completed'));
 assert.equal(f.project(),stage==='icon'?'waiting_icon':'waiting_mediref');
});
for(const reason of ['failed','stale','polling','conflict','noncanonical','mismatch','prerequisite','lookup','uncertain'])test(`${reason} does not create amber state`,()=>{
 const f=fixture();
 if(reason==='failed')f.parent.status='failed';
 if(reason==='stale'||reason==='polling'){f.parent.created_at=new Date(now-3600000).toISOString();Object.assign(f.parent,{updated_at:stamp});}
 if(reason==='conflict')f.evidence.hasOtherParent=true;
 if(reason==='noncanonical')f.parent.id='other';
 if(reason==='mismatch'){const j=f.child('upload_report_to_praktika','pending');j.request.continuationId='other';f.evidence.uploads.push(j);}
 if(reason==='prerequisite')Object.assign(f.draft,{periodontal_chart_attachment_error:'Chart unavailable'});
 if(reason==='uncertain')f.evidence.uploads.push(f.child('upload_report_to_praktika','failed'));
 const resolved=resolveWorkflow(f.draft,f.evidence,now);if(reason==='lookup')resolved.lookupUnavailable=true;
 assert.equal(currentWorkflowPresentation(f.draft,f.evidence,resolved,false,now),'unknown');
});
test('existing validated connection signal is mapped without inferring session state',()=>{
 const f=fixture();assert.equal(currentWorkflowPresentation(f.draft,f.evidence,resolveWorkflow(f.draft,f.evidence,now),true,now),'waiting_connection');
});
test('explicit projection survives list and merge; no resolver or input mutation',()=>{
 const f=fixture(),resolved=resolveWorkflow(f.draft,f.evidence,now),before=JSON.stringify(resolved);
 const item=toDraftListItem({...f.draft,provider_id:'p',workflow_resolved:resolved,workflow_current_presentation:f.project()},true);
 assert.equal(typistApprovedPresentation(item).label,'Completing… Waiting for upload');
 assert.equal(typistApprovedPresentation({...item,workflow_current_presentation:'unknown'}).label,'Needs attention');
 assert.equal(typistApprovedPresentation({...item,workflow_current_presentation:undefined,workflow_continuation_context:'present'}).label,'Needs attention');
 assert.equal(mergeDraftWorkflow(toDraftDetail({...f.draft,provider_id:'p'}),item).workflow_current_presentation,'waiting_upload');
 assert.equal(JSON.stringify(resolved),before);
});

test('projection uses exactly existing five reads including absent deterministic child lookup',async()=>{
 const { createClient } = await import('@supabase/supabase-js');
 const { projectWorkflowRecovery } = await import('./workflow-recovery');
 const f=fixture();let calls=0;
 const db=createClient('https://fixture.invalid','synthetic',{global:{fetch:async(input,init)=>{
  assert.equal(init?.method,'GET');calls++;const url=new URL(String(input));
  return Response.json(url.searchParams.get('job_type')==='eq.complete_report_workflow'?[f.parent]:[]);
 }}});
 const before=JSON.stringify(f.draft),[out]=await projectWorkflowRecovery(db,[Object.freeze(f.draft)]);
 assert.equal((out as typeof out & {workflow_current_presentation:string}).workflow_current_presentation,'waiting_upload');
 assert.equal(calls,5);assert.equal(JSON.stringify(f.draft),before);
});
for(const [state,label] of Object.entries({waiting_upload:'Waiting for upload',uploading:'Uploading to Praktika',waiting_icon:'Waiting for icon update',waiting_mediref:'Waiting for MediRef',waiting_connection:'Waiting for Praktika connection'}))test(`UI maps ${state} without modifying resolution`,()=>{
 const f=fixture(),r=resolveWorkflow(f.draft,f.evidence,now),before=JSON.stringify(r);
 const display=typistApprovedPresentation({...f.draft,workflow_resolved:r,workflow_current_presentation:state as 'waiting_upload'});
 assert.equal(display.tone,'amber');assert.equal(display.label,`Completing… ${label}`);assert.equal(display.message,null);assert.equal(JSON.stringify(r),before);
});

function queuedIcon(aged = true) {
 const f = fixture('icon');
 f.evidence.uploads.push(f.child('upload_report_to_praktika','completed'));
 const icon = f.child('update_praktika_letter_icons','pending');
 Object.assign(icon,{response:null,error_message:null});
 Object.assign(f.parent,{error_message:null});
 f.evidence.icons.push(icon);
 if (aged) for (const job of [f.parent,...f.evidence.uploads,...f.evidence.icons]) {
  job.created_at=new Date(now-3600000).toISOString();
  if ('completed_at' in job && job.completed_at) job.completed_at=job.created_at;
 }
 return {...f,icon};
}
for (const aged of [false,true]) test(`exact queued icon ${aged?'aged':'fresh'} preserves amber waiting without changing resolution`,()=>{
 const f=queuedIcon(aged),r=resolveWorkflow(f.draft,f.evidence,now),before=JSON.stringify({draft:f.draft,evidence:f.evidence,r});
 const state=f.project();assert.equal(state,aged?'waiting_icon_delayed':'waiting_icon');
 const item=toDraftListItem({...f.draft,workflow_resolved:r,workflow_current_presentation:state,workflow_continuation_context:'present'},true);
 const ui=typistApprovedPresentation(item);
 assert.equal(ui.tone,'amber');assert.equal(ui.label,'Completing… Waiting for icon update');
 assert.equal(ui.message,aged?'Taking longer than expected.':null);
 assert.equal(mergeDraftWorkflow(toDraftDetail(f.draft),item).workflow_current_presentation,state);
 assert.equal(JSON.stringify({draft:f.draft,evidence:f.evidence,r}),before);
});
for (const reason of ['failed_icon','uncertain','response','error','missing_error_evidence','conflict','replacement','manual_retry','processing','locked','missing_icon','failed_parent','parent_error','lookup','prerequisite','issue','noncanonical','wrong_link','future_timestamp','recovery']) test(`aged icon ${reason} retains fallback`,()=>{
 const f=queuedIcon();
 if(reason==='failed_icon'||reason==='uncertain')f.icon.status='failed';
 if(reason==='uncertain')Object.assign(f.icon,{error_message:'Outcome unconfirmed',response:{requestInvoked:true}});
 if(reason==='response')Object.assign(f.icon,{response:{success:false}});
 if(reason==='error')Object.assign(f.icon,{error_message:'Failure'});
 if(reason==='missing_error_evidence')Object.assign(f.icon,{error_message:undefined});
 if(reason==='conflict')f.evidence.icons.push({...f.icon,id:'other'});
 if(reason==='replacement')f.evidence.currentIconId='replacement';
 if(reason==='manual_retry')Object.assign(f.icon.request,{manualRetry:{priorJobId:'old'}});
 if(reason==='processing')f.icon.status='processing';
 if(reason==='locked')Object.assign(f.icon,{locked_by:'worker',locked_at:new Date(now-3600000).toISOString()});
 if(reason==='missing_icon')f.evidence.icons=[];
 if(reason==='failed_parent')f.parent.status='failed';
 if(reason==='parent_error')Object.assign(f.parent,{error_message:'Failure'});
 if(reason==='prerequisite')Object.assign(f.draft,{periodontal_chart_attachment_error:'Unavailable'});
 if(reason==='issue')Object.assign(f.parent.response,{issue:'account_unavailable'});
 if(reason==='noncanonical')f.parent.id='other';
 if(reason==='wrong_link')f.icon.request.continuationId='other';
 if(reason==='future_timestamp')f.icon.created_at=new Date(now+1000).toISOString();
 const resolved=resolveWorkflow(f.draft,f.evidence,now);if(reason==='lookup')resolved.lookupUnavailable=true;
 if(reason==='recovery')resolved.medirefRecovery=true;
 const state=currentWorkflowPresentation(f.draft,f.evidence,resolved,false,now);
 assert.equal(state,'unknown');
 const base={...f.draft,workflow_resolved:resolved};
 assert.deepEqual(typistApprovedPresentation({...base,workflow_current_presentation:state}),typistApprovedPresentation(base));
});
test('aged icon presentation preserves Approved membership, verification partition and recovery flags',async()=>{
 const {shouldAppearInApproved}=await import('./resolved-workflow');
 const {requiresWorkflowVerification}=await import('./typist-approved-partition');
 const f=queuedIcon(),r=resolveWorkflow(f.draft,f.evidence,now);
 const base={...f.draft,workflow_resolved:r,workflow_continuation_context:'present' as const};
 const shown={...base,workflow_current_presentation:f.project()};
 assert.equal(shouldAppearInApproved(base),true);assert.equal(shouldAppearInApproved(shown),true);
 assert.equal(requiresWorkflowVerification(toDraftListItem(base,true)),false);
 assert.equal(requiresWorkflowVerification(toDraftListItem(shown,true)),false);
 assert.deepEqual(resolveWorkflow(f.draft,f.evidence,now),r);
});
test('aged icon projection uses five existing GETs and includes authoritative error evidence',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const {projectWorkflowRecovery}=await import('./workflow-recovery');
 const f=queuedIcon();let calls=0;
 const db=createClient('https://fixture.invalid','synthetic',{global:{fetch:async(input,init)=>{
  assert.equal(init?.method,'GET');calls++;const url=new URL(String(input));
  if(url.pathname.endsWith('/praktika_helper_jobs')) {
   assert.ok(url.searchParams.get('select')?.includes('error_message'));
   return Response.json(url.searchParams.get('job_type')==='eq.complete_report_workflow'?[f.parent]:[...f.evidence.uploads,...f.evidence.icons]);
  }
  return Response.json([]);
 }}});
 const [out]=await projectWorkflowRecovery(db,[f.draft]);
 assert.equal((out as typeof out & {workflow_current_presentation:string}).workflow_current_presentation,'waiting_icon_delayed');
 assert.equal(calls,5);
});
