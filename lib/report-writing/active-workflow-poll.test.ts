import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { startActiveWorkflowPolling, activeWorkflowBatchSize } from './active-workflow-poll';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(t: TestContext, count = 1, status = 'running') {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const drafts = Array.from({ length: count }, (_, i) => ({ id: String(i), workflow_status: status, updated_at: 'revision-1' }));
  const calls: string[] = []; let refreshes = 0, failure = false, hold: Promise<void> | undefined;
  let responseRows = drafts.map(d => ({ ...d }));
  const stop = startActiveWorkflowPolling({ drafts, providerId: 'provider',
    fetch: (async (url: string) => {
      calls.push(url); if (hold) await hold;
      const ids = new URL(url, 'https://fixture.invalid').searchParams.get('ids')!.split(',');
      return Response.json({ success: !failure, drafts: responseRows.filter(d => ids.includes(d.id)) }, { status: failure ? 503 : 200 });
    }) as typeof fetch,
    refresh: async () => { refreshes++; },
  });
  return { calls, stop, drafts, refreshes: () => refreshes,
    fail: () => { failure = true; }, hold: (p: Promise<void>) => { hold = p; },
    change: (status: string) => { responseRows = responseRows.map(d => ({ ...d, workflow_status: status })); },
    revision: () => { responseRows = responseRows.map(d => ({ ...d, updated_at: 'revision-2' })); },
    tick: async () => { t.mock.timers.tick(5000); await settle(); } };
}
test('no running workflow schedules no status or list requests', async t => {
  const f = fixture(t, 3, 'completed'); await f.tick(); assert.equal(f.calls.length, 0); assert.equal(f.refreshes(), 0);
});
for (const count of [1, 3]) test(`${count} running workflows use one lightweight request and unchanged state never reloads list`, async t => {
  const f = fixture(t, count); await f.tick(); assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /\/active-workflow-status\?/); assert.equal(new URL(f.calls[0], 'https://fixture.invalid').searchParams.get('ids')!.split(',').length, count);
  await f.tick(); assert.equal(f.refreshes(), 0); f.stop();
});
for (const status of ['completed', 'failed', 'waiting_for_authentication']) test(`running to ${status} causes exactly one list refresh`, async t => {
  const f = fixture(t, 3); f.change(status); await f.tick(); assert.equal(f.refreshes(), 1);
  await f.tick(); assert.equal(f.refreshes(), 1); assert.ok(f.drafts.every(d => d.workflow_status === 'running')); f.stop();
});
test('revision changes refresh once even while still running', async t => {
  const f = fixture(t); f.revision(); await f.tick(); await f.tick(); assert.equal(f.refreshes(), 1); f.stop();
});
test('lookup failure preserves state and does not refresh or execute anything', async t => {
  const f = fixture(t); f.fail(); await f.tick(); await f.tick(); assert.equal(f.refreshes(), 0); assert.equal(f.drafts[0].workflow_status, 'running'); f.stop();
});
test('slow polls do not overlap and stopping ignores late responses', async t => {
  const f = fixture(t); let release!: () => void; f.hold(new Promise<void>(r => { release = r; }));
  await f.tick(); await f.tick(); await f.tick(); assert.equal(f.calls.length, 1);
  f.change('completed'); f.stop(); release(); await settle(); await f.tick(); assert.equal(f.calls.length, 1); assert.equal(f.refreshes(), 0);
});
test('large active sets rotate bounded batches without dropping IDs', async t => {
  const f = fixture(t, activeWorkflowBatchSize + 1); await f.tick(); await f.tick();
  const ids = f.calls.map(url => new URL(url, 'https://fixture.invalid').searchParams.get('ids')!.split(','));
  assert.equal(ids[0].length, activeWorkflowBatchSize); assert.equal(ids[1].length, 1); assert.equal(new Set(ids.flat()).size, activeWorkflowBatchSize + 1); f.stop();
});

