import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { praktikaJobEligibility } from './job-eligibility';
import { allowedPraktikaRead, validatePraktikaRead, PERIO_READ_FIELDS, verifiedReadOperation } from './read-operations';
import { PraktikaOwnershipLost } from './helper-lease';
import { PraktikaAuthenticationUnverified } from './authentication-probe';
import { isConfirmedPraktikaUpload } from '../report-writing/praktika-upload-result';
type Row = Record<string, any>;
const path = 'scripts/praktika-helper-job-processor.ts';
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
const names = ['jobEligible', 'claimNextJob', 'completeJob', 'failJob', 'processOnePraktikaHelperJob'];
const code = names.map(name => {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  return ts.transpileModule(fn.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}).join('\n');
function fixture(read = false) {
  const session: Row = { scope: 'user', app_user_id: 'actor', helper_instance_id: 'generation', helper_heartbeat_at: new Date().toISOString(), status: 'connected', authenticated_at: null };
  const job: Row = { id: 'job', app_user_id: 'actor', job_type: read ? 'periodontal_chart_patient_perio_exam_ids' : 'upload_report_to_praktika', status: 'pending', attempts: 0,
    request: read ? { method: 'POST', path: '/php/forms/db_getFormData.php', contentType: 'json', body: [{ parameters: [{ practice_id: 1181, patient_id: 123 }], fields: [...PERIO_READ_FIELDS.periodontal_chart_patient_perio_exam_ids] }] } : {} };
  let afterClaim = () => {};
  const supabase = { from(table: string) {
    const rows = table === 'praktika_sessions' ? [session] : [job];
    const filters: Array<(r: Row) => boolean> = []; let patch: Row | null = null;
    const q: any = { select: () => q, abortSignal: () => q, order: () => q, limit: () => q, lte: () => q,
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      in: (k: string, values: unknown[]) => { filters.push(r => values.includes(r[k])); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      update: (p: Row) => { patch = p; return q; },
      execute(single = false) {
        const matches = rows.filter(r => filters.every(f => f(r)));
        if (patch) { matches.forEach(r => Object.assign(r, patch)); if (patch.status === 'processing') afterClaim(); }
        return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
      },
      maybeSingle: async () => q.execute(true),
      then: (resolve: (v: unknown) => void) => Promise.resolve(q.execute()).then(resolve),
    }; return q;
  } };
  let owned = true, operations = 0, connectedWrites = 0, httpStatus = 200;
  const globals = { supabase, PERIO_READ_FIELDS, verifiedReadOperation, praktikaJobEligibility, allowedPraktikaRead, validatePraktikaRead, PraktikaOwnershipLost, PraktikaAuthenticationUnverified,
    isConfirmedPraktikaUpload, Date, AbortSignal, WORKER_ID: 'worker', PRAKTIKA_BASE_URL: 'https://praktika.praktika.net.au', nowIso: () => new Date().toISOString(),
    console: { log() {}, error() {} },
    runPraktikaRequest: async (_c: unknown, _r: unknown, before: () => Promise<void>) => { await before(); operations++; return { patient_communication: { iFileId: 12 } }; },
    markSessionConnectedForJob: async () => { connectedWrites++; },
  };
  const api = runInNewContext(code + '\n({claimNextJob,processOnePraktikaHelperJob})', globals);
  const ownership = { assertOwned: async () => { if (!owned) throw new PraktikaOwnershipLost(); }, ensureAuthenticated: async () => assert.fail('claim must not change GST renewal cadence'), updateSession: async () => {} };
  const context = { request: { post: async (_url: string, options: Row) => {
    operations++; assert.equal(options.maxRedirects, 0);
    return { status: () => httpStatus, url: () => 'https://praktika.praktika.net.au/php/forms/db_getFormData.php', text: async () => '{"patient_perioexamids":[12]}' };
  } } };
  return { job, session, run: () => api.processOnePraktikaHelperJob(context, 'actor', ownership), operations: () => operations,
    connectedWrites: () => connectedWrites, loseOwnership: () => { owned = false; }, onClaim: (fn: () => void) => { afterClaim = fn; }, setHttp: (v: number) => { httpStatus = v; } };
}
test('waiting write stays pending with attempts unchanged, then resumes once after proof', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) assert.equal((await f.run()).outcome, 'none');
  assert.equal(f.job.attempts, 0); assert.equal(f.job.status, 'pending'); assert.equal(f.operations(), 0);
  f.session.authenticated_at = new Date().toISOString();
  assert.equal((await f.run()).outcome, 'completed'); assert.equal(f.operations(), 1); assert.equal(f.job.attempts, 1);
  assert.equal((await f.run()).outcome, 'none'); assert.equal(f.operations(), 1);
});
for (const status of ['waiting_for_credentials', 'waiting_for_mfa', 'error']) test(`${status} preserves queued intent`, async () => {
  const f = fixture(); f.session.status = status; await f.run(); assert.equal(f.job.status, 'pending'); assert.equal(f.job.attempts, 0); assert.equal(f.operations(), 0);
});
test('proof lost between claim and dispatch restores original attempt and never sends', async () => {
  const f = fixture(); f.session.authenticated_at = new Date().toISOString(); f.onClaim(() => { f.session.authenticated_at = null; });
  assert.equal((await f.run()).outcome, 'none'); assert.equal(f.job.attempts, 0); assert.equal(f.job.status, 'pending'); assert.equal(f.operations(), 0);
});
test('old generation cannot claim or dispatch', async () => {
  const f = fixture(); f.session.authenticated_at = new Date().toISOString(); f.loseOwnership();
  await assert.rejects(f.run(), PraktikaOwnershipLost); assert.equal(f.job.attempts, 0); assert.equal(f.operations(), 0);
});
test('another actor session cannot authorize this job', async () => {
  const f = fixture(); f.session.authenticated_at = new Date().toISOString(); f.session.app_user_id = 'other'; await f.run(); assert.equal(f.operations(), 0);
});
test('validated periodontal read completes during rechecking without connected/proof write', async () => {
  const f = fixture(true); assert.equal((await f.run()).outcome, 'completed'); assert.equal(f.session.authenticated_at, null); assert.equal(f.connectedWrites(), 0); assert.equal(f.operations(), 1);
});
test('307 periodontal read is not success and never refreshes proof', async () => {
  const f = fixture(true); f.setHttp(307); await f.run(); assert.equal(f.job.status, 'pending'); assert.equal(f.session.authenticated_at, null); assert.equal(f.connectedWrites(), 0);
});
