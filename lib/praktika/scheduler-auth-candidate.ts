import type { BrowserContext } from 'playwright';
import { praktikaPracticeDate } from './authentication-probe';

export const SCHEDULER_PROBE_JOB = 'praktika_scheduler_auth_candidate_probe';
const ORIGIN = 'https://praktika.praktika.net.au';
const ENDPOINT = `${ORIGIN}/php/forms/db_getFormData.php`;
export const SCHEDULER_PROBE_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
type Classification = 'authenticated_candidate' | 'redirect' | 'unauthenticated_candidate' | 'malformed' | 'ambiguous' | 'transport_error';
export type SchedulerEvidence = {
  helperToken: string; httpStatus: number | null; redirected: boolean; expectedPath: boolean;
  jsonParsed: boolean; topLevelObject: boolean; practiceScheduleIsArray: boolean;
  authErrorDetected: boolean; errorEnvelope: boolean; classification: Classification;
};
const blank = (helperToken: string): SchedulerEvidence => ({ helperToken, httpStatus: null, redirected: false,
  expectedPath: false, jsonParsed: false, topLevelObject: false, practiceScheduleIsArray: false,
  authErrorDetected: false, errorEnvelope: false, classification: 'transport_error' });

export function classifySchedulerResponse(helperToken: string, status: number, url: string, text: string): SchedulerEvidence {
  const e = { ...blank(helperToken), httpStatus: status, expectedPath: url === ENDPOINT };
  if (status >= 300 && status < 400) return { ...e, redirected: true, classification: 'redirect' };
  if (Buffer.byteLength(text) > MAX_BYTES) return { ...e, classification: 'ambiguous' };
  let parsed: unknown;
  try { parsed = JSON.parse(text); e.jsonParsed = true; }
  catch {
    e.authErrorDetected = /<html|<!doctype|type\s*=\s*["']password|login|mfa|challenge/i.test(text);
    return { ...e, classification: e.authErrorDetected ? 'unauthenticated_candidate' : 'malformed' };
  }
  e.topLevelObject = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  if (!e.topLevelObject) return { ...e, classification: 'ambiguous' };
  const row = parsed as Record<string, unknown>;
  e.practiceScheduleIsArray = Array.isArray(row.practice_schedule);
  // Never traverse, sample or stringify schedule entries. Unknown top-level fields
  // fail closed, so an unrecognized envelope cannot silently grant a positive result.
  const keys = Object.keys(row).filter(k => k !== 'practice_schedule');
  e.authErrorDetected = keys.some(k => /auth|login|mfa|challenge|session/i.test(k)) || keys.some(k =>
    ['error', 'message', 'status', 'code'].includes(k) && typeof row[k] === 'string'
    && /logged.?out|not logged|unauthori|expired|login|mfa|challenge|password/i.test(row[k] as string));
  e.errorEnvelope = keys.some(k => /error|exception|success|status|message|code/i.test(k));
  e.classification = e.authErrorDetected ? 'unauthenticated_candidate'
    : status >= 200 && status < 300 && e.expectedPath && e.practiceScheduleIsArray && keys.length === 0
      ? 'authenticated_candidate' : 'ambiguous';
  return e;
}

export async function probeSchedulerCandidate(context: Pick<BrowserContext, 'request'>, helperToken: string, now = new Date()): Promise<SchedulerEvidence> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = async (): Promise<SchedulerEvidence> => {
    const date = praktikaPracticeDate(now);
    const response = await context.request.post(ENDPOINT, {
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN,
        Referer: `${ORIGIN}/v2/scheduler/${date}`, Accept: 'application/json, text/plain, */*' },
      data: [{ parameters: { practice_id: 1181, start_date: date, end_date: date }, fields: ['practice_schedule'] }],
      timeout: SCHEDULER_PROBE_TIMEOUT_MS, maxRedirects: 0,
    });
    try {
      if (response.status() >= 300 && response.status() < 400) return classifySchedulerResponse(helperToken, response.status(), response.url(), '');
      if (Number(response.headers()['content-length']) > MAX_BYTES) return { ...blank(helperToken), httpStatus: response.status(), classification: 'ambiguous' };
      return classifySchedulerResponse(helperToken, response.status(), response.url(), await response.text());
    } finally { await response.dispose().catch(() => {}); }
  };
  try {
    return await Promise.race([operation(), new Promise<SchedulerEvidence>(resolve => {
      timer = setTimeout(() => resolve(blank(helperToken)), SCHEDULER_PROBE_TIMEOUT_MS);
    })]);
  } catch { return blank(helperToken); }
  finally { if (timer) clearTimeout(timer); }
}
