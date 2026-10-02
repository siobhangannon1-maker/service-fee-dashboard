import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { WriteAuthCooldown, WRITE_AUTH_COOLDOWN_MS } from './write-auth-cooldown';
import { PraktikaHelperUnavailable, PraktikaOwnershipLost } from './helper-lease';

const source = readFileSync('scripts/refresh-praktika-session.ts', 'utf8');
const ast = ts.createSourceFile('helper.ts', source, ts.ScriptTarget.Latest, true);
const names = ['writeAuthCooldown', 'invalidateWriteAuthCooldown', 'isConfirmedRefreshTransition', 'ensureWriteAuthenticated', 'canClaimWriteJobs'];
const code = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name!.text))
  .map(n => ts.transpileModule(n.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText).join('\n');
function fixture() {
  let now = 1000, probes = 0, sleeps = 0, checks = 0, owns = true;
  let result: Record<string, unknown> = { verified: false, httpStatus: 307, redirectDiagnostics: { refreshTransition: true } };
  let afterProbe = () => {};
  const logs: unknown[] = [], writes: unknown[] = [];
  const ctx = {
    stopRefreshObservation: () => {}, pooledExecutionEnabled: () => false, PraktikaHelperUnavailable, PraktikaOwnershipLost,
    WriteAuthCooldown: class extends WriteAuthCooldown { constructor(emit: ConstructorParameters<typeof WriteAuthCooldown>[0]) { super(emit, () => now); } },
    process: { env: { PRAKTIKA_PRACTICE_ID: '1181' } }, PRAKTIKA_BASE_URL: 'https://fixture.invalid',
    WRITE_AUTH_REFRESH_RETRIES: 2, WRITE_AUTH_REFRESH_RETRY_MS: 2000,
    assertOwned: async () => { checks++; if (!owns) throw new PraktikaOwnershipLost(); },
    ownedWrite: async (action: string, values: unknown) => { writes.push({ action, values }); },
    probePraktikaAuthentication: async () => { probes++; afterProbe(); return result; },
    sleep: async () => { sleeps++; }, console: { log: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a) },
  };
  const api = runInNewContext(`let ownedContext = {}, writeAuthBinding, writeAuthEpoch=0, writeAuthUserId='user', sessionId='session', helperInstanceId='generation', shuttingDown=false, ownershipLost=false, browserReady=true;
    ${code}
    ({fence:ensureWriteAuthenticated,claim:canClaimWriteJobs,state:writeAuthCooldown,
      change:(kind)=>{ if(kind==='context')ownedContext={};if(kind==='user')writeAuthUserId='other';if(kind==='session')sessionId='other';if(kind==='generation')helperInstanceId='other';if(kind==='shutdown')shuttingDown=true; },
      ready:()=>browserReady})`, ctx);
  return { api, logs, writes, probes: () => probes, sleeps: () => sleeps, checks: () => checks,
    advance: () => { now += WRITE_AUTH_COOLDOWN_MS; }, set: (r: Record<string, unknown>) => { result = r; },
    lose: () => { owns = false; }, afterProbe: (fn: () => void) => { afterProbe = fn; } };
}
const positive = { verified: true, httpStatus: 200 };

test('exhausted recognized refresh transition blocks N writes with one cycle, not N cycles', async () => {
  const f = fixture(); await assert.rejects(f.api.fence(), PraktikaHelperUnavailable);
  assert.equal(f.probes(), 3); assert.equal(f.sleeps(), 2);
  for (let i = 0; i < 40; i++) assert.equal(await f.api.claim(), false);
  assert.equal(f.probes(), 3); assert.ok(f.probes() < 40 * 3);
  await assert.rejects(f.api.fence(), PraktikaHelperUnavailable); assert.equal(f.probes(), 3);
});
test('one shared expiry revalidation renews cooldown; accepted 200 clears it without authorizing later writes', async () => {
  const f = fixture(); await assert.rejects(f.api.fence()); f.advance();
  assert.deepEqual(await Promise.all([f.api.claim(), f.api.claim(), f.api.claim()]), [false, false, false]);
  assert.equal(f.probes(), 6); assert.equal(await f.api.claim(), false); assert.equal(f.probes(), 6);
  f.advance(); f.set(positive);
  assert.deepEqual(await Promise.all([f.api.claim(), f.api.claim()]), [true, true]); assert.equal(f.probes(), 7);
  await f.api.fence(); assert.equal(f.probes(), 8);
});
for (const kind of ['context', 'user', 'session', 'generation']) test(`${kind} replacement never inherits negative state or positive proof`, async () => {
  const f = fixture(); await assert.rejects(f.api.fence()); const old = f.api.state();
  f.api.change(kind); assert.equal(await f.api.claim(), true); assert.equal(await old.canClaim(async () => {}), false);
  f.set(positive); await f.api.fence(); assert.equal(f.probes(), 4);
});
for (const phase of ['waiting_for_credentials', 'waiting_for_mfa']) test(`${phase} preserves explicit challenge handling`, async () => {
  const f = fixture(); await assert.rejects(f.api.fence()); f.advance(); f.set({ phase, verified: false, httpStatus: 200 });
  assert.equal(await f.api.claim(), false); assert.equal(f.api.ready(), false);
  assert.ok(JSON.stringify(f.writes).includes(phase)); const n = f.probes();
  assert.equal(await f.api.claim(), false); assert.equal(f.probes(), n);
});
test('ownership loss and shutdown fence expiry revalidation', async () => {
  const f = fixture(); await assert.rejects(f.api.fence()); f.advance(); f.lose();
  await assert.rejects(f.api.claim(), PraktikaOwnershipLost); assert.equal(f.probes(), 3);
  f.api.change('shutdown'); assert.equal(await f.api.claim(), false); assert.equal(f.probes(), 3);
});
test('context replacement during proof cannot authenticate the replacement', async () => {
  const f = fixture(); f.set(positive); f.afterProbe(() => f.api.change('context'));
  await assert.rejects(f.api.fence(), PraktikaOwnershipLost); assert.equal(f.writes.length, 0);
});
test('unrelated unverified response does not initiate refresh cooldown', async () => {
  const f = fixture(); f.set({ verified: false, httpStatus: 500, body: 'PRIVATE' });
  await assert.rejects(f.api.fence()); assert.equal(await f.api.claim(), true); assert.equal(f.probes(), 1);
  assert.doesNotMatch(JSON.stringify(f.logs), /PRIVATE/);
});
test('proof-age observation is sanitized and disappears on invalidation', () => {
  let now = 100; const logs: unknown[] = [];
  const s = new WriteAuthCooldown((event, fields) => logs.push({ event, ...fields }), () => now);
  s.verified(); now += 30;
  s.writeCompleted({ id: 'PRIVATE', job_type: 'PRIVATE value', created_at: 'PRIVATE' });
  assert.match(JSON.stringify(logs), /"proofAgeMs":30/); assert.doesNotMatch(JSON.stringify(logs), /PRIVATE/);
  s.invalidate(); const n = logs.length; s.writeCompleted({ id: 'job', job_type: 'upload_report_to_praktika' }); assert.equal(logs.length, n);
});
test('logout, login, shutdown and browser closure invalidate generation observation', () => {
  for (const name of ['updateSession', 'markBrowserReady', 'shutdown']) {
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
    assert.match(fn.getText(ast), /invalidateWriteAuthCooldown\(\)/);
  }
  assert.match(source, /context.once\("close", \(\) => \{ invalidateWriteAuthCooldown\(\)/);
  assert.match(source, /page.once\("close", \(\) => \{ invalidateWriteAuthCooldown\(\)/);
});
