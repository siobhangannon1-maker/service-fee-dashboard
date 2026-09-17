import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {projectHistoricalAttention,historicalAttentionAction,historicalAttentionInvalidated} from './historical-attention';
import {nonOperationalDraftIds} from './non-operational-drafts';
import {historicalEpoch} from './historical-reconciliation';
import {resolveWorkflow,shouldAppearInApproved,type WorkflowDraft,type WorkflowEvidence} from './resolved-workflow';
import {retentionPlan,retentionSettings} from './retention';
function fixture(){
 const d:WorkflowDraft={id:'00000000-0000-4000-8000-000000000001',created_at:'2026-08-01T00:00:00Z',updated_at:'2026-08-02T00:00:00Z',status:'approved',workflow_status:'failed',workflow_mediref_status:'failed',workflow_icon_update_status:'failed'};
 const details={source:'protected_historical_attention',policyVersion:'historical-attention-v1',draftId:d.id,epoch:historicalEpoch(d),draftRevision:d.updated_at,reviewedFingerprint:'a'.repeat(64),manifestDigest:'b'.repeat(64),authorizerUserId:'00000000-0000-4000-8000-000000000002',recordedAt:'2026-09-17T00:00:00Z',disposition:'historical_non_actionable',reason:'historical_pdf_present_no_further_action',branches:['mediref','icon','bookkeeping'],pdfEvidence:{presence:'confirmed_present',kind:'operator_attestation',jobId:'00000000-0000-4000-8000-000000000003',artifactFingerprint:'c'.repeat(64)}};
 const e:WorkflowEvidence={uploads:[],icons:[],mediref:[],livePraktikaActors:new Set(),liveMediref:false,reconciliations:[{id:'00000000-0000-4000-8000-000000000004',entity_id:d.id!,action:historicalAttentionAction,details}]};
 return {d,e,details};
}
const now=Date.parse('2026-09-18T00:00:00Z');
test('attention only: branch failures, underlying outcome and retention remain unchanged',()=>{
 const {d,e}=fixture(),before=JSON.stringify({d,e}),resolved=resolveWorkflow(d,e,now),attention=projectHistoricalAttention(d,e,now);
 assert.equal(attention?.type,'historical_non_actionable');assert.equal(resolved.status,'needs_attention');
 assert.equal(resolved.branches.praktika,'unknown');assert.equal(resolved.branches.icon,'failed');
 assert.equal(JSON.stringify({d,e}),before);assert.equal(shouldAppearInApproved({...d,workflow_resolved:resolved,workflow_attention:attention}),false);
 assert.equal(retentionPlan({...d,id:d.id!,updated_at:d.updated_at!,workflow_resolved:resolved,workflow_attention:attention},retentionSettings({})!,now),null);
});
for(const presence of ['confirmed_missing','unknown'])test(`${presence} never suppresses attention`,()=>{
 const {d,e,details}=fixture();details.pdfEvidence.presence=presence;assert.equal(projectHistoricalAttention(d,e,now),undefined);assert.equal(shouldAppearInApproved(d),true);
});
for(const status of ['pending','waiting','running','processing','failed'])for(const branch of ['uploads','icons','mediref'] as const)test(`new ${branch} ${status} remains visible`,()=>{
 const {d,e}=fixture();e[branch]=[{id:'new',job_type:'synthetic',status,created_at:'2026-09-17T01:00:00Z'}];assert.equal(projectHistoricalAttention(d,e,now),undefined);
});
test('new revision/approval/epoch and invalidation cease suppression',()=>{
 for(const field of ['updated_at','provider_approved_at','created_at'] as const){const {d,e}=fixture();d[field]='2026-09-17T01:00:00Z';assert.equal(projectHistoricalAttention(d,e,now),undefined);}
 const {d,e}=fixture();e.reconciliations!.push({id:'invalid',entity_id:d.id!,action:historicalAttentionInvalidated,details:{dispositionId:e.reconciliations![0].id}});assert.equal(projectHistoricalAttention(d,e,now),undefined);
});
test('no event, wrong draft, malformed proof or multiple dispositions fail closed',()=>{
 const {d,e,details}=fixture();details.draftId='wrong';assert.equal(projectHistoricalAttention(d,e,now),undefined);
 e.reconciliations=[];assert.equal(projectHistoricalAttention(d,e,now),undefined);
 const f=fixture();f.e.reconciliations!.push({...f.e.reconciliations![0],id:'duplicate'});assert.equal(projectHistoricalAttention(f.d,f.e,now),undefined);
});
test('all 49 versioned identities are unique and bound to the reviewed set',()=>{
 assert.equal(nonOperationalDraftIds.size,49);
 const source=readFileSync(new URL('./non-operational-drafts.ts',import.meta.url),'utf8');
 const hash=source.match(/sorted IDs: ([a-f0-9]{64})/)![1];
 assert.equal(createHash('sha256').update([...nonOperationalDraftIds].sort().join('\n')).digest('hex'),hash);
 for(const id of nonOperationalDraftIds){assert.equal(shouldAppearInApproved({id,status:'approved'}),false);const {e}=fixture();assert.equal(projectHistoricalAttention({id,status:'approved'},e,now)?.type,'non_operational_test');}
 const {d}=fixture();assert.equal(shouldAppearInApproved({...d,...{patient_name:'Test Test'}}),true);
 assert.doesNotMatch(source,/patient_name\s*[=.(]|Siobhan Gannon|Test Test|Testing Testing/);
});
test('History preserves records and has a separate attention label',()=>{
 const page=readFileSync(new URL('../../app/(protected)/report-writing/history/page.tsx',import.meta.url),'utf8');
 assert.match(page,/if \(draft.workflow_attention\) return draft.workflow_attention.message/);
 assert.doesNotMatch(page,/shouldAppearInApproved/);
});

test('attention projection survives list serialization without exposing audit proof',async()=>{
 const {toDraftListItem}=await import('./draft-contract');const {d,e}=fixture();
 const attention=projectHistoricalAttention(d,e,now);
 const out=toDraftListItem({...d,workflow_attention:attention,privateEvidence:e},null);
 assert.deepEqual(out.workflow_attention,attention);assert.ok(!('privateEvidence' in out));
});

test('100 dispositioned cards share one batched audit lookup and add zero per-card requests',async()=>{
 const {createClient}=await import('@supabase/supabase-js');
 const {projectWorkflowRecovery}=await import('./workflow-recovery');
 const fixtures=Array.from({length:100},(_,i)=>{
  const f=fixture();const id=`00000000-0000-4000-8000-${String(i+100).padStart(12,'0')}`;
  f.d.id=id;f.details.draftId=id;f.details.recordedAt=new Date(Date.now()-1000).toISOString();
  f.e.reconciliations![0].entity_id=id;f.e.reconciliations![0].id=`event-${i}`;
  return f;
 });
 async function run(withDispositions:boolean){
  const requests:string[]=[];
  const db=createClient('https://fixture.invalid','synthetic-key',{auth:{persistSession:false},global:{fetch:async(input,init)=>{
   assert.equal(init?.method,'GET');const url=new URL(String(input));requests.push(url.pathname);
   if(url.pathname.endsWith('/report_writing_audit_events')){
    assert.match(url.searchParams.get('action')!,/historical_attention_disposition/);
    const ids=url.searchParams.get('entity_id')!;
    for(const f of fixtures)assert.ok(ids.includes(f.d.id!));
    return Response.json(withDispositions?fixtures.map(f=>f.e.reconciliations![0]):[]);
   }
   return Response.json([]);
  }}});
  const out=await projectWorkflowRecovery(db,fixtures.map(f=>({...f.d,id:f.d.id!})));
  const beforeRendering=requests.length;
  assert.equal(out.filter(shouldAppearInApproved).length,withDispositions?0:100);
  assert.equal(requests.length,beforeRendering,'card membership must not issue requests');
  assert.equal(requests.filter(path=>path.endsWith('/report_writing_audit_events')).length,1);
  assert.equal(requests.length,5,'two parent batches plus one upload, MediRef and shared audit batch');
  return requests;
 }
 assert.deepEqual(await run(true),await run(false),'dispositions add no requests to the existing list path');
});
