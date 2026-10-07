import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { shouldAppearInApproved, type WorkflowDraft } from './resolved-workflow';

const source = readFileSync(resolve(process.env.TYPIST_CANDIDATE_ROOT || '.', 'app/(protected)/report-writing/typist/TypistPage.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
const fn = (name: string) => nodes.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
const pollRefresh = nodes.find((n): n is ts.PropertyAssignment => ts.isPropertyAssignment(n) && n.name.getText(ast) === 'refresh' && n.getText(ast).includes('get-drafts') || ts.isPropertyAssignment(n) && n.name.getText(ast) === 'refresh' && n.getText(ast).includes('loadDrafts'))!;
const mount = nodes.find((n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect' && n.arguments[0]?.getText(ast).includes('draftListMountedRef.current = true'));
type Row = WorkflowDraft & { id: string; provider_id: string };
const rows = (completed: boolean, ids = ['one']): Row[] => ids.map(id => ({ id, provider_id: 'provider', status: 'uploaded_to_praktika', workflow_status: 'completed', workflow_resolved: { status: completed ? 'completed' : 'needs_attention', branches: { praktika: 'completed', icon: 'skipped', mediref: completed ? 'completed' : 'unknown', periodontal: 'skipped' }, lookupUnavailable: false, message: null, lastProgressAt: null, praktikaRecovery: false, medirefRecovery: false } }));
function fixture() {
  const pending: Array<{ resolve: (r: Response) => void; reject: (e: Error) => void }> = [];
  let state = rows(false), selected = state[0], error: string | null = null, writes = 0, restarts = 0;
  const provider = { current: 'provider' }, token = { current: 1 }, mounted = { current: true }, sequence = { current: 0 };
  const code = [fn('isCurrentProviderDataRequest').getText(ast), fn('loadDrafts').getText(ast), fn('reconcileWorkflowAction').getText(ast),
    `const refresh = ${pollRefresh.initializer.getText(ast)};`,
    `const unmount = ${mount ? '(' + mount.arguments[0].getText(ast) + ')()' : '() => { draftListMountedRef.current = false; }'};`,
    '({loadDrafts, refresh, reconcileWorkflowAction, unmount})'].join('\n');
  const api = runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    patientSaveChainsRef: { current: new Map() }, providerDataRequestRef: token, selectedProviderIdRef: provider, draftListMountedRef: mounted, draftListRequestSequenceRef: sequence,
    selectedProviderId: 'provider', requestToken: 1, recentWorkflowActions: { current: new Map() },
    setWorkflowReconciliationEpoch: () => { restarts++; },
    fetch: () => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject })),
    setDrafts: (next: Row[]) => { state = next; writes++; },
    setSelectedDraft: (update: (r: Row) => Row) => { selected = update(selected); },
    mergeDraftWorkflow: (current: Row, item: Row) => ({ ...current, ...item }),
    setDraftListError: (next: string | null) => { error = next; },
  }) as { loadDrafts: (provider: string, token?: number, options?: { quiet?: boolean; signal?: AbortSignal }) => Promise<unknown>; refresh: (signal: AbortSignal) => Promise<void>; reconcileWorkflowAction: (id: string) => void; unmount: () => void };
  return { ...api, pending, provider, token, state: () => state, selected: () => selected, error: () => error, writes: () => writes, restarts: () => restarts,
    reply: (index: number, completed: boolean, ids = ['one']) => pending[index].resolve(Response.json({ success: true, drafts: rows(completed, ids) })) };
}

test('actual loadDrafts rejects older Needs-attention response after newer completion and keeps Approved empty', async () => {
  const f = fixture(); const old = f.loadDrafts('provider'), newer = f.loadDrafts('provider');
  f.reply(1, true); await newer; assert.equal(f.state().filter(shouldAppearInApproved).length, 0);
  f.reply(0, false); await old;
  assert.equal(f.writes(), 1); assert.equal(f.state().filter(shouldAppearInApproved).length, 0);
  assert.equal(f.selected().workflow_resolved?.status, 'completed');
});
test('newer failure invalidates pending older success and preserves current error and list', async () => {
  const f = fixture(); const old = f.loadDrafts('provider'), newer = f.loadDrafts('provider');
  f.pending[1].reject(new Error('synthetic failure')); await newer; const error = f.error(); assert.ok(error);
  f.reply(0, true); await old; assert.equal(f.writes(), 0); assert.equal(f.error(), error);
});
test('older failure cannot display obsolete error after newer success', async () => {
  const f = fixture(); const old = f.loadDrafts('provider'), newer = f.loadDrafts('provider');
  f.reply(1, true); await newer; f.pending[0].reject(new Error('old failure')); await old;
  assert.equal(f.error(), null); assert.equal(f.writes(), 1);
});
test('provider switch rejects old provider and context responses, including return to same provider', async () => {
  const f = fixture(); const old = f.loadDrafts('provider'); f.provider.current = 'other'; f.token.current++;
  await f.loadDrafts('provider'); assert.equal(f.pending.length, 1);
  f.provider.current = 'provider'; f.token.current++; f.reply(0, false); await old; assert.equal(f.writes(), 0);
});
test('actual unmount cleanup invalidates pending success and failure', async () => {
  for (const failed of [false, true]) {
    const f = fixture(); const request = f.loadDrafts('provider'); f.unmount();
    if (failed) f.pending[0].reject(new Error('late')); else f.reply(0, true);
    await request; assert.equal(f.writes(), 0); assert.equal(f.error(), null);
  }
});
test('Resume/Complete action refresh overlapping actual polling callback shares response order', async () => {
  const f = fixture(); const scheduled = f.refresh(new AbortController().signal);
  f.reconcileWorkflowAction('one'); assert.equal(f.restarts(), 1);
  f.reply(1, true); await new Promise(r => setImmediate(r));
  f.reply(0, false); await scheduled;
  assert.equal(f.writes(), 1); assert.equal(f.state().filter(shouldAppearInApproved).length, 0);
});
test('provider-wide completion response reconciles multiple cards without stale restoration', async () => {
  const f = fixture(); const old = f.loadDrafts('provider'), newer = f.loadDrafts('provider');
  f.reply(1, true, ['one', 'two', 'three']); await newer;
  f.reply(0, false, ['one', 'two', 'three']); await old;
  assert.equal(f.state().length, 3); assert.equal(f.state().filter(shouldAppearInApproved).length, 0); assert.equal(f.writes(), 1);
});
test('aborted polling response does not change list or errors', async () => {
  const f = fixture(); const controller = new AbortController(); const request = f.refresh(controller.signal);
  controller.abort(); f.reply(0, true); await request; assert.equal(f.writes(), 0); assert.equal(f.error(), null);
});
test('every authoritative get-drafts call in Typist uses common loader; no loading/finally mutations', () => {
  assert.equal((source.match(/\/api\/report-writing\/get-drafts\?/g) || []).length, 1);
  const loader = fn('loadDrafts').getText(ast); assert.doesNotMatch(loader, /setLoading|finally|setWorkflowReconciliationEpoch|setSelectedProvider/);
  assert.match(source, /loadDrafts\(params.providerId, undefined, \{ quiet: true \}\)/);
});
