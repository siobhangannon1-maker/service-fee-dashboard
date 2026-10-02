import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { BrowserContext, Cookie } from 'playwright';
import { installRefreshObserver, observeKeepalive, observeProbeResponse, safeObserverPath, stopRefreshObservation } from './refresh-observer';
const origin = 'https://praktika.praktika.net.au';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(enabled = true) {
  let reads = 0;
  let jar: Cookie[] = ['PHPSESSID', 'UAT'].map(name => ({ name, value: 'SECRET', domain: 'praktika.praktika.net.au', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: -1 }));
  const context = Object.assign(new EventEmitter(), { cookies: async () => { reads++; return jar; }, pages: () => [] });
  const browser = context as unknown as BrowserContext;
  const logs: Record<string, unknown>[] = [];
  const options = { enabled, origin, generation: 'PRIVATE_GENERATION', emit: (e: Record<string, unknown>) => logs.push(e) };
  const observer = installRefreshObserver(browser, options);
  return { context, browser, logs, options, observer, reads: () => reads, setJar: (value: Cookie[]) => { jar = value; }, jar: () => jar,
    auth: () => stopRefreshObservation(browser, 'authenticated'),
    trigger: () => observeProbeResponse(browser, 'POST', origin + '/php/json/db_reportingDataWarehouse.php?SECRET', 307,
      { location: '/php/security/db_refreshToken.php?SECRET', 'set-cookie': 'PHPSESSID=SECRET; Secure; HttpOnly' }) };
}
const states = (f: ReturnType<typeof fixture>) => f.logs.filter(e => e.event === 'cookie_state');
test('disabled installs no listeners, emits nothing, samples no cookies', () => {
  const f = fixture(false); f.auth(); f.trigger(); assert.equal(f.observer, undefined); assert.equal(f.context.eventNames().length, 0); assert.equal(f.reads(), 0); assert.deepEqual(f.logs, []);
});
test('runtime flag remains exact true and success hook follows existing owned authentication', () => {
  const helper = readFileSync('scripts/refresh-praktika-session.ts', 'utf8');
  const probe = readFileSync('lib/praktika/authentication-probe.ts', 'utf8');
  assert.match(helper, /if \(process.env.PRAKTIKA_REFRESH_OBSERVER === "true"\)\s*\{\s*try \{ installRefreshObserver/);
  assert.match(probe, /if \(process.env.PRAKTIKA_REFRESH_OBSERVER === "true"\)/);
  assert.match(helper, /if \(result.verified && result.httpStatus === 200\)[\s\S]*?await ownedWrite\("authenticate"\)[\s\S]*?stopRefreshObservation\(ownedContext, 'authenticated'\)/);
});
test('installed registry survives login without sampling; existing strict authentication arms once', async () => {
  const f = fixture(); assert.equal(f.logs[0].event, 'installed'); assert.equal(f.reads(), 0);
  stopRefreshObservation(f.browser, 'credentials'); stopRefreshObservation(f.browser, 'mfa'); f.trigger();
  assert.equal(f.logs.length, 1); assert.equal(f.reads(), 0);
  f.auth(); await flush(); assert.equal(f.reads(), 1); assert.equal(f.logs.filter(e => e.event === 'armed').length, 1);
  f.auth(); assert.equal(f.reads(), 1); stopRefreshObservation(f.browser, 'shutdown');
  assert.equal(f.logs.at(-1)?.event, 'terminated'); assert.equal(f.logs.at(-1)?.triggered, false);
});
test('installation failure is sanitized and does not escape', () => {
  const logs: unknown[] = [];
  assert.doesNotThrow(() => installRefreshObserver({} as BrowserContext, { enabled: true, origin: 'not-a-url-SECRET', generation: 'PRIVATE', emit: e => logs.push(e) }));
  assert.deepEqual(logs, [{ event: 'installation_failed', reason: 'observer_setup_unavailable' }]);
});
test('arming failure detaches partial listeners and cannot change auth result', () => {
  const f = fixture(); f.context.pages = () => { throw Error('SECRET'); };
  assert.doesNotThrow(f.auth); assert.ok(f.logs.some(e => e.event === 'installation_failed'));
  assert.equal(f.context.eventNames().length, 0); assert.doesNotMatch(JSON.stringify(f.logs), /SECRET/);
});
test('healthy then failure after five minutes captures through explicit probe fallback exactly once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.auth(); await flush();
  t.mock.timers.tick(300_001);
  assert.equal(f.logs.at(-1)?.reason, 'timeout'); assert.equal(f.logs.at(-1)?.triggered, false);
  assert.equal(f.context.listenerCount('response'), 0);
  f.trigger(); await flush(); assert.equal(f.logs.filter(e => e.event === 'start').length, 1);
  assert.equal(f.logs.find(e => e.event === 'start')?.fallback, true); assert.equal(states(f).at(-1)?.baselineKnown, true);
  t.mock.timers.tick(15_001); const endCount = f.logs.length;
  for (let n = 0; n < 20; n++) { f.trigger(); f.auth(); t.mock.timers.tick(61_000); }
  assert.equal(f.logs.length, endCount); assert.equal(f.context.listenerCount('response'), 0);
  stopRefreshObservation(f.browser, 'shutdown');
});
test('initial capture plus at most one fallback, duplicate install cannot reset budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture(); f.auth(); await flush(); f.trigger(); await flush();
  t.mock.timers.tick(15_001); f.trigger(); await flush(); t.mock.timers.tick(15_001);
  assert.equal(installRefreshObserver(f.browser, f.options), f.observer); f.auth(); f.trigger();
  assert.equal(f.logs.filter(e => e.event === 'start').length, 2); stopRefreshObservation(f.browser, 'shutdown');
});
for (const [label, status, location, cookie] of [['other', 307, '/other', true], ['external', 307, 'https://outside.invalid/php/security/db_refreshToken.php', true], ['no-cookie', 307, '/php/security/db_refreshToken.php', false], ['302', 302, '/php/security/db_refreshToken.php', true], ['200', 200, '/php/security/db_refreshToken.php', true]] as const) {
  test(label + ' cannot start capture', async () => {
    const f = fixture(); f.auth(); await flush();
    observeProbeResponse(f.browser, 'POST', origin, status, { location, ...(cookie ? { 'set-cookie': 'SECRET' } : {}) });
    assert.ok(!f.logs.some(e => e.event === 'start')); stopRefreshObservation(f.browser, 'shutdown');
  });
}
test('required unchanged values, value change, identity change, attributes and additional cookie changes are safe', async () => {
  const f = fixture(); f.auth(); await flush(); f.trigger(); await flush();
  assert.equal(states(f).at(-1)?.requiredValueChanged, false); assert.equal(states(f).at(-1)?.requiredIdentityChanged, false);
  f.setJar(f.jar().map(c => ({ ...c, value: 'NEW_SECRET' }))); f.trigger(); await flush(); assert.equal(states(f).at(-1)?.requiredValueChanged, true);
  f.setJar(f.jar().map(c => ({ ...c, path: '/PRIVATE_PATH', expires: 123456 }))); f.trigger(); await flush(); assert.equal(states(f).at(-1)?.requiredIdentityChanged, true);
  f.setJar([{ ...f.jar()[0], name: 'PRIVATE_EXTRA', value: 'SECRET' }]); f.trigger(); await flush(); assert.equal(states(f).at(-1)?.additionalStateChanged, true);
  assert.doesNotMatch(JSON.stringify(f.logs), /SECRET|PRIVATE|fingerprint|cookieValue|query/); stopRefreshObservation(f.browser, 'shutdown');
});
test('attribute-only changes are distinct from value changes', async () => {
  const f = fixture(); f.auth(); await flush(); f.setJar(f.jar().map(c => ({ ...c, secure: false, expires: 1234 }))); f.trigger(); await flush();
  assert.equal(states(f).at(-1)?.attributesChanged, true); assert.equal(states(f).at(-1)?.requiredValueChanged, false); stopRefreshObservation(f.browser, 'shutdown');
});
test('missing or oversized baseline fails closed', async () => {
  const f = fixture(); f.context.cookies = async () => { throw Error('SECRET'); }; f.auth(); await flush();
  f.context.cookies = async () => f.jar(); f.trigger(); await flush(); assert.equal(states(f).at(-1)?.baselineKnown, false);
  f.setJar(Array.from({ length: 101 }, () => f.jar()[0])); f.trigger(); await flush();
  assert.ok(f.logs.some(e => e.event === 'cookie_observation_unavailable' && e.reason === 'cookie_limit')); stopRefreshObservation(f.browser, 'shutdown');
});
test('late baseline cannot be mislabeled as authenticated after trigger', async () => {
  const f = fixture(); let release!: (v: Cookie[]) => void;
  f.context.cookies = () => new Promise<Cookie[]>(r => { release = r; }); f.auth(); const baselineRelease = release;
  f.trigger(); baselineRelease(f.jar()); await flush(); release(f.jar()); await flush();
  assert.equal(states(f).at(-1)?.baselineKnown, false); stopRefreshObservation(f.browser, 'shutdown');
});
for (const reason of ['context_replaced', 'ownership_lost', 'shutdown', 'context_closed'] as const) test(reason + ' fences observer permanently and cleans listeners', async () => {
  const f = fixture(); f.auth(); await flush(); stopRefreshObservation(f.browser, reason);
  assert.equal(f.logs.at(-1)?.reason, reason); assert.equal(f.context.eventNames().length, 0);
  const count = f.logs.length; f.auth(); f.trigger(); installRefreshObserver(f.browser, f.options); assert.equal(f.logs.length, count);
});
test('context close event terminates; authentication ends capture without rearming', async () => {
  const f = fixture(); f.auth(); await flush(); f.trigger(); await flush(); f.auth();
  assert.equal(f.logs.at(-1)?.reason, 'authenticated'); assert.equal(f.logs.filter(e => e.event === 'armed').length, 1);
  f.context.emit('close'); assert.equal(f.context.eventNames().length, 0);
});
test('event budget detaches network listeners at 200; no traffic or mutations are needed', async () => {
  const f = fixture(); f.auth(); await flush(); f.trigger(); await flush();
  for (let n = 0; n < 250; n++) f.context.emit('request', { url: () => origin + '/PRIVATE?SECRET', method: () => 'GET', resourceType: () => 'xhr' });
  assert.equal(f.logs.at(-1)?.reason, 'event_limit'); assert.equal(f.logs.at(-1)?.recordedEvents, 200);
  assert.equal(f.context.listenerCount('request'), 0); assert.doesNotMatch(JSON.stringify(f.logs), /SECRET|PRIVATE/);
  // Fixture deliberately has no request, navigation, cookie-write, DB, or job API.
  stopRefreshObservation(f.browser, 'shutdown');
});
test('paths redact identifiers and all external origins', () => {
  assert.equal(safeObserverPath(origin + '/PRIVATE?q=SECRET', origin), '[other_same_origin]');
  assert.equal(safeObserverPath('https://outside.invalid/SECRET', origin), undefined);
});

