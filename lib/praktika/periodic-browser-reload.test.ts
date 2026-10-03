import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync('scripts/refresh-praktika-session.ts', 'utf8');
const tree = ts.createSourceFile('helper.ts', source, ts.ScriptTarget.Latest, true);
const loop = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'keepBrowserOpenForever') as ts.FunctionDeclaration;
let activity!: ts.IfStatement;
function visit(n: ts.Node) {
  if (ts.isIfStatement(n) && n.expression.getText(tree) === 'now - lastRealActivityAt >= REAL_ACTIVITY_INTERVAL_MS') activity = n;
  ts.forEachChild(n, visit);
}
visit(loop);
const block = activity.getText(tree);
const code = ts.transpileModule('async function activity(now) {' + block + '} activity', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture() {
  const calls: unknown[] = [];
  const scope = {
    REAL_ACTIVITY_INTERVAL_MS: 300000, lastRealActivityAt: 0, browserReady: true,
    shuttingDown: false, ownershipLost: false, Error, console: { warn: (message: string) => calls.push(message) },
    checkBrowserAvailability: async () => true,
    page: { isClosed: () => false, reload: async (options: unknown) => { calls.push(options); },
      waitForTimeout: async (ms: number) => { calls.push(ms); } },
  };
  return { calls, scope, run: runInNewContext(code, scope) };
}
test('periodic activity dispatches one document reload and one settle with exact options', async () => {
  const f = fixture(); await f.run(300000);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ waitUntil: 'domcontentloaded', timeout: 30000 }, 2500]);
  await f.run(300001); assert.equal(f.calls.length, 2);
  await f.run(600000); assert.equal(f.calls.length, 4);
  assert.match(source, /REAL_ACTIVITY_INTERVAL_MS[\s\S]*?PRAKTIKA_REAL_ACTIVITY_INTERVAL_MS \|\| 5 \* 60_000/);
  assert.doesNotMatch(block, /fetch\(|evaluate\(|performRealBrowserActivity|setInterval|setTimeout/);
});
test('reload rejection consumes the interval, sanitizes failure, and does not settle or retry', async () => {
  const f = fixture(); let attempts = 0;
  f.scope.page.reload = async () => { attempts++; throw new Error('PRIVATE cookie patient timeout'); };
  await assert.rejects(f.run(300000), /^Error: Praktika periodic browser reload failed\.$/);
  await f.run(302000); await f.run(304000);
  assert.equal(attempts, 1); assert.deepEqual(f.calls, ['Praktika periodic browser reload failed.']);
});
test('closed context error retains existing lifecycle classification without raw error details', async () => {
  const f = fixture();
  f.scope.page.reload = async () => { throw new Error('Target page, context or browser has been closed PRIVATE'); };
  await assert.rejects(f.run(300000), /^Error: Praktika browser has been closed\.$/);
});
for (const state of ['notReady', 'closed', 'unavailable', 'shutdown', 'ownershipLost']) test('no reload when ' + state, async () => {
  const f = fixture();
  if (state === 'notReady') f.scope.browserReady = false;
  if (state === 'closed') f.scope.page.isClosed = () => true;
  if (state === 'unavailable') f.scope.checkBrowserAvailability = async () => false;
  if (state === 'shutdown') f.scope.shuttingDown = true;
  if (state === 'ownershipLost') f.scope.ownershipLost = true;
  await f.run(300000); assert.deepEqual(f.calls, []);
});
test('closure during availability check prevents dispatch', async () => {
  const f = fixture(); f.scope.checkBrowserAvailability = async () => { f.scope.page.isClosed = () => true; return true; };
  await f.run(300000); assert.deepEqual(f.calls, []);
});
test('real main loop awaits reload before drain and awaits drain before next reload', async () => {
  let resolveReload!: () => void, resolveWrite!: () => void;
  let drains = 0, reloads = 0, active = false;
  const scope = {
    process: { env: {} }, console: { log() {}, warn() {} }, Date: { now: () => 300000 },
    KEEP_ALIVE_INTERVAL_MS: 30000, HELPER_IDLE_POLL_INTERVAL_MS: 2000, REAL_ACTIVITY_INTERVAL_MS: 300000,
    HELPER_IDLE_SHUTDOWN_MS: 5400000, MEMORY_LOG_INTERVAL_MS: Infinity,
    usefulWorkDeadline: 1, shuttingDown: false, ownershipLost: false, browserReady: true, verificationRequested: false,
    remainingUsefulWorkMs: () => 1000, getSession: async () => ({ app_user_id: 'fixture', status: 'connected' }),
    checkBrowserAvailability: async () => true, isBrowserUiLoggedIn: async () => true, saveCookies: async () => {},
    drainAvailableHelperJobs: async () => { drains++; active = true; await new Promise<void>(r => resolveWrite = r); active = false;
      return { completedCount: 0, failedCount: 0, needsReconnect: false }; },
    sleep: async () => { scope.shuttingDown = true; },
  };
  const page = { isClosed: () => false, reload: async () => { assert.equal(active, false); reloads++;
      await new Promise<void>(r => resolveReload = r); }, waitForTimeout: async () => {} };
  const loopCode = ts.transpileModule(loop.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = runInNewContext(loopCode + '\nkeepBrowserOpenForever', scope);
  const pending = run({}, page);
  await new Promise(r => setImmediate(r)); assert.equal(reloads, 1); assert.equal(drains, 0);
  resolveReload(); await new Promise(r => setImmediate(r)); assert.equal(drains, 1); assert.equal(active, true);
  await new Promise(r => setImmediate(r)); assert.equal(reloads, 1);
  resolveWrite(); await pending; assert.equal(reloads, 1);
});
