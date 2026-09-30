import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { toDraftListItem, toDraftDetail, mergeDraftWorkflow } from './draft-contract';
import { typistMedirefPresentation, typistApprovedPresentation } from './typist-mediref-presentation';
import { shouldAppearInApproved, unavailableWorkflow, type WorkflowDraft } from './resolved-workflow';

const stamp = '2026-01-01T00:00:00Z';
function fixture(): WorkflowDraft {
  return { status: 'approved', emailed_to_referrer_at: stamp, workflow_resolved: {
    ...unavailableWorkflow(), lookupUnavailable: false,
    message: 'Workflow has not progressed. Review the unfinished workflow steps.',
  } };
}
for (const branch of ['failed', 'unknown', 'active', 'skipped'] as const) {
  test(`needs-attention with timestamp and ${branch} MediRef does not confirm delivery`, () => {
    const draft = fixture(); draft.workflow_resolved!.branches.mediref = branch;
    assert.deepEqual(typistMedirefPresentation(draft), {
      completed: false, label: 'MediRef delivery not confirmed.', showCardLabel: true,
    });
  });
}
test('missing resolution ignores raw timestamp, reference, workflow flags and prepared-only result', () => {
  const draft = { status: 'approved', emailed_to_referrer_at: stamp,
    emailed_to_referrer_resend_id: 'mediref:synthetic', workflow_mediref_status: 'completed',
    result: { sent: false, prepared: true, remoteDraftSaved: true, attachmentCount: 1 } };
  assert.equal(typistMedirefPresentation(draft).completed, false);
  assert.equal(typistMedirefPresentation(draft).label, 'MediRef delivery not confirmed.');
});
test('authoritative completed branch preserves positive presentation without claiming final sending', () => {
  const draft = fixture(); draft.workflow_resolved!.status = 'completed';
  draft.workflow_resolved!.branches.mediref = 'completed';
  // The existing accepted contract may represent a prepared draft with sent:false.
  const input = { ...draft, result: { sent: false, prepared: true, remoteDraftSaved: true } };
  const display = typistMedirefPresentation(input);
  assert.equal(display.completed, true); assert.equal(display.label, 'MediRef step completed.');
  assert.doesNotMatch(display.label, /emailed|sent|delivered/i);
  assert.equal(display.showCardLabel, true);
});
for (const status of ['needs_attention', 'completing', 'not_started'] as const) {
  test(`${status} suppresses completed card line but preserves selected-draft presentation and visibility`, () => {
    const draft = fixture(); draft.workflow_resolved!.status = status;
    draft.workflow_resolved!.branches.mediref = 'completed';
    const before = JSON.stringify(draft), visible = shouldAppearInApproved(draft);
    const display = typistMedirefPresentation(draft);
    assert.equal(display.showCardLabel, false);
    assert.equal(display.completed, true);
    assert.equal(display.label, 'MediRef step completed.');
    assert.equal(JSON.stringify(draft), before);
    assert.equal(shouldAppearInApproved(draft), visible);
  });
}
test('unavailable lookup fails closed even with a completed branch', () => {
  const draft = fixture(); draft.workflow_resolved!.lookupUnavailable = true;
  draft.workflow_resolved!.branches.mediref = 'completed';
  assert.equal(typistMedirefPresentation(draft).completed, false);
});
test('existing MediRef attention explanation suppresses redundant card text', () => {
  const draft = fixture(); draft.workflow_resolved!.message = 'MediRef needs verification.';
  assert.equal(typistMedirefPresentation(draft).showCardLabel, false);
  draft.workflow_resolved!.message = null; draft.workflow_resolved!.medirefRecovery = true;
  assert.equal(typistMedirefPresentation(draft).showCardLabel, false);
});
test('display helper does not change resolution, visibility or input data', () => {
  const draft = fixture(), before = JSON.stringify(draft), visible = shouldAppearInApproved(draft);
  typistMedirefPresentation(Object.freeze(draft));
  assert.equal(JSON.stringify(draft), before); assert.equal(shouldAppearInApproved(draft), visible);
  assert.equal(typistMedirefPresentation(null).completed, false);
});
test('Typist card/detail use presentation helper while operational duplicate guards stay unchanged', () => {
  const source = readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx', 'utf8');
  assert.ok(source.includes('typistMedirefPresentation(draft).showCardLabel'));
  assert.ok(source.includes('{selectedDraftMedirefPresentation.label}'));
  assert.doesNotMatch(source, /Emailed to|Email sent via Mediref/);
  assert.ok(source.includes('const selectedDraftEmailed = Boolean(selectedDraft?.emailed_to_referrer_at);'));
  assert.ok(source.includes('if (selectedDraftUploadedToPraktika || selectedDraftEmailed)'));
  const helper = readFileSync('lib/report-writing/typist-mediref-presentation.ts', 'utf8');
  assert.doesNotMatch(helper, /fetch\(|\.from\(|\.rpc\(|\.update\(|\.insert\(/);
});

test('authoritative not-started card is neutral without an age assertion',()=>{
  const d=fixture();d.workflow_resolved!.status='not_started';
  const p=typistApprovedPresentation(d);
  assert.equal(p.label,'Ready for workflow');assert.equal(p.tone,'neutral');
  assert.equal(p.message,'No workflow is currently recorded for this letter.');
  assert.doesNotMatch(p.message,/predates|historical|failed/i);
});
for(const branch of ['failed','unknown'] as const)test(`absent continuation with ${branch} MediRef uses unconfirmed wording`,()=>{
  const d={...fixture(),workflow_continuation_context:'absent' as const};d.workflow_resolved!.branches.mediref=branch;
  const before=JSON.stringify(d),visible=shouldAppearInApproved(d);
  const p=typistApprovedPresentation(d);
  assert.equal(p.kind,'historical_mediref');assert.equal(p.label,'MediRef delivery not confirmed');assert.equal(p.tone,'amber');
  assert.equal(JSON.stringify(d),before);assert.equal(shouldAppearInApproved(d),visible);
});
test('absent continuation with completed MediRef and unknown branch requires review',()=>{
  const d={...fixture(),workflow_continuation_context:'absent' as const};d.workflow_resolved!.branches.mediref='completed';
  assert.equal(typistApprovedPresentation(d).label,'Historical workflow requires review');
});
for(const context of ['present','unknown',undefined] as const)test(`context ${context} cannot classify as historical`,()=>{
  const d={...fixture(),workflow_continuation_context:context};
  assert.equal(typistApprovedPresentation(d).label,'Needs attention');
  assert.equal(typistApprovedPresentation(d).message,d.workflow_resolved!.message);
  assert.equal(typistApprovedPresentation(d).kind,'current');
});
test('Aaron-style waiting modern upload preserves authoritative status and recovery flags',()=>{
  const d={...fixture(),workflow_continuation_context:'present' as const};
  d.workflow_resolved!.branches={praktika:'active',icon:'unknown',mediref:'completed',periodontal:'skipped'};
  const before=JSON.stringify(d),p=typistApprovedPresentation(d);
  assert.equal(p.kind,'current');assert.equal(p.label,'Needs attention');
  assert.equal(p.message,d.workflow_resolved!.message);assert.equal(JSON.stringify(d),before);
  assert.equal(shouldAppearInApproved(d),true);
});
test('failed resolution cannot produce historical wording even with absent context',()=>{
  const d={...fixture(),workflow_continuation_context:'absent' as const};d.workflow_resolved!.lookupUnavailable=true;
  assert.equal(typistApprovedPresentation(d).kind,'current');
});
test('continuation context survives list serialization and refresh merge, with missing fields cleared',()=>{
  const row={id:'draft',provider_id:'provider',status:'approved',workflow_continuation_context:'present'};
  const before=JSON.stringify(row),list=toDraftListItem(row,null),detail=toDraftDetail(row);
  assert.equal(list.workflow_continuation_context,'present');
  const updated=mergeDraftWorkflow(detail,toDraftListItem({...row,workflow_continuation_context:'unknown'},null));
  assert.equal(updated.workflow_continuation_context,'unknown');assert.equal(detail.workflow_continuation_context,'present');
  assert.equal(mergeDraftWorkflow(updated,toDraftListItem({id:'draft',provider_id:'provider'},null)).workflow_continuation_context,undefined);
  assert.equal(JSON.stringify(row),before);
});

test('only authoritative present connection block changes card wording; resolution and recovery stay intact',()=>{
  for(const context of ['present','absent','unknown'] as const)for(const block of ['praktika_credentials_required','unknown'] as const){
    const d={...fixture(),workflow_continuation_context:context,workflow_connection_block:block};
    const before=JSON.stringify(d),visible=shouldAppearInApproved(d),p=typistApprovedPresentation(d);
    assert.equal(p.kind==='connection_blocked',context==='present'&&block==='praktika_credentials_required');
    if(p.kind==='connection_blocked'){
      assert.equal(p.label,'Waiting for Praktika connection');
      assert.equal(p.message,'This workflow will continue automatically when the required Praktika connection is restored.');
    }
    assert.equal(JSON.stringify(d),before);assert.equal(shouldAppearInApproved(d),visible);
    d.workflow_resolved!.lookupUnavailable=true;assert.notEqual(typistApprovedPresentation(d).kind,'connection_blocked');
  }
});
test('connection block survives projection and refresh; old evidence is cleared',()=>{
  const row={id:'draft',workflow_connection_block:'praktika_credentials_required'};
  const list=toDraftListItem(row,null),detail=toDraftDetail(row);
  assert.equal(list.workflow_connection_block,'praktika_credentials_required');
  assert.equal(mergeDraftWorkflow(detail,toDraftListItem({...row,workflow_connection_block:'unknown'},null)).workflow_connection_block,'unknown');
  assert.equal(mergeDraftWorkflow(detail,toDraftListItem({id:'draft'},null)).workflow_connection_block,undefined);
});