test('keepalive summary succeeds after armed expiry and delayed GST still uses one fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); f.auth(); await flush(); t.mock.timers.tick(300_001);
  observeKeepalive(f.browser, { ok: true, status: 200 }, 12); await flush();
  const summary = f.logs.find(e => e.event === 'keepalive_summary')!;
  assert.equal(summary.outcome, 'success'); assert.equal(summary.httpStatus, 200);
  assert.equal(summary.cookieObservationAvailable, true); assert.equal(summary.requiredValueChanged, false);
  assert.equal(summary.requiredIdentityChanged, false); assert.equal(summary.requiredAttributesChanged, false);
  assert.equal(summary.additionalCookieChangeCount, 0); assert.equal(summary.destinationCategory, 'unavailable');
  assert.equal(f.context.listenerCount('response'), 0);
  f.trigger(); await flush(); assert.equal(f.logs.find(e => e.event === 'start')?.fallback, true);
  assert.equal(f.logs.find(e => e.event === 'start')?.observation, summary.observation);
  stopRefreshObservation(f.browser, 'shutdown');
});
test('failed keepalive does not invent redirect evidence or emit sensitive inputs', async () => {
  const f = fixture(); f.auth(); await flush();
  observeKeepalive(f.browser, { ok: false, status: 0, finalUrl: 'https://PRIVATE?SECRET', error: 'SECRET' } as any, 10);
  await flush(); const summary = f.logs.find(e => e.event === 'keepalive_summary')!;
  assert.equal(summary.outcome, 'fetch_failure'); assert.equal(summary.destinationCategory, 'unavailable');
  assert.equal('httpStatus' in summary, false); assert.equal('redirected' in summary, false);
  assert.doesNotMatch(JSON.stringify(summary), /SECRET|PRIVATE|https|hash|fingerprint/);
  stopRefreshObservation(f.browser, 'shutdown');
});
test('keepalive cookie changes expose only bounded booleans/counts against authenticated baseline', async () => {
  const f = fixture(); f.auth(); await flush();
  f.setJar([{ ...f.jar()[0], value: 'NEW_SECRET', expires: 12345 }, { ...f.jar()[1], path: '/PRIVATE' },
    { ...f.jar()[0], name: 'PRIVATE_EXTRA', value: 'SECRET' }]);
  observeKeepalive(f.browser, { ok: true, status: 200 }, 5); await flush();
  const summary = f.logs.find(e => e.event === 'keepalive_summary')!;
  assert.equal(summary.requiredValueChanged, true); assert.equal(summary.requiredIdentityChanged, true);
  assert.equal(summary.requiredAttributesChanged, true); assert.equal(summary.additionalCookieChangeCount, 1);
  assert.doesNotMatch(JSON.stringify(summary), /SECRET|PRIVATE|hash|fingerprint/);
  stopRefreshObservation(f.browser, 'shutdown');
});
test('24 keepalive summaries per context; no accumulating listeners or reset by reinstall', async () => {
  const f = fixture(); f.auth(); await flush(); stopRefreshObservation(f.browser, 'timeout');
  for (let i = 0; i < 40; i++) { observeKeepalive(f.browser, { ok: true, status: 200 }, 1); await flush(); }
  assert.equal(f.logs.filter(e => e.event === 'keepalive_summary').length, 24); assert.equal(f.reads(), 25);
  assert.equal(f.context.listenerCount('request'), 0); assert.equal(f.context.listenerCount('response'), 0);
  installRefreshObserver(f.browser, f.options); observeKeepalive(f.browser, { ok: true, status: 200 }, 1);
  assert.equal(f.reads(), 25); stopRefreshObservation(f.browser, 'shutdown');
});
test('keepalive disabled/fenced contexts do not sample cookies or emit diagnostics', async () => {
  const off = fixture(false); observeKeepalive(off.browser, { ok: true, status: 200 }, 1);
  assert.equal(off.reads(), 0); assert.deepEqual(off.logs, []);
  const f = fixture(); stopRefreshObservation(f.browser, 'context_replaced'); const count = f.logs.length;
  observeKeepalive(f.browser, { ok: true, status: 200 }, 1); assert.equal(f.reads(), 0); assert.equal(f.logs.length, count);
});
test('unavailable cookie sample is bounded and cannot multiply hung reads', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture(); f.auth(); await flush();
  let reads = 0; f.context.cookies = () => { reads++; return new Promise<Cookie[]>(() => {}); };
  observeKeepalive(f.browser, { ok: false, status: 0 }, 1); t.mock.timers.tick(2_001);
  observeKeepalive(f.browser, { ok: true, status: 200 }, 1);
  const summaries = f.logs.filter(e => e.event === 'keepalive_summary');
  assert.equal(summaries.length, 2); assert.equal(reads, 1); assert.ok(summaries.every(e => e.cookieObservationAvailable === false));
  stopRefreshObservation(f.browser, 'shutdown');
});

