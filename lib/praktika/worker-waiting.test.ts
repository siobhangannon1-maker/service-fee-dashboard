import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { praktikaJobEligibility } from './job-eligibility';
import { PraktikaReadFailure, allowedPraktikaRead, validatePraktikaRead, PERIO_READ_FIELDS, verifiedReadOperation } from './read-operations';
import { PraktikaOwnershipLost } from './helper-lease';
import { PraktikaAuthenticationUnverified } from './authentication-probe';
import { isConfirmedPraktikaUpload } from '../report-writing/praktika-upload-result';
type Row = Record<string, any>;
const path = 'scripts/praktika-helper-job-processor.ts';
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
const names = ['looksLoggedOut', 'looksLikeHtml', 'parsePraktikaResponse', 'runJsonOrFormRequest', 'jobEligible', 'claimNextJob', 'completeJob', 'failJob', 'processOnePraktikaHelperJob'];
const code = names.map(name => {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  return ts.transpileModule(fn.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}).join('\n');
function fixture(read = false, actor = 'actor', realTransport = false) {
  const session: Row = { scope: 'user', app_user_id: actor, helper_instance_id: 'generation', helper_heartbeat_at: new Date().toISOString(), status: 'connected', authenticated_at: null };
  const job: Row = { id: 'job', app_user_id: actor, job_type: read ? 'periodontal_chart_patient_perio_exam_ids' : 'upload_report_to_praktika', status: 'pending', attempts: 0,
    request: read ? { method: 'POST', path: '/php/forms/db_getFormData.php', contentType: 'json', body: [{ parameters: [{ practice_id: 1181, patient_id: 123 }], fields: [...PERIO_READ_FIELDS.periodontal_chart_patient_perio_exam_ids] }] } : {} };
  let afterClaim = () => {};
  let persistenceFails = false, transportFails = false;
  const logs: unknown[][] = [];
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
        if (persistenceFails && patch?.status === 'completed') return {data: null, error: {message: 'private database detail'}};
        const matches = rows.filter(r => filters.every(f => f(r)));
        if (patch) { matches.forEach(r => Object.assign(r, patch)); if (patch.status === 'processing') afterClaim(); }
        return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
      },
      maybeSingle: async () => q.execute(true),
      then: (resolve: (v: unknown) => void) => Promise.resolve(q.execute()).then(resolve),
    }; return q;
  } };
  let owned = true, operations = 0, connectedWrites = 0, httpStatus = 200;
  let responseUrl = "https://praktika.praktika.net.au/php/forms/db_getFormData.php", responseText = '{"patient_perioexamids":[12]}';
  const globals = { PraktikaReadFailure, supabase, PERIO_READ_FIELDS, verifiedReadOperation, praktikaJobEligibility, allowedPraktikaRead, validatePraktikaRead, PraktikaOwnershipLost, PraktikaAuthenticationUnverified,
    isConfirmedPraktikaUpload, Date, AbortSignal, URLSearchParams, WORKER_ID: 'worker', PRAKTIKA_BASE_URL: 'https://praktika.praktika.net.au', nowIso: () => new Date().toISOString(),
    console: { log(...args: unknown[]) { logs.push(args); }, error() {} },
    runPraktikaRequest: async (_c: unknown, _r: unknown, before: () => Promise<void>) => { if(realTransport) return api.runJsonOrFormRequest(_c, _r, before); await before(); operations++; return { patient_communication: { iFileId: 12 } }; },
    markSessionConnectedForJob: async () => { connectedWrites++; },
  };
  const api = runInNewContext(code + '\n({claimNextJob,processOnePraktikaHelperJob,runJsonOrFormRequest})', globals);
  const ownership = { assertOwned: async () => { if (!owned) throw new PraktikaOwnershipLost(); }, ensureAuthenticated: async () => assert.fail('claim must not change GST renewal cadence'), updateSession: async () => {} };
  const context = { request: { post: async (_url: string, options: Row) => {
    operations++; assert.equal(options.maxRedirects, 0); assert.equal(options.timeout, 120_000);
    if (transportFails) throw new Error("private cookie credential transport detail");
    return { ok: () => httpStatus >= 200 && httpStatus < 300, status: () => httpStatus, url: () => responseUrl, text: async () => responseText };
  } } };
  return { job, session, logs, setResponse: (text: string, url = responseUrl) => {responseText = text; responseUrl = url;}, failPersistence: () => { persistenceFails = true; }, failTransport: () => { transportFails = true; }, run: () => api.processOnePraktikaHelperJob(context, actor, ownership), operations: () => operations,
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

for (const category of ['transport_failure', 'result_persistence_failure', 'http_307'] as const) test(category+' stays safe and retains three-attempt retry schedule', async()=>{
 const f=fixture(true); if(category==='transport_failure')f.failTransport(); else if(category==='result_persistence_failure')f.failPersistence(); else f.setHttp(307);
 for(let attempt=1;attempt<=3;attempt++){
  const before=Date.now(); await f.run(); assert.equal(f.job.attempts,attempt);
  assert.equal(f.job.status,attempt===3?'failed':'pending');
  assert.equal(f.job.error_message,'Praktika read is temporarily unavailable.');
  assert.equal(f.job.response.readFailure.failureCategory,category);
  if(attempt<3) assert.ok(Date.parse(f.job.available_at)>=before+60000);
 }
 const events=f.logs.filter(e=>e[0]==='[Praktika read] failure'); assert.equal(events.length,3);
 for(const event of events) assert.ok(!JSON.stringify(event).includes('private'));
 assert.ok(!JSON.stringify(f.job.response).includes('private'));
 assert.equal(f.operations(),3);
});
test('ownership failure after claim stays separate and never becomes ordinary read retry',async()=>{
 const f=fixture(true); f.onClaim(f.loseOwnership); await assert.rejects(f.run(),PraktikaOwnershipLost);
 assert.equal(f.job.status,'processing'); assert.equal(f.job.attempts,1); assert.equal(f.job.error_message,undefined);
 assert.equal(f.job.response,undefined); assert.equal(f.operations(),0);
 assert.ok(f.logs.some(e=>(e[1] as {failureCategory?:string})?.failureCategory==='ownership_unavailable'));
});

for (const [category,text,url,status] of [
 ['http_other','',undefined,503],
 ['response_url_mismatch','{}','https://praktika.praktika.net.au/private?secret',200],
 ['response_too_large',' '.repeat(8000001),undefined,200],
 ['invalid_json','private-secret',undefined,200],
 ['error_envelope','{"error":"private-secret"}',undefined,200],
 ['invalid_structure','{"patient_perioexamids":null}',undefined,200],
 ['missing_exam_id','[]',undefined,200],
] as const) test(category+' is logged and persisted without response values',async()=>{
 const f=fixture(true); f.setHttp(status); f.setResponse(text,url);
 if(category==='missing_exam_id') {
  f.job.job_type='periodontal_chart_perio_exams';
  f.job.request.body=[{parameters:[{practice_id:1181,perioexam_id:12}],fields:[...PERIO_READ_FIELDS.periodontal_chart_perio_exams]}];
 }
 await f.run();
 assert.equal(f.job.response.readFailure.failureCategory,category);
 const events=f.logs.filter(e=>e[0]==='[Praktika read] failure');
 assert.equal(events.length,1);
 const diagnostic=JSON.parse(JSON.stringify(events[0][1]));
 assert.deepEqual(diagnostic,{jobType:f.job.job_type,attempt:1,failureCategory:category,httpStatus:status});
 assert.deepEqual(JSON.parse(JSON.stringify(f.job.response)),{readFailure:diagnostic});
 assert.equal(f.job.error_message,'Praktika read is temporarily unavailable.');
});

const scopedUser='11111111-1111-4111-8111-111111111111';
async function noAuth(run:()=>Promise<void>) {
 const old=process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE, scope=process.env.PRAKTIKA_EXPERIMENT_USER_ID;
 process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE='true'; process.env.PRAKTIKA_EXPERIMENT_USER_ID=scopedUser;
 try {await run();} finally {if(old===undefined)delete process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE;else process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE=old;if(scope===undefined)delete process.env.PRAKTIKA_EXPERIMENT_USER_ID;else process.env.PRAKTIKA_EXPERIMENT_USER_ID=scope;}
}
for(const jobType of ['patient_match_search','upload_report_to_praktika','update_praktika_letter_icons'])test(jobType+' dispatches once without GST proof in scoped mode',()=>noAuth(async()=>{
 const f=fixture(false,scopedUser,true); f.job.job_type=jobType; f.job.request={method:'POST',path:jobType==='patient_match_search'?'/php/json/db_gridPatientList.php':'/php/forms/db_commitFormData.php',contentType:'json',body:{}};
 f.setResponse(JSON.stringify({patient_communication:{iFileId:12}}));
 assert.equal((await f.run()).outcome,'completed'); assert.equal(f.operations(),1); assert.equal((await f.run()).outcome,'none');
 assert.equal(f.session.authenticated_at,null);
 if(jobType==='patient_match_search')assert.equal(f.connectedWrites(),0);
}));
for(const jobType of ['upload_report_to_praktika','update_praktika_letter_icons'])for(const failure of ['307','500','transport','invalid_json'])test(jobType+' '+failure+' is never automatically replayed',()=>noAuth(async()=>{
 const f=fixture(false,scopedUser,true);f.job.job_type=jobType;f.job.request={method:'POST',path:'/php/forms/db_commitFormData.php',contentType:'json',body:{}};
 if(failure==='transport')f.failTransport();else if(failure==='invalid_json')f.setResponse('invalid');else f.setHttp(Number(failure));
 await f.run(); assert.equal(f.job.status,'failed');assert.match(f.job.error_message,/unconfirmed/);assert.equal(f.operations(),1);
 f.session.authenticated_at=new Date().toISOString();assert.equal((await f.run()).outcome,'none');assert.equal(f.operations(),1);
}));
test('scoped pre-dispatch challenge returns job to queue without consuming attempt',()=>noAuth(async()=>{
 const f=fixture(false,scopedUser,true); f.onClaim(()=>{f.session.status='waiting_for_mfa';});await f.run();assert.equal(f.job.status,'pending');assert.equal(f.job.attempts,0);assert.equal(f.operations(),0);
}));
test('scoped generation loss still fences dispatch',()=>noAuth(async()=>{
 const f=fixture(false,scopedUser,true); f.onClaim(f.loseOwnership);await assert.rejects(f.run(),PraktikaOwnershipLost);assert.equal(f.operations(),0);
}));

test('scoped periodontal read still validates without auth proof',()=>noAuth(async()=>{
 const f=fixture(true,scopedUser);assert.equal((await f.run()).outcome,'completed');assert.equal(f.session.authenticated_at,null);assert.equal(f.connectedWrites(),0);
}));
test('concurrent scoped drains claim at most one copy of a job',()=>noAuth(async()=>{
 const f=fixture(false,scopedUser,true);f.setResponse('{"patient_communication":{"iFileId":12}}');
 await Promise.all([f.run(),f.run()]);assert.equal(f.operations(),1);assert.equal(f.job.attempts,1);
}));