const routePath = 'app/api/report-writing/active-workflow-status/route.ts';
const route = readFileSync(routePath, 'utf8');
const ast = ts.createSourceFile(routePath, route, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'GET')!;
const code = ts.transpileModule(fn.getText(ast).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class AuthError extends Error { constructor(public status: number) { super('PRIVATE'); } }
const id = '11111111-1111-4111-8111-111111111111';
function routeFixture(role = 'typist', active = true) {
  const calls: Array<{ table: string; select?: string; eq: unknown[][] }> = [];
  const state = { provider: true, error: false };
  const get = runInNewContext(code + '\nGET', {
    NextResponse: { json: Response.json }, ApiAuthorizationError: AuthError, URL, AbortSignal, activeWorkflowBatchSize,
    headers: { 'Cache-Control': 'private, no-store' },
    requireActiveApiUser: async (roles: string[]) => {
      if (['anon', 'invalid'].includes(role)) throw new AuthError(401);
      if (!active || !roles.includes(role)) throw new AuthError(403);
    },
    supabaseAdmin: { from: (table: string) => {
      assert.ok(['providers', 'report_drafts'].includes(table));
      const call: { table: string; select?: string; eq: unknown[][] } = { table, eq: [] }; calls.push(call);
      const result = () => ({ data: table === 'providers' ? state.provider ? { id } : null : [{ id, workflow_status: 'running', updated_at: 'revision' }], error: state.error ? { message: 'PRIVATE' } : null });
      const q: any = { select: (s: string) => { call.select = s; return q; }, eq: (...args: unknown[]) => { call.eq.push(args); return q; },
        is: () => q, in: () => q, limit: (n: number) => { assert.equal(n, activeWorkflowBatchSize); return q; }, abortSignal: () => q,
        maybeSingle: async () => result(), then: (resolve: any) => Promise.resolve(result()).then(resolve) };
      return q;
    } },
  });
  return { calls, state, get: (query = `providerId=${id}&ids=${id}`) => get(new Request(`https://fixture.invalid?${query}`)) as Promise<Response> };
}
for (const role of ['admin', 'super_admin', 'practice_manager', 'typist']) test(`active ${role} reads only scoped minimal markers`, async () => {
  const f = routeFixture(role); const r = await f.get(); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].select, 'id,workflow_status,updated_at');
  assert.deepEqual(f.calls[1].eq, [['provider_id', id]]); assert.deepEqual(Object.keys((await r.json()).drafts[0]), ['id', 'workflow_status', 'updated_at']);
});
for (const role of ['anon', 'invalid', 'staff', 'billing_staff', 'provider_readonly']) test(`${role} denied before data access`, async () => {
  const f = routeFixture(role); assert.equal((await f.get()).status, ['anon', 'invalid'].includes(role) ? 401 : 403); assert.equal(f.calls.length, 0);
});
test('inactive user and inactive provider denied', async () => {
  const f = routeFixture('typist', false); assert.equal((await f.get()).status, 403); assert.equal(f.calls.length, 0);
  const g = routeFixture(); g.state.provider = false; assert.equal((await g.get()).status, 403); assert.equal(g.calls.length, 1);
});
for (const query of ['', `providerId=${id}&ids=bad`, `providerId=${id}&ids=${id},${id}`, `providerId=${id}&ids=${Array(51).fill(id).join(',')}`]) test(`invalid/bounded request rejected: ${query.length}`, async () => {
  const f = routeFixture(); assert.equal((await f.get(query)).status, 400); assert.equal(f.calls.length, 0);
});
test('database failure is sanitized', async () => {
  const f = routeFixture(); f.state.error = true; const r = await f.get(); assert.equal(r.status, 503); assert.doesNotMatch(await r.text(), /PRIVATE/);
});
test('Typist integration retains normal list loads and detail merge; poll lifecycle is scoped to active IDs', () => {
  const source = readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx', 'utf8');
  const block = source.slice(source.indexOf('  const activeWorkflowDrafts'), source.indexOf('  async function loadDrafts'));
  assert.match(block, /if \(!selectedProviderId \|\| !activeWorkflowIds\) return/);
  assert.match(block, /return startActiveWorkflowPolling/); assert.match(block, /\[selectedProviderId, activeWorkflowIds\]/);
  assert.match(block, /mergeDraftWorkflow\(current, item\)/); assert.match(block, /isCurrentProviderDataRequest/);
  assert.match(source, /async function loadDrafts\(providerId: string, requestToken\?: number\)/);
  assert.match(source, /approvedWorkflow\(draft\).praktikaRecovery/);
  assert.doesNotMatch(route, /\.rpc\(|\.update\(|\.insert\(|projectWorkflowRecovery|create.*Job|\.storage/);
});