for (const enabled of [false, true]) for (const failed of [false, true]) test(`existing keepalive remains one redirect:error GET; flag=${enabled} failed=${failed}`, async () => {
  const source = readFileSync('scripts/refresh-praktika-session.ts', 'utf8');
  const ast = ts.createSourceFile('helper.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'performRealBrowserActivity')!;
  const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let requests = 0, summaries = 0, contextReads = 0;
  const run = runInNewContext(code + '\nperformRealBrowserActivity', {
    PRAKTIKA_BASE_URL: origin, process: { env: { PRAKTIKA_REFRESH_OBSERVER: enabled ? 'true' : 'false' } }, performance,
    pageHasVisiblePasswordInput: async () => false, dismissBlockingDialogs: async () => {}, console: { warn() {} },
    observeKeepalive: (_: unknown, result: any) => { summaries++; assert.deepEqual(Object.keys(result).sort(), ['ok', 'status']); },
    fetch: async (url: string, options: any) => {
      requests++; assert.equal(url, origin + '/v2/'); assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'include');
      if (failed) throw Error('SECRET'); return { ok: true, status: 200, url };
    },
  });
  // No navigation, APIRequestContext or cookie mutation primitive is supplied.
  await run({ isClosed: () => false, url: () => origin + '/v2/scheduler', evaluate: async (fn: any, arg: string) => fn(arg),
    context: () => { contextReads++; return {}; } });
  assert.equal(requests, 1); assert.equal(summaries, enabled ? 1 : 0); assert.equal(contextReads, enabled ? 1 : 0);
});

