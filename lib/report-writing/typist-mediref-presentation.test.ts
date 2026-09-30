import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { typistMedirefPresentation } from './typist-mediref-presentation';
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
