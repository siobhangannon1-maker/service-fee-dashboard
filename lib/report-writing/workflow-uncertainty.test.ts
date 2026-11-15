import assert from 'node:assert/strict';
import {test} from 'node:test';
import {toDraftListItem} from './draft-contract';
import {partitionApprovedForVerification} from './typist-approved-partition';
import {unavailableWorkflow} from './resolved-workflow';
import {typistCardPresentation} from './typist-card-presentation';
function row(i:number){return toDraftListItem({id:`synthetic-${i}`,status:'approved',provider_approved_at:'2026-11-01T00:00:00Z',created_at:'2026-10-01T00:00:00Z',workflow_continuation_context:'present',workflow_resolved:{...unavailableWorkflow(),lookupUnavailable:false,status:'not_started'}},null);}
test('12 awaiting, 45 verified review records and 75 completions remain disjoint through a failed refresh',()=>{
 const rows=Array.from({length:132},(_,i)=>{const d=row(i);if(i>=12&&i<57){d.workflow_continuation_context='absent';d.workflow_resolved!.status='needs_attention';}else if(i>=57)d.workflow_resolved!.status='completed';return d;});
 const before=JSON.stringify(rows);let p=partitionApprovedForVerification(rows);assert.equal(p.approved.length,12);assert.equal(p.verificationItems.length,45);assert.equal(p.uncertaintyItems.length,0);
 const uncertain=rows.map(d=>({...d,workflowStatusStale:true,workflow_resolved:unavailableWorkflow()}));
 p=partitionApprovedForVerification(uncertain);assert.equal(p.approved.length,0);assert.equal(p.verificationItems.length,0);assert.equal(p.uncertaintyItems.length,132);
 for(const d of uncertain){assert.equal(typistCardPresentation(d).label,'Status unavailable');assert.notEqual(d.workflow_resolved.status,'completed');}
 assert.equal(JSON.stringify(rows),before);
 p=partitionApprovedForVerification(rows);assert.equal(p.approved.length,12);assert.equal(p.verificationItems.length,45);
});
test('genuine icon failure remains Approved; an unavailable projection never does',()=>{
 const d=row(1);d.workflow_resolved!.status='needs_attention';d.workflow_resolved!.branches.icon='failed';
 assert.deepEqual(partitionApprovedForVerification([d]).approved,[d]);
 for(const raw of ['completed','failed','running',null]) {const u={...d,workflow_status:raw,workflowStatusStale:true};const p=partitionApprovedForVerification([u]);assert.equal(p.approved.length,0);assert.equal(p.verificationItems.length,0);assert.deepEqual(p.uncertaintyItems,[u]);}
});
