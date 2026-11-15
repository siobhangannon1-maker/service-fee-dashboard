import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toDraftListItem} from './draft-contract';
import {canOfferManualWorkflowCompletion} from './typist-approved-partition';
import {unavailableWorkflow} from './resolved-workflow';
import {readFileSync} from 'node:fs';
for(const status of ['approved','uploaded_to_praktika'])for(const scenario of ['never_started','failed','partial','completed','stale','unavailable','not_approved'])test(`${status}: administrative action visibility for ${scenario}`,()=>{
 const d=toDraftListItem({id:'synthetic',status,provider_approved_at:scenario==='not_approved'?null:'2026-11-01T00:00:00Z',workflowStatusStale:scenario==='stale',workflow_resolved:{...unavailableWorkflow(),lookupUnavailable:scenario==='unavailable',status:scenario==='completed'?'completed':scenario==='never_started'?'not_started':'needs_attention',branches:{praktika:scenario==='partial'?'completed':'failed',icon:'failed',mediref:'unknown',periodontal:'unknown'}}},null);
 const before=JSON.stringify(d);assert.equal(canOfferManualWorkflowCompletion(d),['failed','partial'].includes(scenario));assert.equal(JSON.stringify(d),before);
});
test('the actual card uses the shared visibility rule',()=>{
 const s=readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx','utf8');assert.match(s,/canOfferManualWorkflowCompletion\(draft\) && <ManualWorkflowCompletionButton/);
});
