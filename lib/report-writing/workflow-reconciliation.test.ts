import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { startActiveWorkflowPolling, workflowPollingMode, type ActiveWorkflowStatus } from './active-workflow-poll';
import { shouldAppearInApproved, type ResolvedWorkflow } from './resolved-workflow';
const projection = (status: ResolvedWorkflow['status']): ResolvedWorkflow => ({ status, message: null,
  branches: { praktika: 'completed', icon: 'skipped', mediref: status === 'completed' ? 'completed' : 'unknown', periodontal: 'skipped' },
  lookupUnavailable: false, lastProgressAt: null, praktikaRecovery: false, medirefRecovery: false });
const settle = () => new Promise(r => setImmediate(r));
function fixture(t: TestContext, count = 1, raw = 'completed') {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let rows: ActiveWorkflowStatus[] = Array.from({ length: count }, (_, i) => ({ id: String(i), workflow_status: raw,
    updated_at: 'unchanged', workflow_resolved: projection(raw === 'running' ? 'completing' : 'needs_attention') }));
  let authoritative = rows;
  let lists = 0, markers = 0;
  const stop = startActiveWorkflowPolling({ drafts: rows, getDrafts: () => rows, providerId: 'provider',
    fetch: (async (url: string) => { markers++; const ids = new URL(url, 'https://fixture.invalid').searchParams.get('ids')!.split(',');
      return Response.json({ success: true, drafts: rows.filter(d => ids.includes(d.id)) }); }) as typeof fetch,
    refresh: async () => { lists++; rows = authoritative; },
  });
  t.after(stop);
  return { stop, rows: () => rows, lists: () => lists, markers: () => markers,
    complete: () => { authoritative = rows.map(d => ({ ...d, workflow_resolved: projection('completed') })); },
    advance: async (ms: number) => { for (let elapsed = 0; elapsed < ms; elapsed += 5000) { t.mock.timers.tick(5000); await settle(); } } };
}
test('raw running with resolved running retains lightweight batched polling', async t => {
  const f = fixture(t, 3, 'running'); await f.advance(10000); assert.equal(f.markers(), 2); assert.equal(f.lists(), 0);
});
test('unchanged raw completed marker still reconciles parent completion and removes Approved card', async t => {
  const f = fixture(t); f.complete(); await f.advance(15000);
  assert.equal(f.lists(), 1); assert.equal(f.markers(), 0);
  assert.equal(shouldAppearInApproved({ status: 'uploaded_to_praktika', workflow_resolved: f.rows()[0].workflow_resolved as ResolvedWorkflow }), false);
  await f.advance(120000); assert.equal(f.lists(), 1);
});
test('unfinished raw completed remains Approved; genuine failure remains visible and is not permanently polled', () => {
  const failed = { id: 'failed', workflow_status: 'failed', updated_at: null, workflow_resolved: projection('needs_attention') };
  assert.equal(workflowPollingMode(failed), null);
  assert.equal(shouldAppearInApproved({ status: 'uploaded_to_praktika', workflow_resolved: failed.workflow_resolved }), true);
  assert.equal(workflowPollingMode({ ...failed, workflow_status: 'completed' }), 'reconcile');
});
test('recent Resume action restarts reconciliation without loosening completion or eligibility', () => {
  const d = { id: 'resumed', workflow_status: 'failed', updated_at: null, workflow_resolved: projection('needs_attention'), reconcileUntil: Date.now() + 600000 };
  assert.equal(workflowPollingMode(d), 'reconcile');
  assert.equal(workflowPollingMode({ ...d, workflow_resolved: projection('completing') }), 'reconcile');
  assert.equal(workflowPollingMode({ ...d, workflow_resolved: projection('completed') }), null);
});
for (const action of ['Resume', 'Complete Workflow']) test(action + ' progresses and authoritative completion stops polling', async t => {
  const f = fixture(t, 1, 'running'); await f.advance(15000); assert.equal(f.lists(), 1);
  f.complete(); await f.advance(15000); assert.equal(f.rows()[0].workflow_resolved?.status, 'completed');
  const count = f.lists(); await f.advance(60000); assert.equal(f.lists(), count);
});
test('persistent uncertainty backs off and stops after ten minutes', async t => {
  const f = fixture(t); await f.advance(650000);
  assert.ok(f.lists() >= 5 && f.lists() <= 12); const count = f.lists();
  await f.advance(600000); assert.equal(f.lists(), count);
});
test('multiple unresolved cards use one authoritative provider-list refresh', async t => {
  const f = fixture(t, 100); await f.advance(15000); assert.equal(f.lists(), 1); assert.equal(f.markers(), 0);
});
test('unknown lookup and active branches reconcile; static not-started and complete do not', () => {
  const d = { id: 'draft', updated_at: null, workflow_resolved: projection('needs_attention') };
  assert.equal(workflowPollingMode({ ...d, workflow_resolved: { ...d.workflow_resolved, lookupUnavailable: true } }), 'reconcile');
  assert.equal(workflowPollingMode({ ...d, workflow_resolved: { ...d.workflow_resolved, branches: { mediref: 'active' } } }), 'reconcile');
  assert.equal(workflowPollingMode({ ...d, workflow_resolved: projection('not_started') }), null);
  assert.equal(workflowPollingMode({ ...d, workflow_status: 'running', workflow_resolved: projection('completed') }), null);
});
test('hidden page pauses requests; visibility return reconciles immediately', async t => {
  const target = new EventTarget(); let hidden = true;
  const old = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(target, { get hidden() { return hidden; } }) });
  // Object.assign copies the getter value; make visibility mutable explicitly.
  Object.defineProperty(target, 'hidden', { configurable: true, get: () => hidden });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'document', old); else Reflect.deleteProperty(globalThis, 'document'); });
  const f = fixture(t); await f.advance(20000); assert.equal(f.lists(), 0);
  hidden = false; target.dispatchEvent(new Event('visibilitychange')); await settle(); assert.equal(f.lists(), 1);
});
test('Resume eligibility is revised from authoritative projection and rejected submission closes confirmation', () => {
  const button = readFileSync('components/report-writing/ResumeWorkflowButton.tsx', 'utf8');
  assert.match(button, /\[draftId, revision\]/);
  assert.match(button, /if \(!response.ok \|\| result.success !== true\) \{\s*setConfirming\(false\);\s*setEligible\(false\);\s*onQueued\(\)/);
  const page = readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx', 'utf8');
  assert.match(page, /revision=\{JSON.stringify\(\[draft.workflow_status, draft.updated_at, draft.workflow_resolved\]\)\}/);
  assert.match(page, /onQueued=\{\(\) => reconcileWorkflowAction\(draft.id\)\}/);
});

for (const accepted of [true, false]) test('actual Resume submission reconciles on ' + (accepted ? 'acceptance' : 'rejection'), async () => {
  const source = readFileSync('components/report-writing/ResumeWorkflowButton.tsx', 'utf8');
  const ast = ts.createSourceFile('button.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn!: ts.FunctionDeclaration;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'resume') fn = node; ts.forEachChild(node, visit); };
  visit(ast);
  let reconciles = 0, confirming = true, eligible = true;
  const run = runInNewContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nresume', {
    eligible: true, confirming: true, busy: false, submitting: { current: false }, draftId: 'fixture',
    setBusy() {}, setMessage() {}, setConfirming: (v: boolean) => { confirming = v; }, setEligible: (v: boolean) => { eligible = v; },
    onQueued: () => { reconciles++; }, fetch: async () => Response.json({ success: accepted }, { status: accepted ? 200 : 409 }),
  });
  await run(); assert.equal(reconciles, 1); assert.equal(confirming, false); assert.equal(eligible, false);
});
