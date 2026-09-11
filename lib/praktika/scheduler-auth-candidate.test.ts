import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserContext } from 'playwright';
import { classifySchedulerResponse, probeSchedulerCandidate } from './scheduler-auth-candidate';
import { pollSchedulerDiagnostic } from '../../scripts/praktika-scheduler-diagnostic';
import { praktikaHelperToken } from './authentication-probe';
import type { SupabaseClient } from '@supabase/supabase-js';
const url = 'https://praktika.praktika.net.au/php/forms/db_getFormData.php';
const token = praktikaHelperToken('generation');
for (const [name, status, body, expected, path = url] of [
  ['valid', 200, '{"practice_schedule":[]}', 'authenticated_candidate'],
  ['redirect', 307, '{}', 'redirect'],
  ['login HTML', 200, '<html><input type="password"></html>', 'unauthenticated_candidate'],
  ['MFA', 200, '{"practice_schedule":[],"mfa":true}', 'unauthenticated_candidate'],
  ['auth error', 200, '{"error":"DBUnauthorisedException"}', 'unauthenticated_candidate'],
  ['generic error', 200, '{"practice_schedule":[],"error":"failure"}', 'ambiguous'],
  ['malformed', 200, '{', 'malformed'],
  ['missing', 200, '{}', 'ambiguous'],
  ['wrong type', 200, '{"practice_schedule":{}}', 'ambiguous'],
  ['wrong path', 200, '{"practice_schedule":[]}', 'ambiguous', url + '?secret'],
  ['server error', 500, '{"practice_schedule":[]}', 'ambiguous'],
] as const) test(name, () => {
  const e = classifySchedulerResponse(token, status, path, body);
  assert.equal(e.classification, expected); assert.equal(e.helperToken, token);
});
test('schedule contents are never inspected or emitted; unknown envelope fails closed', () => {
  const text = '{"practice_schedule":[{"name":"SECRET_PATIENT","cookie":"SECRET_COOKIE","error":"login"}]}';
  const e = classifySchedulerResponse(token, 200, url, text);
  assert.equal(e.classification, 'authenticated_candidate');
  assert.doesNotMatch(JSON.stringify(e), /SECRET|cookie|name/);
  assert.equal(classifySchedulerResponse(token, 200, url, '{"practice_schedule":[],"unexpected":true}').classification, 'ambiguous');
});
test('oversized response fails closed', () => {
  assert.equal(classifySchedulerResponse(token, 200, url, ' '.repeat(2 * 1024 * 1024 + 1)).classification, 'ambiguous');
});
function context(post: (...args: any[]) => Promise<any>) { return { request: { post } } as unknown as BrowserContext; }
test('exact live contract, shared context, one request, no redirects, disposed response', async () => {
  let calls = 0, disposed = 0;
  const e = await probeSchedulerCandidate(context(async (target, options) => {
    calls++; assert.equal(target, url);
    assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Origin: 'https://praktika.praktika.net.au',
      Referer: 'https://praktika.praktika.net.au/v2/scheduler/2026-01-16', Accept: 'application/json, text/plain, */*' });
    assert.deepEqual(options.data, [{ parameters: { practice_id: 1181, start_date: '2026-01-16', end_date: '2026-01-16' }, fields: ['practice_schedule'] }]);
    assert.equal(options.maxRedirects, 0); assert.equal(options.timeout, 10000);
    return { status: () => 200, url: () => url, headers: () => ({}), text: async () => '{"practice_schedule":[]}', dispose: async () => { disposed++; } };
  }), token, new Date('2026-01-15T16:00:00Z'));
  assert.equal(e.classification, 'authenticated_candidate'); assert.equal(calls, 1); assert.equal(disposed, 1);
});
test('transport exception is sanitized', async () => {
  const e = await probeSchedulerCandidate(context(async () => { throw new Error('SECRET'); }), token);
  assert.equal(e.classification, 'transport_error'); assert.doesNotMatch(JSON.stringify(e), /SECRET/);
});
test('whole operation has a bounded deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = probeSchedulerCandidate(context(async () => new Promise(() => {})), token);
  t.mock.timers.tick(10000);
  assert.equal((await pending).classification, 'transport_error');
});

