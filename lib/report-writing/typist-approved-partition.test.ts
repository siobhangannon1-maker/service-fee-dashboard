import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { toDraftListItem } from './draft-contract';
import { unavailableWorkflow, shouldAppearInApproved } from './resolved-workflow';
import { typistApprovedPresentation } from './typist-mediref-presentation';
import { requiresWorkflowVerification, partitionApprovedForVerification } from './typist-approved-partition';

function fixture(id='draft') {
  return toDraftListItem({id,status:'approved',provider_approved_at:'2026-10-01T00:00:00Z',created_at:'2026-10-01T00:00:00Z',workflow_continuation_context:'absent',workflow_resolved:{
    ...unavailableWorkflow(),lookupUnavailable:false,
  }},null);
}
for(const branch of ['failed','unknown','completed'] as const)test(`authoritative historical ${branch} MediRef partitions for review`,()=>{
  const d=fixture();d.workflow_resolved!.branches.mediref=branch;
  assert.equal(requiresWorkflowVerification(d),true);
  const text=typistApprovedPresentation(d);
  assert.ok(['historical_mediref','historical_review'].includes(text.kind));
  assert.doesNotMatch(text.message || '',/was sent|is absent|upload missing|workflow completed/i);
});
for(const defect of ['present','unknown','not_started','completing','lookup_failed','stale','missing_projection'] as const)test(`${defect} uses authoritative or unavailable partition`,()=>{
  const d=fixture();
  if(defect==='present'||defect==='unknown')d.workflow_continuation_context=defect;
  if(defect==='not_started'||defect==='completing')d.workflow_resolved!.status=defect;
  if(defect==='lookup_failed')d.workflow_resolved!.lookupUnavailable=true;
  if(defect==='stale')d.workflowStatusStale=true;
  if(defect==='missing_projection')delete d.workflow_resolved;
  assert.equal(requiresWorkflowVerification(d),false);
  const uncertain=['lookup_failed','stale','missing_projection'].includes(defect);
  assert.deepEqual(partitionApprovedForVerification([d]),{approved:uncertain?[]:[d],verificationItems:[],uncertaintyItems:uncertain?[d]:[]});
});
test('Aaron-style blocked modern upload remains current with unchanged recovery flags',()=>{
  const d=fixture();d.workflow_continuation_context='present';d.workflow_connection_block='praktika_credentials_required';
  d.workflow_resolved!.branches={praktika:'active',mediref:'completed',icon:'unknown',periodontal:'skipped'};
  const before=JSON.stringify(d);
  assert.deepEqual(partitionApprovedForVerification([d]).approved,[d]);
  assert.equal(typistApprovedPresentation(d).kind,'connection_blocked');assert.equal(JSON.stringify(d),before);
});
test('partition is exhaustive, disjoint, ordered and immutable within existing Approved membership',()=>{
  const a=fixture('a'),b=fixture('b'),c=fixture('c'),d=fixture('d'),e=fixture('completed');
  b.workflow_continuation_context='unknown';d.workflow_resolved!.status='not_started';e.workflow_resolved!.status='completed';
  const input=[a,b,c,d,e];const before=JSON.stringify(input);input.forEach(Object.freeze);
  const out=partitionApprovedForVerification(Object.freeze(input));
  assert.deepEqual(out.approved,[b,d]);assert.deepEqual(out.verificationItems,[a,c]);
  const ids=[...out.approved,...out.verificationItems,...out.uncertaintyItems].map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,input.filter(shouldAppearInApproved).length);
  assert.equal(JSON.stringify(input),before);
});
test('every approved letter lands in exactly one tab unless intentionally excluded',()=>{
  let n=0;
  for(const status of ['approved','uploaded_to_praktika'])
  for(const approvedAt of ['2026-10-01T00:00:00Z',null])
  for(const resolved of ['completed','needs_attention','not_started','completing','missing'] as const)
  for(const lookupUnavailable of [false,true])
  for(const stale of [false,true])
  for(const context of ['present','absent','unknown'] as const){
    const d=fixture(`d${n++}`);d.status=status;d.provider_approved_at=approvedAt;d.workflow_continuation_context=context;
    if(resolved==='missing')delete d.workflow_resolved;else{d.workflow_resolved!.status=resolved;d.workflow_resolved!.lookupUnavailable=lookupUnavailable;}
    if(stale)d.workflowStatusStale=true;
    const out=partitionApprovedForVerification([d]);
    const placed=out.approved.length+out.verificationItems.length+out.uncertaintyItems.length;
    const freshCompleted=resolved==='completed'&&!lookupUnavailable&&!stale;
    assert.equal(placed,freshCompleted?0:1,JSON.stringify({status,approvedAt,resolved,lookupUnavailable,stale,context}));
  }
  for(const excluded of [{workflow_attention:{type:'historical_non_actionable',message:'x'}},{id:'2304ba12-768c-467a-889c-16d6ba211574'}]){
    const d={...fixture(),...excluded} as ReturnType<typeof fixture>;d.workflowStatusStale=true;
    const out=partitionApprovedForVerification([d]);
    assert.equal(out.approved.length+out.verificationItems.length+out.uncertaintyItems.length,0);
  }
});
test('a stale completed letter without an approval date is not dropped from every tab',()=>{
  const d=fixture();d.provider_approved_at=null;d.workflow_resolved!.status='completed';d.workflowStatusStale=true;
  assert.deepEqual(partitionApprovedForVerification([d]),{approved:[],verificationItems:[d],uncertaintyItems:[]});
});
test('Typist uses one partition for counts/lists; draft-opening and recovery controls remain shared',()=>{
  const ui=readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx','utf8');
  assert.match(ui,/partitionApprovedForVerification\(drafts\)/);
  assert.match(ui,/return approvedPartition\.approved/);assert.match(ui,/return approvedPartition\.verificationItems/);
  assert.match(ui,/countCompleted = approvedPartition\.approved\.length/);
  assert.match(ui,/countVerification = approvedPartition\.verificationItems\.length/);
  assert.match(ui,/Requires Verification \(\$\{countVerification\}\)/);
  for(const guard of ['approvedWorkflow(draft).medirefRecovery','approvedWorkflow(draft).praktikaRecovery'])assert.ok(ui.includes(guard));
  assert.ok(ui.includes('typistMedirefPresentation(draft).showCardLabel'));
  const helper=readFileSync('lib/report-writing/typist-approved-partition.ts','utf8');
  assert.doesNotMatch(helper,/fetch\(|\.from\(|\.rpc\(|\.update\(|\.insert\(/);
});
