import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Request, Page } from 'playwright';
import { installFrontendRefreshObserver, frontendRequest } from './frontend-refresh-observer';
const origin = 'https://synthetic.invalid';
const secret = 'Alice-Patient DOB-2001-02-03 alice@example.invalid SECRET-cookie Authorization';
function fixture(enabled = true, captureMs = 30_000) {
  const context = new EventEmitter(), page = new EventEmitter();
  const logs: Array<Record<string, string | number | boolean>> = [];
  let reads = 0, cookieValue = secret;
  const frame = { page: () => page };
  Object.assign(page, { url: () => origin + '/v2/', mainFrame: () => frame });
  Object.assign(context, { pages: () => [page], cookies: async () => {
    reads++;
    return ['PHPSESSID', 'UAT'].map(name => ({ name, value: cookieValue, domain: 'synthetic.invalid', path: '/', expires: -1, secure: true, httpOnly: true, sameSite: 'Lax' }));
  } });
  const observer = installFrontendRefreshObserver(context as unknown as BrowserContext, { enabled, page: page as unknown as Page, origin, captureMs, emit: e => logs.push(e) });
  const request = (path = '/php/json/sensitive-patient.php', previous: unknown = null, method = 'POST') => ({
    url: () => origin + path + '?patient=' + secret,
    frame: () => frame, resourceType: () => 'xhr', method: () => method, redirectedFrom: () => previous,
    postData: () => { throw new Error(secret); }, headers: () => { throw new Error(secret); },
  });
  const response = (req: ReturnType<typeof request>, status: number, location?: string) => ({
    request: () => req, status: () => status,
    headerValue: async () => `PHPSESSID=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    headers: () => ({ location, 'set-cookie': `PHPSESSID=${secret}; Path=/; Secure; HttpOnly; SameSite=Lax`, Authorization: secret, Cookie: secret }),
    body: () => { throw new Error(secret); }, text: () => { throw new Error(secret); },
  });
  return { context, page, logs, observer, request, response, reads: () => reads, rotate: () => { cookieValue = 'rotated-' + secret; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('off is entirely inert; waiting has no cookies/output/timer work', async () => {
  const off = fixture(false); assert.equal(off.observer, undefined); assert.equal(off.page.listenerCount('request'), 0);
  off.page.emit('request', off.request()); await tick(); assert.equal(off.reads(), 0); assert.deepEqual(off.logs, []);
  const on = fixture(); await tick(); assert.equal(on.reads(), 0); assert.deepEqual(on.logs, []);
  assert.equal(on.page.listenerCount('request'), 1); on.observer!.stop('shutdown');
});
test('XHR frame association required; helper and service worker metadata fail closed', () => {
  const f = fixture();
  assert.equal(frontendRequest(f.request() as unknown as Request, f.page as unknown as Page, origin)?.resourceType, 'xhr');
  for (const bad of [{ url: () => origin + '/php/json/x', method: () => 'POST' }, { ...f.request(), frame: () => { throw new Error(secret); } }, { ...f.request(), frame: () => ({ page: () => ({}) }) }]) {
    assert.equal(frontendRequest(bad as Request, f.page as unknown as Page, origin), undefined);
    f.page.emit('request', bad);
  }
  f.context.emit('request', f.request()); assert.deepEqual(f.logs, []); assert.equal(f.reads(), 0);
  f.observer!.stop('shutdown');
});
test('POST 307 POST refresh onward redirect and independent subsequent success; privacy and cookies', async () => {
  const f = fixture(), first = f.request(); f.page.emit('request', first); await tick();
  f.rotate(); f.page.emit('response', f.response(first, 307, '/php/security/db_refreshToken.php?secret=' + secret)); await tick();
  const refresh = f.request('/php/security/db_refreshToken.php', first); f.page.emit('request', refresh);
  f.page.emit('response', f.response(refresh, 307, '/php/json/patient-' + secret + '.php')); await tick();
  const onward = f.request('/php/json/other.php', refresh); f.page.emit('request', onward); f.page.emit('response', f.response(onward, 200));
  f.page.emit('request', f.request('/private/patient-' + secret));
  await tick(); f.observer!.stop('shutdown');
  const requestLogs = f.logs.filter(e => e.event === 'request');
  assert.equal(requestLogs.length, 3); assert.equal(requestLogs[1].method, 'POST'); assert.equal(requestLogs[1].methodPreserved, true);
  assert.equal(requestLogs[1].redirectedFrom, requestLogs[0].correlation); assert.equal(requestLogs[2].chain, requestLogs[0].chain);
  assert.equal(f.logs.find(e => e.event === 'response')?.redirectDestination, 'refresh_token');
  assert.equal(f.logs.find(e => e.event === 'set_cookie')?.name, 'PHPSESSID');
  assert.equal(f.logs.find(e => Number(e.PHPSESSIDCookiesValueChangedCount) > 0)?.UATCookiesValueChangedCount, 1);
  assert.equal(f.logs.at(-1)?.subsequentPhpSuccess, 'observed');
  const serialized = JSON.stringify(f.logs);
  for (const forbidden of [secret, 'Alice', '2001-02-03', 'alice@', 'SECRET-cookie', 'Authorization', '?patient', 'sensitive-patient', '/php/', 'rotated-']) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.ok(f.reads() <= 4);
});
test('bounded output, permanent termination, no reinstallation', () => {
  const f = fixture(); for (let i = 0; i < 300; i++) f.page.emit('request', f.request());
  assert.equal(f.logs.length, 200); assert.equal(f.logs.at(-1)?.reason, 'event_limit'); assert.equal(f.page.listenerCount('request'), 0);
  assert.equal(installFrontendRefreshObserver(f.context as unknown as BrowserContext, { enabled: true, page: f.page as unknown as Page, origin, emit: () => assert.fail() }), f.observer);
});
test('trigger timeout detaches and fences pending cookie result', async () => {
  const f = fixture(true, 5); f.page.emit('request', f.request());
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(f.logs.at(-1)?.reason, 'capture_timeout');
  const count = f.logs.length; f.page.emit('request', f.request()); await tick(); assert.equal(f.logs.length, count);
});
for (const reason of ['ownership_lost', 'context_replaced', 'shutdown', 'credentials', 'mfa', 'context_closed'] as const) {
  test(`termination ${reason}, missing coverage is not_observed`, () => {
    const f = fixture(); if (reason === 'context_closed') f.context.emit('close'); else f.observer!.stop(reason);
    assert.equal(f.logs.at(-1)?.triggered, false); assert.equal(f.logs.at(-1)?.frontend307, 'not_observed');
    assert.equal(f.logs.at(-1)?.refreshEndpoint, 'not_observed'); assert.equal(f.logs.at(-1)?.subsequentPhpSuccess, 'not_observed');
    assert.equal(f.page.listenerCount('request'), 0); assert.equal(f.reads(), 0);
  });
}
test('late cookie completion cannot emit after termination; auth success does not reset lifetime', async () => {
  const f = fixture(); f.observer!.stop('authenticated'); f.page.emit('request', f.request()); f.observer!.stop('ownership_lost');
  const count = f.logs.length; await tick(); assert.equal(f.logs.length, count);
});
test('fetch allowed; outside origin/path and non-XHR resources excluded', () => {
  const f = fixture();
  assert.equal(frontendRequest({ ...f.request(), resourceType: () => 'fetch' } as unknown as Request, f.page as unknown as Page, origin)?.resourceType, 'fetch');
  for (const r of [{ ...f.request(), url: () => 'https://elsewhere.invalid/php/json/x' }, f.request('/private/patient'), { ...f.request(), resourceType: () => 'document' }]) f.page.emit('request', r);
  assert.equal(f.logs.length, 0); assert.equal(f.reads(), 0); f.observer!.stop('shutdown');
});
test('response-only start explicitly reports missing redirect parent; metadata failure sanitized', async () => {
  const f = fixture(), r = f.request('/php/security/db_refreshToken.php');
  f.page.emit('response', { ...f.response(r, 200), headerValue: async () => { throw new Error(secret); } });
  await tick(); f.observer!.stop('shutdown');
  assert.equal(f.logs.at(-1)?.qualifyingRequests, 1); assert.equal(f.logs.at(-1)?.refreshEndpoint, 'observed');
  assert.ok(f.logs.some(e => e.coverage === 'unavailable')); assert.equal(JSON.stringify(f.logs).includes(secret), false);
});
test('application Page closure permanently detaches', () => {
  const f = fixture(); f.page.emit('close'); assert.equal(f.logs.at(-1)?.reason, 'page_closed'); assert.equal(f.page.listenerCount('request'), 0);
});
test('source has no request, navigation, routing or cookie mutation capability calls', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('lib/praktika/frontend-refresh-observer.ts', 'utf8');
  assert.doesNotMatch(source, /\.(?:goto|reload|evaluate|click|route|unroute|abort|continue|fulfill|addCookies|clearCookies|postData|body|text|json|fetch|post)\s*\(/);
});
test('concurrent pre-transition request success does not imply subsequent request success', async () => {
  const f = fixture(), first = f.request(), concurrent = f.request();
  f.page.emit('request', first); f.page.emit('request', concurrent);
  f.page.emit('response', f.response(first, 307, '/php/security/db_refreshToken.php'));
  f.page.emit('response', f.response(concurrent, 200)); await tick(); f.observer!.stop('shutdown');
  assert.equal(f.logs.at(-1)?.subsequentPhpSuccess, 'not_observed');
});
