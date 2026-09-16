import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolveWorkflow,shouldAppearInApproved,type WorkflowDraft,type WorkflowEvidence} from './resolved-workflow';
import {historicalEpoch,historicalReconciliationAction,historicalInvalidationAction,historicalRetentionReleaseAction} from './historical-reconciliation';
import {retentionPlan,retentionSettings} from './retention';
import {historicalCleanupExcluded,retentionImpact} from './historical-cleanup-manifest';
import {createClient} from '@supabase/supabase-js';
import {projectWorkflowRecovery} from './workflow-recovery';
const stamp='2026-01-01T00:00:00.123456+00:00',now=Date.parse('2026-09-16T00:00:00Z');
function fixture(){
 const d:WorkflowDraft&{id:string}={id:'fixture',created_at:stamp,status:'approved',workflow_status:'completed'};
 const event={id:'event',entity_id:d.id,action:historicalReconciliationAction,details:{eventId:'event',draftId:d.id,epoch:historicalEpoch(d),source:'controlled_historical_cleanup',contract:'historical-v1',reconciliationVersion:1,reconciledAt:'2026-09-16T00:00:00Z',historicalCompletedAt:stamp,
 branches:{praktika:{outcome:'completed',basis:'system_verified_historical_completion',jobId:'upload',auditId:'audit'},mediref:{outcome:'completed',jobId:'med'},icon:{outcome:'completed',jobId:'icon'},periodontal:{outcome:'skipped'}}}};
 const e:WorkflowEvidence={uploads:[],icons:[],mediref:[],livePraktikaActors:new Set(),liveMediref:false,reconciliations:[event]};return {d,e,event};
}
test('durable branch evidence completes without historical reconstruction and preserves historical time',()=>{
 const {d,e}=fixture();const r=resolveWorkflow(d,e,now);assert.equal(r.status,'completed');assert.equal(r.completedAt,Date.parse(stamp));
 assert.equal(shouldAppearInApproved({...d,workflow_resolved:r}),false);
 assert.equal(r.historicalRetention?.released,false);
 assert.equal(retentionPlan({...d,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now),null);
});
test('separate release restores historical-date retention without changing completion or ordinary workflows',()=>{
 const {d,e,event}=fixture();
 e.reconciliations!.push({id:'release',entity_id:d.id,action:historicalRetentionReleaseAction,details:{source:'controlled_historical_cleanup',
  contract:'historical-v1',epoch:event.details.epoch,reconciliationId:event.id,reason:'verified_historical_cleanup',reviewReference:'review-1',releasedAt:new Date(now).toISOString()}});
 const r=resolveWorkflow(d,e,now);assert.equal(r.historicalRetention?.released,true);assert.equal(r.completedAt,Date.parse(stamp));
 assert.ok(retentionPlan({...d,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now));
 e.reconciliations!.push({...event,id:'invalid',action:historicalInvalidationAction});
 assert.notEqual(resolveWorkflow(d,e,now).status,'completed');
});
for(const defect of ['other_epoch','other_completion','future','malformed','duplicate'])test(`release cannot bypass hold: ${defect}`,()=>{
 const {d,e,event}=fixture();const release={id:'release',entity_id:d.id,action:historicalRetentionReleaseAction,details:{source:'controlled_historical_cleanup',contract:'historical-v1',epoch:event.details.epoch,reconciliationId:event.id,reason:'verified_historical_cleanup',reviewReference:'review-1',releasedAt:new Date(now).toISOString()}};
 if(defect==='other_epoch')release.details.epoch='other';if(defect==='other_completion')release.details.reconciliationId='other';
 if(defect==='future')release.details.releasedAt='2099-01-01T00:00:00Z';if(defect==='malformed')release.details.reason='other';
 e.reconciliations!.push(release);if(defect==='duplicate')e.reconciliations!.push({...release,id:'other'});
 const r=resolveWorkflow(d,e,now);assert.equal(r.historicalRetention?.released,false);
 assert.equal(retentionPlan({...d,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now),null);
});
for(const defect of ['failed_branch','missing_branch','new_parent','other_parent','new_upload','new_icon','new_mediref','invalidated','duplicate','wrong_source','wrong_epoch','wrong_contract'])test(`durable guard rejects ${defect}`,()=>{
 const f=fixture();switch(defect){
 case 'failed_branch':f.event.details.branches.icon.outcome='failed';break;
 case 'missing_branch':delete (f.event.details.branches as Partial<typeof f.event.details.branches>).periodontal;break;
 case 'new_parent':f.e.parent={id:'parent',job_type:'complete_report_workflow',status:'waiting'};break;
 case 'other_parent':f.e.hasOtherParent=true;break;
 case 'new_upload':f.e.uploads=[{id:'new',job_type:'upload_report_to_praktika',status:'failed'}];break;
 case 'new_icon':f.e.icons=[{id:'new',job_type:'update_praktika_letter_icons',status:'pending'}];break;
 case 'new_mediref':f.e.mediref=[{id:'new',job_type:'send_mediref_letter',status:'failed'}];break;
 case 'invalidated':f.e.reconciliations!.push({...f.event,id:'invalid',action:historicalInvalidationAction});break;
 case 'duplicate':f.e.reconciliations!.push({...f.event,id:'duplicate'});break;
 case 'wrong_source':f.event.details.source='browser';break;
 case 'wrong_epoch':f.event.details.epoch='other';break;
 case 'wrong_contract':f.event.details.contract='unknown';break;
 }
 const r=resolveWorkflow(f.d,f.e,now);assert.notEqual(r.status,'completed');assert.equal(retentionPlan({...f.d,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now),null);
});
for(const timestamp of [null,'invalid','2099-01-01T00:00:00Z'])test(`missing/untrustworthy completion timestamp denies retention: ${timestamp}`,()=>{
 const {d,e,event}=fixture();Object.assign(event.details,{historicalCompletedAt:timestamp});const r=resolveWorkflow(d,e,now);
 assert.equal(r.completedAt,null);assert.equal(retentionPlan({...d,updated_at:stamp,source_text:'synthetic',workflow_resolved:r},retentionSettings({})!,now),null);
});
test('epoch preserves microseconds and does not depend on cleanup version',()=>{
 assert.equal(historicalEpoch({created_at:stamp}), '2026-01-01T00:00:00.123456Z/unrecorded');
 assert.equal(historicalEpoch({created_at:null}),null);
});
test('normal runtime has no historical reconstruction calls or artifact queries',()=>{
 const runtime=readFileSync('lib/report-writing/workflow-recovery.ts','utf8');
 assert.doesNotMatch(runtime,/readHistoricalWorkflowEvidence|historicalDrafts|body->file|stagedPdf|appointment_id.*\.in/);
 assert.match(runtime,/historicalReconciliationAction/);
});
test('cleanup-only exclusions and retention-impact defaults are read-only and conservative',()=>{
 for(const name of [' test test ','TESTING TESTING','Siobhan Gannon'])assert.equal(historicalCleanupExcluded(name),true);
 assert.equal(historicalCleanupExcluded('test tester'),false);
 const p={sourceDays:30,aiDays:30,finalDays:90,deleteFinalText:false};const presence={source:true,ai:true,final:true};const markers={source:null,ai:null,final:null};
 assert.equal(retentionImpact(stamp,presence,markers,p,now).sourceEligible,true);
 assert.equal(retentionImpact(stamp,presence,markers,p,now).finalEligible,false);
 assert.equal(retentionImpact(null,presence,markers,p,now).sourceEligible,false);
 assert.equal(retentionImpact(stamp,presence,{...markers,source:stamp},p,now).sourceEligible,false);
});
for(const failSecondPage of [false,true])test(`runtime durable lookup fails closed on incomplete evidence: ${failSecondPage}`,async()=>{
 const {d,event}=fixture();let pages=0;
 const db=createClient('https://fixture.invalid','synthetic-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  assert.equal(init?.method,'GET');const url=new URL(String(input));
  if(!url.pathname.endsWith('/report_writing_audit_events'))return Response.json([]);
  pages++;
  if(!failSecondPage)return Response.json([event]);
  if(pages===1)return Response.json([event,...Array.from({length:499},(_,i)=>({...event,id:`other-${i}`,entity_id:'other'}))]);
  return Response.json({message:'synthetic unavailable'},{status:503});
 }}});
 const [out]=await projectWorkflowRecovery(db,[d]);
 assert.equal(shouldAppearInApproved(out),failSecondPage);
 if(failSecondPage){
  // The installed PostgREST client may retry a 503 GET within the same deadline.
  assert.ok(pages>=2);
  assert.equal(retentionPlan({...out,updated_at:stamp,source_text:'synthetic'},retentionSettings({})!,now),null);
 }
});
