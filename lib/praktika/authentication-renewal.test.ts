import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import type { BrowserContext } from 'playwright';
import { createPraktikaAuthenticationGate, startPraktikaAuthenticationRenewal, validateGstResponse, probePraktikaAuthentication, PraktikaAuthenticationUnverified } from './authentication-probe';
import { PraktikaOwnershipLost } from './helper-lease';
import { derivePraktikaConnection } from './authentication';

function fixture() {
  const row = { status: 'connected', helper_instance_id: 'owner', helper_heartbeat_at: new Date().toISOString(), authenticated_at: new Date().toISOString() as string | null };
  let probes = 0, successes = 0, failures = 0, lost = false;
  let result = validateGstResponse(200, true, '[]');
  let delay: Promise<void> = Promise.resolve();
  const gate = createPraktikaAuthenticationGate({
    assertOwned: async () => { if (lost) throw new PraktikaOwnershipLost(); },
    readOwnedSession: async () => row,
    probe: async () => { probes++; await delay; return result; },
    recordSuccess: async () => { successes++; row.authenticated_at = new Date().toISOString(); },
    recordFailure: async phase => { failures++; row.authenticated_at = null; row.status = phase; },
  });
  return { row, gate, stats: () => ({ probes, successes, failures }), fail: (body = '') => { result = validateGstResponse(500, true, body); },
    delay: (promise: Promise<void>) => { delay = promise; }, lose: () => { lost = true; } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('early renewal probes fresh proof and shares transport with job verification', async () => {
  const f = fixture(); await f.gate(); assert.equal(f.stats().probes, 0);
  let resolve!: () => void; f.delay(new Promise(r => { resolve = r; }));
  const renewal = f.gate.renew(); await flush(); const job = f.gate();
  assert.equal(f.stats().probes, 1); resolve(); await Promise.all([renewal, job]);
  assert.deepEqual(f.stats(), { probes: 1, successes: 1, failures: 0 });
});

test('transient renewal failure preserves proof; strict stale job still blocks', async () => {
  const f = fixture(); f.fail(); const proof = f.row.authenticated_at;
  await assert.rejects(f.gate.renew(), PraktikaAuthenticationUnverified);
  assert.equal(f.row.authenticated_at, proof); assert.equal(f.row.status, 'connected');
  assert.equal(derivePraktikaConnection(f.row).connected, true);
  const future = Date.now() + 121000;
  assert.equal(derivePraktikaConnection({ ...f.row, helper_heartbeat_at: new Date(future).toISOString() }, future).connected, false);
  f.row.authenticated_at = null;
  await assert.rejects(f.gate(), PraktikaAuthenticationUnverified);
  assert.deepEqual(f.stats(), { probes: 2, successes: 0, failures: 1 });
});
for (const [body, phase] of [['<input type="password">', 'waiting_for_credentials'], ['<input autocomplete="one-time-code">', 'waiting_for_mfa']]) {
  test('renewal immediately surfaces ' + phase, async () => {
    const f = fixture(); f.fail(body); await assert.rejects(f.gate.renew());
    assert.equal(f.row.authenticated_at, null); assert.equal(f.row.status, phase);
  });
}
for (const action of ['shutdown', 'replacement', 'login']) {
  test(action + ' rejects late renewal results', async () => {
    const f = fixture(); let resolve!: () => void;
    f.delay(new Promise(r => { resolve = r; }));
    const pending = f.gate.renew(); const rejected = assert.rejects(pending); await flush();
    let draining: Promise<void> | undefined;
    if (action === 'shutdown') f.gate.stop();
    if (action === 'replacement') f.lose();
    if (action === 'login') draining = f.gate.invalidate();
    resolve(); await rejected; await draining;
    assert.equal(f.stats().successes, 0); assert.equal(f.stats().failures, 0);
  });
}

test('scheduler renews at 60s, retries once at 15s then backs off 60s, stops cleanly', async () => {
  let now = 1000000, proof = now, attempts = 0, fail = true, eligible = true;
  const scheduler = startPraktikaAuthenticationRenewal({ now: () => now,
    readSession: async () => ({ authenticated_at: new Date(proof).toISOString() }),
    eligible: async () => eligible, stopGate() {},
    renew: async () => { attempts++; if (fail) throw new PraktikaAuthenticationUnverified(); proof = now; },
  });
  try {
    await scheduler.tick(); assert.equal(attempts, 0);
    now += 60000; await scheduler.tick(); assert.equal(attempts, 1);
    now += 14999; await scheduler.tick(); assert.equal(attempts, 1);
    now++; await scheduler.tick(); assert.equal(attempts, 2);
    now += 15000; await scheduler.tick(); assert.equal(attempts, 2);
    now += 45000; fail = false; await scheduler.tick(); assert.equal(attempts, 3);
    now += 60000; await scheduler.tick(); assert.equal(attempts, 4);
    assert.equal(now - proof, 0); // renewal continued beyond original 120s proof
    eligible = false; now += 60000; await scheduler.tick(); assert.equal(attempts, 4);
    scheduler.stop(); eligible = true; await scheduler.tick(); assert.equal(attempts, 4);
  } finally { scheduler.stop(); }
});

test('transport rejection settles before another GST starts', async () => {
  const f = fixture(); let reject!: (e: Error) => void; let transports = 0;
  const context = { request: { post: () => { transports++; return new Promise((_r, rej) => { reject = rej; }); } } } as unknown as BrowserContext;
  const gate = createPraktikaAuthenticationGate({ assertOwned: async () => {}, readOwnedSession: async () => ({...f.row, authenticated_at: null}),
    probe: () => probePraktikaAuthentication(context, '42', 'https://fixture.invalid'), recordSuccess: async () => {}, recordFailure: async () => {} });
  const a = gate.renew(); await flush(); const b = gate();
  assert.equal(transports, 1);
  const done = Promise.allSettled([a, b]); reject(new Error('Timeout fixture')); await done;
  const c = gate(); await flush(); assert.equal(transports, 2);
  const end = assert.rejects(c); reject(new Error('Timeout fixture')); await end;
  const source = readFileSync('lib/praktika/authentication-probe.ts', 'utf8');
  assert.doesNotMatch(source, /Promise\.race/);
});

test('helper stops renewal before release and leaves useful-work idle accounting untouched', () => {
  const source = readFileSync('scripts/refresh-praktika-session.ts', 'utf8');
  assert.match(source, /async function releaseOwnership[^]*?renewal\?\.stop\(\)/);
  assert.match(source, /context.once\("close", \(\) => renewal\?\.stop\(\)\)/);
  const scheduler = source.slice(source.indexOf('renewal = startPraktikaAuthenticationRenewal'), source.indexOf('context.once("close"'));
  assert.doesNotMatch(scheduler, /lastUsefulWorkAt/);
  assert.match(scheduler, /loginTransition/);
});

test('login suspension prevents a queued tick from starting a probe until resumed', async () => {
  const f = fixture(); await f.gate.invalidate();
  await assert.rejects(f.gate.renew()); await assert.rejects(f.gate());
  assert.equal(f.stats().probes, 0);
  f.gate.resume(); await f.gate.renew(); assert.equal(f.stats().successes, 1);
});

test('successful periodic proof keeps effective connection beyond original expiry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 2000000 });
  const f = fixture();
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(60000);
    f.row.helper_heartbeat_at = new Date().toISOString();
    await f.gate.renew();
    assert.equal(derivePraktikaConnection(f.row).connected, true);
  }
  assert.equal(f.stats().successes, 4);
});
