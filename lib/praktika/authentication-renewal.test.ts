import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import type { BrowserContext } from 'playwright';
import { praktikaHelperToken, createPraktikaAuthenticationGate, startPraktikaAuthenticationRenewal, validateGstResponse, probePraktikaAuthentication, PraktikaAuthenticationUnverified } from './authentication-probe';
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
  assert.equal(derivePraktikaConnection({ ...f.row, helper_heartbeat_at: new Date(future).toISOString() }, future).connected, true);
  f.row.authenticated_at = null;
  await assert.rejects(f.gate(), PraktikaAuthenticationUnverified);
  assert.deepEqual(f.stats(), { probes: 2, successes: 0, failures: 0 });
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

test('generation token correlates redirect, failure, retry and later success without identity leakage', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 2000000 });
  const generation = 'PRIVATE-GENERATION';
  const token = praktikaHelperToken(generation);
  assert.match(token, /^[0-9a-f]{16}$/);
  assert.equal(praktikaHelperToken(generation), token);
  assert.notEqual(praktikaHelperToken('SECOND-GENERATION'), token);
  const row = { helper_instance_id: generation, helper_heartbeat_at: new Date().toISOString(), authenticated_at: new Date(Date.now()-60000).toISOString() };
  let succeeds = false;
  const context = { request: { post: async (url: string) => ({
    url: () => url, ok: () => succeeds, status: () => succeeds ? 200 : 307,
    headers: () => ({location: '/php/PRIVATE?cookie=PRIVATE#PRIVATE'}),
    body: async () => Buffer.from('[]'), dispose: async () => {},
  }) } } as unknown as BrowserContext;
  const gate = createPraktikaAuthenticationGate({ helperToken: token,
    assertOwned: async () => {}, readOwnedSession: async () => row,
    probe: () => probePraktikaAuthentication(context, '42', 'https://fixture.invalid'),
    recordSuccess: async () => { row.authenticated_at = new Date().toISOString(); },
    recordFailure: async () => assert.fail('307 must remain transient'),
  });
  const scheduler = startPraktikaAuthenticationRenewal({ helperToken: token,
    readSession: async () => row, eligible: async () => true, renew: gate.renew, stopGate: gate.stop });
  const logs: unknown[][] = []; const original = console.log;
  console.log = (...args) => { logs.push(args); };
  try {
    const proof = row.authenticated_at;
    await scheduler.tick(); assert.equal(row.authenticated_at, proof);
    succeeds = true; t.mock.timers.tick(15000); await scheduler.tick();
    assert.notEqual(row.authenticated_at, proof);
  } finally { scheduler.stop(); console.log = original; }
  for (const event of ['renewal_started','renewal_redirect','renewal_transient_failure','renewal_retry_scheduled','renewal_succeeded']) {
    const entries = logs.filter(([name]) => name === '[Praktika auth] ' + event);
    assert.ok(entries.length > 0, event);
    for (const [, fields] of entries) assert.equal((fields as {helperToken: string}).helperToken, token);
  }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|SECOND-GENERATION|fixture.invalid|\/php\/|cookie=/);
});

for (const [name, status, location, cookies, matched] of [
  ['exact',307,'/php/security/db_refreshToken.php',true,true],
  ['query',307,'/php/security/db_refreshToken.php?secret=x#x',true,true],
  ['no cookie',307,'/php/security/db_refreshToken.php',false,false],
  ['other',307,'/php/security/other.php',true,false],
  ['case',307,'/php/security/db_refreshtoken.php',true,false],
  ['external',307,'https://outside.invalid/php/security/db_refreshToken.php',true,false],
  ['other status',302,'/php/security/db_refreshToken.php',true,false],
  ['malformed',307,'https://[',true,false],
] as const) test('refresh transition: ' + name, async () => {
  const { isPraktikaRefreshTransition } = await import('./authentication-probe');
  assert.equal(isPraktikaRefreshTransition(status,location,'https://fixture.invalid/php/json/probe.php',cookies ? {'set-cookie':'SECRET=SECRET'} : {}),matched);
});

test('two fast original probes then normal cadence; no proof on 307; valid 200 recovers', async t => {
  const logs: unknown[][] = []; t.mock.method(console, 'log', (...args: unknown[]) => logs.push(args));
  let clock = 0, calls = 0, positive = false, writes = 0;
  const row = { status: 'connected', helper_instance_id:'owner',helper_heartbeat_at:new Date().toISOString(),authenticated_at:null as string|null };
  const context = { request: { post: async (url: string, options: {maxRedirects: number}) => {
    calls++; assert.equal(url,'https://fixture.invalid/php/json/db_reportingDataWarehouse.php'); assert.equal(options.maxRedirects,0);
    return {status:()=>positive?200:307,ok:()=>positive,url:()=>url,
      headers:()=>({'location':'/php/security/db_refreshToken.php?SECRET#SECRET','set-cookie':'SECRET=SECRET'}),
      body:async()=>Buffer.from('[]'),dispose:async()=>{}};
  }}} as unknown as BrowserContext;
  const gate = createPraktikaAuthenticationGate({ assertOwned:async()=>{},readOwnedSession:async()=>row,
    probe:()=>probePraktikaAuthentication(context,'1181','https://fixture.invalid'),
    recordSuccess:async()=>{writes++;row.authenticated_at=new Date().toISOString();},recordFailure:async()=>assert.fail('no negative session write') });
  const renewal = startPraktikaAuthenticationRenewal({helperToken:'token',readSession:async()=>row,eligible:async()=>true,renew:gate.renew,stopGate:gate.stop,now:()=>clock});
  try {
    await renewal.tick(); assert.equal(calls,1);
    clock=1999;await renewal.tick();assert.equal(calls,1);
    clock=2000;await renewal.tick();assert.equal(calls,2);
    clock=4000;await renewal.tick();assert.equal(calls,3);
    clock=6000;await renewal.tick();assert.equal(calls,3);
    clock=19000;await renewal.tick();assert.equal(calls,4);
    clock=21000;await renewal.tick();assert.equal(calls,4);
    assert.equal(writes,0);assert.equal(row.authenticated_at,null);assert.equal(derivePraktikaConnection(row).connected,true);
    positive=true;clock=79000;await renewal.tick();assert.equal(calls,5);assert.equal(writes,1);
    assert.equal(derivePraktikaConnection(row).connected,true);
    assert.doesNotMatch(JSON.stringify(logs),/SECRET|db_refreshToken|normalizedPath/);
  } finally {renewal.stop();}
});