type Row = Record<string, any>;
function queueFixture() {
  const session: Row = { id: 'session', scope: 'user', app_user_id: 'actor', status: 'connected', helper_instance_id: 'generation', helper_heartbeat_at: new Date().toISOString(), authenticated_at: null };
  const job: Row = { id: 'diagnostic', app_user_id: 'actor', job_type: 'praktika_scheduler_auth_candidate_probe', status: 'diagnostic_requested', request: { helperInstanceId: 'generation' }, created_at: new Date().toISOString() };
  const normal: Row = { id: 'normal', app_user_id: 'actor', job_type: 'upload_report_to_praktika', status: 'pending', attempts: 0 };
  let requests = 0;
  const writes: string[] = [];
  const db = { from(table: string) {
    const filters: Array<(r: Row) => boolean> = []; let patch: Row | undefined;
    const value = (r: Row, k: string) => k === 'request->>helperInstanceId' ? r.request?.helperInstanceId : r[k];
    const q: any = { select: () => q, order: () => q, limit: () => q, abortSignal: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => value(r, k) === v); return q; },
      gte: (k: string, v: string) => { filters.push(r => r[k] >= v); return q; },
      update: (p: Row) => { patch = p; return q; },
      execute(single = false) {
        const rows = (table === 'praktika_sessions' ? [session] : [job, normal]).filter(r => filters.every(f => f(r)));
        if (patch) { writes.push(table); rows.forEach(r => Object.assign(r, patch)); }
        return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
      }, maybeSingle: async () => q.execute(true), then: (resolve: (v: unknown) => void) => Promise.resolve(q.execute()).then(resolve) };
    return q;
  } } as unknown as SupabaseClient;
  const browser = context(async () => { requests++; return { status: () => 200, url: () => url, headers: () => ({}), text: async () => '{"practice_schedule":[{"name":"SECRET"}]}', dispose: async () => {} }; });
  const run = () => pollSchedulerDiagnostic(db, browser, { sessionId: 'session', generation: 'generation', assertOwned: async () => {}, busy: () => false });
  return { session, job, normal, writes, run, requests: () => requests };
}
test('one-shot diagnostic while proof stale: no session writes, normal job untouched, sanitized log', async t => {
  const logs: unknown[] = []; t.mock.method(console, 'log', (...args: unknown[]) => logs.push(args));
  const f = queueFixture(); const before = structuredClone(f.session);
  await f.run(); await f.run();
  assert.equal(f.requests(), 1); assert.deepEqual(f.session, before);
  assert.equal(f.job.status, 'diagnostic_completed'); assert.equal(f.normal.status, 'pending'); assert.equal(f.normal.attempts, 0);
  assert.ok(f.writes.every(table => table === 'praktika_helper_jobs'));
  assert.doesNotMatch(JSON.stringify(logs), /SECRET/); assert.equal(logs.length, 1);
  assert.equal(f.job.response.helperToken, token);
});
for (const mismatch of ['user', 'generation', 'challenge', 'expired', 'ordinary'] as const) test(`reject ${mismatch}`, async () => {
  const f = queueFixture();
  if (mismatch === 'user') f.job.app_user_id = 'other';
  if (mismatch === 'generation') f.job.request.helperInstanceId = 'other';
  if (mismatch === 'challenge') f.session.status = 'waiting_for_mfa';
  if (mismatch === 'expired') f.session.helper_heartbeat_at = '2000-01-01';
  if (mismatch === 'ordinary') f.job.status = 'pending';
  await f.run(); assert.equal(f.requests(), 0); assert.equal(f.writes.length, 0);
});
