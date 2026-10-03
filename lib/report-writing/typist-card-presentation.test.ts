import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import ts from 'typescript';
import { toDraftListItem } from './draft-contract';
import { typistCardPresentation } from './typist-card-presentation';
import { typistApprovedPresentation, typistMedirefPresentation } from './typist-mediref-presentation';
import { approvedWorkflow, shouldAppearInApproved, unavailableWorkflow } from './resolved-workflow';
import { partitionApprovedForVerification } from './typist-approved-partition';
import { workflowPollingMode } from './active-workflow-poll';

const source = readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx', 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
const card = nodes.find((node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.getText(ast) === 'filteredDrafts.map' &&
  node.arguments[0].getText(ast).includes('typistCardPresentation'));
assert.ok(card);
const callback = card.arguments[0].getText(ast);
const require = createRequire(import.meta.url);
const box = {
  exports: {} as { render: (draft: ReturnType<typeof toDraftListItem>) => ReactNode }, require,
  selectedDraft: null, selectedDraftIds: [], listTab: 'drafts',
  toggleDraftSelection: () => {}, selectDraft: () => {},
  formatReportType: () => 'Consultation Report',
  typistCardPresentation, typistMedirefPresentation, approvedWorkflow,
  ManualVerificationButton: () => null, RetryPraktikaButton: () => null,
  ResumeMedirefButton: () => null, ResumeWorkflowButton: () => null,
};
runInNewContext(ts.transpileModule(`exports.render = ${callback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, box);
const render = (draft: ReturnType<typeof toDraftListItem>) => renderToStaticMarkup(box.exports.render(draft));
function fixture(status = 'draft', extra: Record<string, unknown> = {}) {
  return toDraftListItem({ id: 'synthetic-card', provider_id: 'synthetic-provider', patient_name: 'Synthetic Patient',
    report_type: 'consultation', status, ...extra }, true);
}
function noWarning(html: string) {
  assert.doesNotMatch(html, /Needs attention|Workflow status may be temporarily out of date|bg-red-100/);
}

for (const status of ['draft', 'edited_by_typist', 'awaiting_provider_approval']) {
  for (const evidence of ['absent', 'unavailable', 'not_started'] as const) {
    test(`actual ${status} card with ${evidence} evidence has calm human-readable status`, () => {
      const draft = fixture(status, evidence === 'absent' ? {} : {
        workflow_resolved: evidence === 'unavailable' ? unavailableWorkflow() : {
          ...unavailableWorkflow(), lookupUnavailable: false, status: 'not_started', message: null,
        },
        workflowStatusStale: true,
        workflow_reconciliation_warning: 'Workflow status may be temporarily out of date.',
      });
      const before = JSON.stringify(draft), html = render(Object.freeze(draft));
      assert.match(html, /Synthetic Patient/); assert.match(html, /Consultation Report/);
      assert.ok(html.includes(status === 'awaiting_provider_approval' ? 'Awaiting provider approval' : '>Draft<'));
      assert.doesNotMatch(html, /awaiting_provider_approval|edited_by_typist|Ready for workflow/);
      noWarning(html); assert.equal(JSON.stringify(draft), before);
    });
  }
}
for (const status of ['draft', 'edited_by_typist', 'awaiting_provider_approval', 'approved']) {
  for (const warning of ['failed workflow', 'exhausted retry', 'uncertain write', 'stopped recovery']) {
    test(`actual ${status} card preserves authoritative ${warning}`, () => {
      const message = `${warning} requires verification.`;
      const resolved = { ...unavailableWorkflow(), lookupUnavailable: false, message,
        branches: { ...unavailableWorkflow().branches, praktika: 'failed' as const },
        praktikaRecovery: warning === 'uncertain write',
      };
      const draft = fixture(status, { workflow_resolved: resolved, workflow_continuation_context: 'present' });
      const before = JSON.stringify(draft), html = render(draft);
      assert.match(html, /Needs attention/); assert.match(html, /bg-red-100/); assert.ok(html.includes(message));
      assert.equal(JSON.stringify(draft), before);
    });
  }
}
test('authoritative uncertainty without a failed branch keeps its warning', () => {
  const draft = fixture('awaiting_provider_approval', { workflow_resolved: {
    ...unavailableWorkflow(), lookupUnavailable: false, message: 'Unfinished workflow steps need review.',
  } });
  assert.match(render(draft), /Needs attention/);
  assert.match(render(draft), /Unfinished workflow steps need review/);
});
for (const extra of [
  { workflow_status: 'failed' }, { workflow_status: 'running' },
  { workflow_continuation_context: 'present' }, { workflow_praktika_upload_status: 'failed' },
  { workflow_error: 'Recorded failure' }, { periodontal_chart_attachment_error: 'Chart needs review' },
  { workflow_started_at: '2026-01-01T00:00:00Z' }, { uploaded_to_praktika: true },
]) test(`unavailable lookup with recorded evidence ${Object.keys(extra)[0]} is not treated as an ordinary draft`, () => {
  assert.match(render(fixture('draft', { ...extra, workflow_resolved: unavailableWorkflow() })), /Needs attention/);
});
for (const flag of ['praktikaRecovery', 'medirefRecovery'] as const) test(`${flag} survives unavailable lookup`, () => {
  assert.match(render(fixture('draft', { workflow_resolved: { ...unavailableWorkflow(), [flag]: true } })), /Needs attention/);
});
test('ordinary draft keeps a distinct reconciliation warning', () => {
  const draft = fixture('draft', { workflow_reconciliation_warning: 'Saved draft requires manual review.' });
  assert.match(render(draft), /Saved draft requires manual review/);
});
for (const status of ['future_internal_state', 'toString', 'constructor']) test(`unknown backend status ${status} is not exposed or mechanically humanised`, () => {
  const draft = fixture(status), html = render(draft);
  assert.equal(typistCardPresentation(draft).statusLabel, null);
  assert.doesNotMatch(html, /future_internal_state|future internal state/i);
  assert.match(html, /Needs attention/);
});
for (const status of ['approved', 'uploaded_to_praktika']) {
  for (const state of ['not_started', 'completing', 'needs_attention', 'completed'] as const) {
    test(`${status}/${state} preserves the entire Approved presentation and completion membership`, () => {
      const draft = fixture(status, { workflow_resolved: {
        ...unavailableWorkflow(), lookupUnavailable: false, status: state, message: 'Existing resolver message.',
      }, workflow_reconciliation_warning: 'Existing reconciliation warning.' });
      const before = JSON.stringify(draft), expected = typistApprovedPresentation(draft);
      const shown = typistCardPresentation(draft);
      for (const key of ['kind', 'tone', 'label', 'message'] as const) assert.equal(shown[key], expected[key]);
      assert.equal(shown.reconciliationWarning, draft.workflow_reconciliation_warning);
      assert.equal(shouldAppearInApproved(draft), state !== 'completed');
      if (expected.label) assert.ok(render(draft).includes(expected.label));
      assert.equal(JSON.stringify(draft), before);
    });
  }
}
test('historical verification presentation and partition stay intact', () => {
  const draft = fixture('approved', { workflow_resolved: { ...unavailableWorkflow(), lookupUnavailable: false },
    workflow_continuation_context: 'absent' });
  assert.equal(typistCardPresentation(draft).kind, 'historical_mediref');
  assert.deepEqual(partitionApprovedForVerification([draft]), { approved: [], verificationItems: [draft] });
  assert.match(render(draft), /MediRef delivery not confirmed/);
});
test('current approved waiting presentation stays amber and retains polling membership', () => {
  const draft = fixture('approved', { workflow_status: 'running', workflow_resolved: {
    ...unavailableWorkflow(), lookupUnavailable: false, status: 'completing',
  }, workflow_current_presentation: 'waiting_upload' });
  const before = workflowPollingMode(draft), shown = typistCardPresentation(draft);
  assert.equal(shown.label, 'Completing… Waiting for upload'); assert.equal(shown.tone, 'amber');
  assert.equal(workflowPollingMode(draft), before); assert.match(render(draft), /bg-amber-100/);
});
test('actual tab classification and Queue membership are unchanged by card presentation', () => {
  const rows = [fixture('draft'), fixture('edited_by_typist'), fixture('awaiting_provider_approval'),
    fixture('approved', { id: 'approved', workflow_resolved: { ...unavailableWorkflow(), status: 'not_started' } }),
    fixture('approved', { id: 'verify', workflow_resolved: { ...unavailableWorkflow(), lookupUnavailable: false }, workflow_continuation_context: 'absent' }),
    fixture('approved', { id: 'done', workflow_resolved: { ...unavailableWorkflow(), status: 'completed', lookupUnavailable: false } })];
  const select = (tab: string) => {
    const node = nodes.find((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'filteredDrafts')!;
    return runInNewContext(ts.transpileModule(node.initializer!.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, { useMemo: (fn: () => unknown) => fn(), drafts: rows, listTab: tab,
      approvedPartition: partitionApprovedForVerification(rows) }) as typeof rows;
  };
  const before = JSON.stringify(rows), initial = ['drafts', 'awaiting', 'completed', 'verification'].map(select);
  rows.forEach(typistCardPresentation);
  assert.deepEqual(['drafts', 'awaiting', 'completed', 'verification'].map(select), initial);
  assert.deepEqual(Array.from(select('drafts'), d => d.status), ['draft', 'edited_by_typist']);
  assert.deepEqual(Array.from(select('awaiting'), d => d.status), ['awaiting_provider_approval']);
  assert.deepEqual(Array.from(select('completed'), d => d.id), ['approved']);
  assert.deepEqual(Array.from(select('verification'), d => d.id), ['verify']);
  const queueNode = nodes.find((n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'visibleQueue')!;
  const queue = [{ id: 'queued', status: 'queued' }, { id: 'started', status: 'started' },
    { id: 'linked', status: 'queued', report_draft_id: rows[0].id }, { id: 'finished', status: 'completed' }];
  const visible = runInNewContext(ts.transpileModule(queueNode.initializer!.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { useMemo: (fn: () => unknown) => fn(), drafts: rows, queue }) as typeof queue;
  assert.deepEqual(Array.from(visible, item => item.id), ['queued', 'started']);
  assert.equal(JSON.stringify(rows), before);
});