test('keepalive missing baseline and failed/oversized cookie reads remain unavailable', async () => {
  const f = fixture(); observeKeepalive(f.browser, { ok: false, status: 503 }, 1); await flush();
  let summary = f.logs.filter(e => e.event === 'keepalive_summary').at(-1)!;
  assert.equal(summary.outcome, 'http_error'); assert.equal(summary.httpStatus, 503);
  assert.equal(summary.cookieObservationAvailable, false); assert.equal('requiredValueChanged' in summary, false);
  f.context.cookies = async () => { throw Error('SECRET'); };
  observeKeepalive(f.browser, { ok: false, status: 0 }, 1); await flush();
  summary = f.logs.filter(e => e.event === 'keepalive_summary').at(-1)!;
  assert.equal(summary.cookieObservationAvailable, false); assert.doesNotMatch(JSON.stringify(summary), /SECRET/);
  f.context.cookies = async () => Array.from({ length: 101 }, () => f.jar()[0]);
  observeKeepalive(f.browser, { ok: true, status: 200 }, 1); await flush();
  assert.equal(f.logs.filter(e => e.event === 'keepalive_summary').at(-1)?.cookieObservationAvailable, false);
  stopRefreshObservation(f.browser, 'shutdown');
});
test('shutdown fences a pending keepalive cookie result without emitting late diagnostics', async () => {
  const f = fixture(); let release!: (v: Cookie[]) => void;
  f.context.cookies = () => new Promise<Cookie[]>(r => { release = r; });
  observeKeepalive(f.browser, { ok: true, status: 200 }, 1); stopRefreshObservation(f.browser, 'shutdown');
  release(f.jar()); await flush(); assert.equal(f.logs.filter(e => e.event === 'keepalive_summary').length, 0);
});
