import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { toDraftListItem } from './draft-contract';
import { unavailableWorkflow, shouldAppearInApproved } from './resolved-workflow';
import { typistApprovedPresentation } from './typist-mediref-presentation';
import { requiresWorkflowVerification, partitionApprovedForVerification } from './typist-approved-partition';

function fixture(id='draft') {
  return toDraftListItem({id,status:'approved',workflow_continuation_context:'absent',workflow_resolved:{
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
for(const defect of ['present','unknown','not_started','completing','lookup_failed','stale','missing_projection'] as const)test(`${defect} remains operational Approved`,()=>{
  const d=fixture();
  if(defect==='present'||defect==='unknown')d.workflow_continuation_context=defect;
  if(defect==='not_started'||defect==='completing')d.workflow_resolved!.status=defect;
  if(defect==='lookup_failed')d.workflow_resolved!.lookupUnavailable=true;
  if(defect==='stale')d.workflowStatusStale=true;
  if(defect==='missing_projection')delete d.workflow_resolved;
  assert.equal(requiresWorkflowVerification(d),false);
  assert.deepEqual(partitionApprovedForVerification([d]),{approved:[d],verificationItems:[]});
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
  const ids=[...out.approved,...out.verificationItems].map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length);assert.equal(ids.length,input.filter(shouldAppearInApproved).length);
  assert.equal(JSON.stringify(input),before);
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
