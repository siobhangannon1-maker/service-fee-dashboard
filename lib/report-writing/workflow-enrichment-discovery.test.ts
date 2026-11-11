import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {projectWorkflowRecovery} from './workflow-recovery';
import {toDraftListItem} from './draft-contract';
import {partitionApprovedForVerification} from './typist-approved-partition';
import {typistCardPresentation} from './typist-card-presentation';
import {historicalEpoch,historicalReconciliationAction,historicalInvalidationAction} from './historical-reconciliation';

type Event={id:string;entity_id:string;action:string;details:Record<string,unknown>};
function fixture(){
 const drafts=Array.from({length:100},(_,i)=>({id:`synthetic-${i}`,provider_id:'synthetic-provider',status:i<33?'approved':'uploaded_to_praktika',
  created_at:i<73?'2026-10-01T00:00:00Z':'2026-08-01T00:00:00Z',provider_approved_at:'2026-10-02T00:00:00Z',
  updated_at:'2026-10-03T00:00:00Z',workflow_status:i<33?null:'completed',uploaded_to_praktika:i>=33}));
 const events:Event[]=drafts.slice(33).map(d=>({id:`event-${d.id}`,entity_id:d.id,action:historicalReconciliationAction,details:{
  eventId:`event-${d.id}`,draftId:d.id,epoch:historicalEpoch(d),source:'controlled_historical_cleanup',contract:'historical-v1',reconciliationVersion:1,
  reconciledAt:'2026-10-03T00:00:00Z',historicalCompletedAt:'2026-10-03T00:00:00Z',
  branches:{praktika:{outcome:'completed',basis:'system_verified_historical_completion',jobId:'synthetic-upload',auditId:'synthetic-audit'},
   mediref:{outcome:'completed',jobId:'synthetic-mediref'},icon:{outcome:'completed',jobId:'synthetic-icon'},periodontal:{outcome:'skipped'}}}}));
 return {drafts,events};
}
function database(events:Event[],options:{timeout?:boolean;executionSafe?:boolean;closure?:boolean}={}){
 const auditActions:string[]=[];let rpcCalls=0;
 const db=createClient('https://synthetic.invalid','synthetic-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
  const url=new URL(String(input));const table=url.pathname.split('/').at(-1);
  if(table==='workflow_resolution_projection'){
   assert.equal(init?.method,'POST');rpcCalls++;
   const ids=(JSON.parse(String(init?.body)) as {p_draft_ids:string[]}).p_draft_ids;
   return Response.json(ids.map(id=>({id,draftId:id,letterFingerprint:'synthetic-fingerprint',executionSafe:options.executionSafe??true,
    events:options.closure?[{id:'synthetic-closure',action:'workflow_resolution_completed',details:{contract:'workflow-resolution-v1',version:1,draftId:id,letterFingerprint:'synthetic-fingerprint',actorUserId:'synthetic-staff',completedAt:'2026-10-03T00:00:00Z'}}]:[]})));
  }
  assert.equal(init?.method,'GET');
  if(table!=='report_writing_audit_events')return Response.json([]);
  const actions=url.searchParams.get('action')||'';auditActions.push(actions);
  // 8,559 irrelevant execution/settlement journal rows exhaust the old shared
  // deadline. Model that outcome deterministically rather than sleeping in tests.
  if(options.timeout||actions.includes('workflow_resolution_execution')||actions.includes('workflow_resolution_settled'))throw new DOMException('synthetic deadline','TimeoutError');
  const selected=events.filter(e=>actions.includes(e.action));const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||500);
  return Response.json(selected.slice(offset,offset+limit));
 }}});
 return {db,auditActions,get rpcCalls(){return rpcCalls;}};
}
test('audit journal flood cannot turn 33 ready letters and 67 proven completions into 73 Approved / 27 Verification',async()=>{
 const {drafts,events}=fixture(),before=JSON.stringify(drafts),mock=database(events);
 const projected=await projectWorkflowRecovery(mock.db,drafts);
 const items=projected.map(d=>toDraftListItem(d,null)),partition=partitionApprovedForVerification(items);
 assert.equal(partition.approved.length,33);assert.equal(partition.verificationItems.length,0);
 assert.equal(items.filter(d=>d.workflow_resolved?.status==='completed').length,67);
 assert.ok(partition.approved.every(d=>typistCardPresentation(d).kind==='ready'&&!d.workflowStatusStale));
 assert.ok(mock.auditActions.every(a=>!a.includes('workflow_resolution_execution')&&!a.includes('workflow_resolution_settled')&&!a.includes('workflow_resolution_branch_fence')));
 assert.equal(mock.rpcCalls,0);assert.equal(JSON.stringify(drafts),before);
});
test('real enrichment timeout retains uncertain evidence: reproduces 73 / 27, never ready or completed',async()=>{
 const {drafts,events}=fixture(),mock=database(events,{timeout:true});
 const projected=await projectWorkflowRecovery(mock.db,drafts);const items=projected.map(d=>toDraftListItem(d,null)),partition=partitionApprovedForVerification(items);
 assert.equal(partition.approved.length,73);assert.equal(partition.verificationItems.length,27);
 assert.ok(items.every(d=>d.workflowStatusStale&&d.workflow_resolved?.lookupUnavailable));
 assert.ok(items.every(d=>typistCardPresentation(d).kind!=='ready'&&d.workflow_resolved?.status!=='completed'));
});
for(const action of ['workflow_resolution_verification','workflow_resolution_resume','workflow_resolution_completed'])test(`${action} still invokes the authoritative safety projection`,async()=>{
 const {drafts}=fixture();const d=drafts[0];const mock=database([{id:'synthetic-event',entity_id:d.id,action,details:{}}]);
 await projectWorkflowRecovery(mock.db,[d]);assert.equal(mock.rpcCalls,1);
});
for(const executionSafe of [true,false])test(`manual closure still respects executing safety: ${executionSafe}`,async()=>{
 const {drafts}=fixture(),d=drafts[0];const mock=database([{id:'synthetic-event',entity_id:d.id,action:'workflow_resolution_completed',details:{}}],{executionSafe,closure:true});
 const [out]=await projectWorkflowRecovery(mock.db,[d]);assert.equal(toDraftListItem(out,null).workflow_resolved?.status,executionSafe?'completed':'needs_attention');assert.equal(out.status,'approved');
});
test('historical invalidation remains visible and cannot be suppressed by filtering journal events',async()=>{
 const {drafts,events}=fixture(),d=drafts[99];events.push({id:'synthetic-invalidation',entity_id:d.id,action:historicalInvalidationAction,details:{epoch:historicalEpoch(d)}});
 const [out]=await projectWorkflowRecovery(database(events).db,[d]);assert.notEqual(toDraftListItem(out,null).workflow_resolved?.status,'completed');
});
