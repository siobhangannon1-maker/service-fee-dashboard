import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveWorkflow,shouldAppearInApproved,type WorkflowEvidence,type WorkflowDraft} from './resolved-workflow';
import {manualHistoricalMedirefAction as action,manualHistoricalMedirefInvalidation as invalidation,manualHistoricalMedirefRelease as release,manualHistoricalMedirefContract as contract} from './manual-historical-mediref';
import {historicalEpoch} from './historical-reconciliation';
import {retentionPlan,retentionSettings} from './retention';
import {createClient} from '@supabase/supabase-js';
import {projectWorkflowRecovery} from './workflow-recovery';
const id='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const stamp='2026-08-01T00:00:00Z',now=Date.parse('2026-09-16T00:00:00Z');
function fixture(){
 const d:WorkflowDraft&{id:string}={id,status:'approved',created_at:stamp,workflow_status:'failed',workflow_mediref_status:'failed'};
 const details={eventId:id,draftId:id,epoch:historicalEpoch(d),contract,source:'human_external_verification',version:1,integration:'mediref',outcome:'completed',
  verifierUserId:actor,verifiedAt:stamp,importedAt:stamp,failedJobIds:[job],fingerprint:'a'.repeat(64),pdfFingerprint:'b'.repeat(64),workbookFingerprint:'c'.repeat(64),manifestFingerprint:'d'.repeat(64),historicalCompletedAt:null,
  otherBranches:{praktika:'completed',icon:'completed',periodontal:'skipped'}};
 const event={id,entity_id:id,action,details};
 const e:WorkflowEvidence={uploads:[],icons:[],mediref:[{id:job,status:'failed',job_type:'send_mediref_letter',payload:{draftId:id},result:null}],reconciliations:[event],livePraktikaActors:new Set(),liveMediref:false};
 return {d,e,event};
}
test('human verification completes only Mediref; failed job and human provenance preserved',()=>{
 const {d,e}=fixture(),before=JSON.stringify(e),r=resolveWorkflow(d,e,now);
 assert.equal(r.status,'completed');assert.equal(r.branches.mediref,'completed');assert.equal(JSON.stringify(e),before);
 assert.equal(r.historicalMedirefVerification?.source,'human_external_verification');assert.deepEqual(r.historicalMedirefVerification?.failedJobIds,[job]);
 assert.equal(shouldAppearInApproved({...d,workflow_resolved:r}),false);assert.equal(r.completedAt,null);assert.equal(r.historicalRetention?.released,false);
 assert.equal(retentionPlan({...d,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now),null);
});
for(const branch of ['praktika','periodontal','icon'] as const)test(`${branch} unresolved still appears in Approved`,()=>{
 const {d,e,event}=fixture();event.details.otherBranches[branch]='unknown';const r=resolveWorkflow(d,e,now);
 assert.equal(r.branches.mediref,'completed');assert.equal(r.status,'needs_attention');assert.equal(shouldAppearInApproved({...d,workflow_resolved:r}),true);
});
for(const change of ['epoch','new_parent','other_parent','new_med','changed_status','modern_med','invalidated','duplicate','system','wrong_contract','missing_jobs','forged_chart','fingerprint','future','actor'])test(`manual evidence guard ${change}`,()=>{
 const {d,e,event}=fixture();
 if(change==='epoch')d.provider_approved_at=stamp;
 if(change==='new_parent')e.parent={id:job,status:'waiting',job_type:'complete_report_workflow'};
 if(change==='other_parent')e.hasOtherParent=true;
 if(change==='new_med')e.mediref.push({...e.mediref[0],id:actor});
 if(change==='changed_status')e.mediref[0].status='completed';
 if(change==='modern_med')e.mediref[0].payload!.retryMediref=true;
 if(change==='invalidated')e.reconciliations!.push({...event,action:invalidation});
 if(change==='duplicate')e.reconciliations!.push({...event,id:actor});
 if(change==='system')e.reconciliations!.push({...event,action:'system_historical_reconciliation'});
 if(change==='wrong_contract')event.details.contract='wrong';
 if(change==='missing_jobs')e.mediref=[];
 if(change==='forged_chart')event.details.otherBranches.periodontal='completed';
 if(change==='fingerprint')event.details.fingerprint='bad';
 if(change==='future')event.details.importedAt='2099-01-01T00:00:00Z';
 if(change==='actor')event.details.verifierUserId='';
 assert.notEqual(resolveWorkflow(d,e,now).status,'completed');assert.equal(resolveWorkflow(d,e,now).historicalMedirefVerification,undefined);
});
test('two failed attempts remain two audited attempts',()=>{
 const {d,e,event}=fixture();event.details.failedJobIds.push(actor);e.mediref.push({...e.mediref[0],id:actor});
 assert.equal(resolveWorkflow(d,e,now).status,'completed');assert.equal(e.mediref.filter(j=>j.status==='failed').length,2);
});
test('separate release does not invent historical completion time or enable cleanup',()=>{
 const {d,e,event}=fixture();e.reconciliations!.push({id:actor,entity_id:id,action:release,details:{contract,source:'human_external_verification',epoch:event.details.epoch,verificationId:id,reviewReference:'separate-review',releasedAt:stamp}});
 const r=resolveWorkflow(d,e,now);assert.equal(r.historicalRetention?.released,true);assert.equal(r.completedAt,null);
 assert.equal(retentionPlan({...d,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now),null);
});
test('bounded runtime lookup includes manual provenance without historical reconstruction',async()=>{
 const {d,e,event}=fixture();let audited=false;
 const db=createClient('https://fixture.invalid','synthetic',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  assert.equal(init?.method,'GET');const u=new URL(String(input));
  if(u.pathname.endsWith('/report_writing_audit_events')){assert.ok(u.searchParams.get('action')?.includes(action));audited=true;return Response.json([event]);}
  if(u.pathname.endsWith('/mediref_helper_jobs'))return Response.json(e.mediref);
  return Response.json([]);
 }}});
 const [out]=await projectWorkflowRecovery(db,[d]);assert.ok(audited);assert.equal(out.workflow_resolved?.historicalMedirefVerification?.source,'human_external_verification');
});
