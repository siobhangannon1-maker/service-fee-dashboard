import { pollPraktikaWorkflowContinuations } from '../../scripts/praktika-workflow-continuations';
import { PraktikaHelperUnavailable } from "./helper-lease";
import { perioStructureDiagnostic } from "./perio-structure-diagnostic";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { praktikaJobEligibility } from './job-eligibility';
import { PraktikaReadFailure, allowedPraktikaRead, validatePraktikaRead, PERIO_READ_FIELDS, verifiedReadOperation } from './read-operations';
import { hasLivePraktikaHelper, PraktikaOwnershipLost } from './helper-lease';
import { praktikaUploadResponseDiagnostic, PraktikaAuthenticationUnverified } from './authentication-probe';
import { isConfirmedPraktikaUpload } from '../report-writing/praktika-upload-result';
type Row = Record<string, any>;
const path = 'scripts/praktika-helper-job-processor.ts';
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
const names = ['looksLoggedOut', 'looksLikeHtml', 'parsePraktikaResponse', 'runJsonOrFormRequest', 'runMultipartStorageRequest', 'jobEligible', 'claimNextJob', 'completeJob', 'failJob', 'processOnePraktikaHelperJob'];
const code = names.map(name => {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  return ts.transpileModule(fn.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}).join('\n');
function fixture(read = false, actor = 'actor', realTransport = false) {
  const calls: string[] = [];
  const session: Row = { id: 'session', scope: 'user', app_user_id: actor, helper_instance_id: 'generation', helper_heartbeat_at: new Date().toISOString(), status: 'connected', authenticated_at: null };
  const job: Row = { id: 'job', app_user_id: actor, job_type: read ? 'periodontal_chart_patient_perio_exam_ids' : 'upload_report_to_praktika', status: 'pending', attempts: 0,
    request: read ? { method: 'POST', path: '/php/forms/db_getFormData.php', contentType: 'json', body: [{ parameters: [{ practice_id: 1181, patient_id: 123 }], fields: [...PERIO_READ_FIELDS.periodontal_chart_patient_perio_exam_ids] }] } : {} };
  const jobs: Row[] = [job];
  let browserReady = true;
  let afterDiscovery = () => {};
  let afterClaim = () => {};
  let prepareRequest = (_request: Row) => {};
  let persistenceFails = false, transportFails = false;
  let transportError: Error = new Error("private transport detail"), readFails = false;
  const logs: unknown[][] = [];
  const supabase = { storage: { from: () => ({ download: async () => ({ data: new Blob(['synthetic']), error: null }), remove: async () => ({error:null}) }) }, from(table: string) {
    const rows = table === 'praktika_sessions' ? [session] : jobs;
    const filters: Array<(r: Row) => boolean> = []; let patch: Row | null = null; let limit = Infinity;
    const q: any = { select: () => q, abortSignal: () => q, order: () => q, limit: (n: number) => { limit = n; return q; }, lte: () => q, or: () => q,
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      in: (k: string, values: unknown[]) => { filters.push(r => values.includes(r[k])); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      update: (p: Row) => { patch = p; return q; },
      execute(single = false) {
        calls.push(table + (patch ? ':update' : ':select'));
        if (persistenceFails && patch?.status === 'completed') return {data: null, error: {message: 'private database detail'}};
        const matches = rows.filter(r => filters.every(f => f(r))).slice(0, limit);
        if (table === 'praktika_helper_jobs' && !patch) afterDiscovery();
        if (patch) { matches.forEach(r => Object.assign(r, patch)); if (patch.status === 'processing') afterClaim(); }
        return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
      },
      single: async () => q.execute(true),
      maybeSingle: async () => q.execute(true),
      then: (resolve: (v: unknown) => void) => Promise.resolve(q.execute()).then(resolve),
    }; return q;
  } };
  let responseHeaders: Record<string,string> = {};
  let nextOwnershipError: Error | undefined;
  let owned = true, operations = 0, connectedWrites = 0, httpStatus = 200;
  let responseUrl = "https://praktika.praktika.net.au/php/forms/db_getFormData.php", responseText = '{"patient_perioexamids":[12]}';
  const globals = { praktikaUploadResponseDiagnostic, PraktikaHelperUnavailable, perioStructureDiagnostic, PraktikaReadFailure, supabase, PERIO_READ_FIELDS, verifiedReadOperation, praktikaJobEligibility, allowedPraktikaRead, validatePraktikaRead, PraktikaOwnershipLost, PraktikaAuthenticationUnverified,
    isConfirmedPraktikaUpload, Date, AbortSignal, URLSearchParams, Buffer, WORKER_ID: 'worker', PRAKTIKA_BASE_URL: 'https://praktika.praktika.net.au', nowIso: () => new Date().toISOString(),
    console: { log(...args: unknown[]) { logs.push(args); }, error() {} },
    runPraktikaRequest: async (_c: unknown, _r: unknown, before: () => Promise<void>, upload?: unknown) => { prepareRequest(_r as Row); if(realTransport) return (_r as Row).contentType === "multipart_storage" ? api.runMultipartStorageRequest(_c, _r, before, upload) : api.runJsonOrFormRequest(_c, _r, before, upload); await before(); operations++; return { patient_communication: { iFileId: 12 } }; },
    markSessionConnectedForJob: async () => { connectedWrites++; },
  };
  const api = runInNewContext(code + '\n({claimNextJob,processOnePraktikaHelperJob,runJsonOrFormRequest,runMultipartStorageRequest})', globals);
  const ownership = { isBrowserReady: async () => browserReady, assertOwned: async () => { calls.push('ownership:check'); if(nextOwnershipError){ const error=nextOwnershipError;nextOwnershipError=undefined;throw error; } if (!owned || session.helper_instance_id !== 'generation' || !hasLivePraktikaHelper(session)) throw new PraktikaOwnershipLost(); }, ensureAuthenticated: async () => assert.fail('claim must not change GST renewal cadence'), updateSession: async () => {} };
  const context = { request: { post: async (_url: string, options: Row) => {
    operations++; assert.equal(options.maxRedirects, 0); assert.equal(options.timeout, 120_000);
    if (transportFails) throw transportError;
    return { headers: () => responseHeaders, ok: () => httpStatus >= 200 && httpStatus < 300, status: () => httpStatus, url: () => responseUrl, text: async () => { if (readFails) throw new Error("private response body"); return responseText; } };
  } } };
  const helperPath = 'scripts/refresh-praktika-session.ts';
  const helperAst = ts.createSourceFile(helperPath, readFileSync(helperPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const helperCode = helperAst.statements.filter(n => ts.isFunctionDeclaration(n) && ['getSession','drainAvailableHelperJobs'].includes(n.name?.text || ''))
    .map(n => ts.transpileModule(n.getText(helperAst), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).join('\n');
  const helper = runInNewContext(helperCode + '\n({getSession,drainAvailableHelperJobs})', {
    supabase, sessionId: 'session', helperInstanceId: 'generation', assertOwned: ownership.assertOwned,
    ownershipRecovery: {run: (fn: () => Promise<unknown>) => fn()}, AbortSignal,
    pollPraktikaWorkflowContinuations, processOnePraktikaHelperJob: api.processOnePraktikaHelperJob,
    browserReady: true, shuttingDown: false, remainingUsefulWorkMs: () => 1000,
    HELPER_JOB_DRAIN_LIMIT: 5, checkBrowserAvailability: async () => browserReady,
    updateSession: ownership.updateSession, jobActive: false,
  });
  return { jobs, calls, empty: () => { jobs.length = 0; }, disconnect: () => { browserReady = false; },
    onDiscovery: (fn: () => void) => { afterDiscovery = fn; },
    idleCycle: async () => { await helper.getSession(); return helper.drainAvailableHelperJobs(context, actor, {}); },
    job, session, logs, setHeaders: (headers: Record<string,string>) => { responseHeaders=headers; }, prepareRequest: (fn: (request: Row) => void) => {prepareRequest=fn;}, setResponse: (text: string, url = responseUrl) => {responseText = text; responseUrl = url;}, failRead: () => { readFails = true; }, setTransportError: (error: Error) => { transportFails = true; transportError = error; }, failPersistence: () => { persistenceFails = true; }, failTransport: () => { transportFails = true; }, run: () => api.processOnePraktikaHelperJob(context, actor, ownership), operations: () => operations,
    failNextOwnership: (error: Error) => {nextOwnershipError=error;}, connectedWrites: () => connectedWrites, loseOwnership: () => { owned = false; }, onClaim: (fn: () => void) => { afterClaim = fn; }, setHttp: (v: number) => { httpStatus = v; } };
}
test('waiting write stays pending with attempts unchanged, then resumes once after browser startup', async () => {
  const f = fixture(); f.session.status = "refreshing";
  for (let i = 0; i < 3; i++) assert.equal((await f.run()).outcome, 'none');
  assert.equal(f.job.attempts, 0); assert.equal(f.job.status, 'pending'); assert.equal(f.operations(), 0);
  f.session.status = "connected";
  assert.equal((await f.run()).outcome, 'completed'); assert.equal(f.operations(), 1); assert.equal(f.job.attempts, 1);
  assert.equal((await f.run()).outcome, 'none'); assert.equal(f.operations(), 1);
});
for (const status of ['waiting_for_credentials', 'waiting_for_mfa', 'error']) test(`${status} preserves queued intent`, async () => {
  const f = fixture(); f.session.status = status; await f.run(); assert.equal(f.job.status, 'pending'); assert.equal(f.job.attempts, 0); assert.equal(f.operations(), 0);
});
test('browser challenge between claim and dispatch restores original attempt and never sends', async () => {
  const f = fixture(); f.session.authenticated_at = new Date().toISOString(); f.onClaim(() => { f.session.status = "waiting_for_mfa"; });
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

test('one structural observation per HTTP 200 invalid exam attempt; retries/proof unchanged',async()=>{
 const f=fixture(true); f.job.job_type='periodontal_chart_perio_exams';
 f.job.request.body=[{parameters:[{practice_id:1181,perioexam_id:12}],fields:[...PERIO_READ_FIELDS.periodontal_chart_perio_exams]}];
 f.setResponse('[{"perioexam_id":12,"perioexam_patientid":123,"perioexam_date":"2026-01-01","perioexam_toothdata":null}]');
 for(let attempt=1;attempt<=3;attempt++) { await f.run(); assert.equal(f.logs.filter(e=>e[0]==='[Praktika read] perio_structure').length,attempt); }
 assert.equal(f.job.status,'failed');assert.equal(f.job.attempts,3);assert.equal(f.session.authenticated_at,null);
 assert.equal(f.job.response.readFailure.failureCategory,'invalid_structure');
});
for(const status of [200,307,500])test('no structural observation for other failures/status '+status,async()=>{
 const f=fixture(true);f.setHttp(status);f.setResponse('invalid');await f.run();
 assert.equal(f.logs.filter(e=>e[0]==='[Praktika read] perio_structure').length,0);
});

test('valid single exam object completes normalized without structural diagnostic',async()=>{
 const f=fixture(true); f.job.job_type='periodontal_chart_perio_exams';
 f.job.request.body=[{parameters:[{practice_id:1181,perioexam_id:12}],fields:[...PERIO_READ_FIELDS.periodontal_chart_perio_exams]}];
 const exam={perioexam_id:12,perioexam_patientid:123,perioexam_date:'2026-01-01',perioexam_toothdata:Array.from({length:32},()=>({}))};
 f.setResponse(JSON.stringify(exam));await f.run();
 assert.equal(f.job.status,'completed');assert.deepEqual(f.job.response,[exam]);
 assert.equal(f.logs.filter(e=>e[0]==='[Praktika read] perio_structure').length,0);
 assert.equal(f.job.attempts,1);assert.equal(f.session.authenticated_at,null);
});

for (const multipart of [false,true]) for (const [kind, stage, category, status] of [
  ['closed', 'request_invoked', 'context_closed', undefined],
  ['timeout', 'request_invoked', 'request_timeout', undefined],
  ['transport', 'request_invoked', 'transport_failure', undefined],
  ['unknown', 'request_invoked', 'unknown_failure', undefined],
  ['307', 'response_validation', 'http_307', 307],
  ['500', 'response_validation', 'http_other', 500],
  ['read', 'response_read', 'response_read_failure', 200],
  ['invalid', 'response_validation', 'response_validation_failure', 200],
  ['persist', 'result_persistence', 'result_persistence_failure', 200],
] as const) test('upload safe diagnostic: '+kind+' multipart='+multipart, async () => {
  const f = fixture(false, 'actor', true);
  f.job.request = { method:'POST', contentType:'json', path:'/private', body:{ secret:'sensitive' } };
  if(multipart) f.job.request={ method:'POST', contentType:'multipart_storage', reportDraftId:'synthetic', path:'/private', body:{fields:{secret:'sensitive'},file:{bucket:'synthetic',path:'private',fieldName:'file',fileName:'sensitive.pdf'}} };
  f.setResponse(JSON.stringify({patient_communication:{iFileId:12}}));
  if(kind==='closed') f.setTransportError(new Error('Target page, context or browser has been closed sensitive'));
  if(kind==='timeout') f.setTransportError(Object.assign(new Error('sensitive'),{name:'TimeoutError'}));
  if(kind==='transport') f.setTransportError(Object.assign(new Error('sensitive'),{code:'ECONNRESET'}));
  if(kind==='unknown') f.failTransport();
  if(kind==='307'||kind==='500') f.setHttp(Number(kind));
  if(kind==='read') f.failRead();
  if(kind==='invalid') f.setResponse('sensitive invalid response');
  if(kind==='persist') f.failPersistence();
  await f.run();
  const entries=f.logs.filter(e=>e[0]==='[Praktika upload] failure');
  assert.equal(entries.length,1);
  const expected={jobId:'job',stage,requestInvoked:true,failureCategory:category,...(status===undefined?{}:{httpStatus:status}), ...(status === 307 || status === 500 ? praktikaUploadResponseDiagnostic(status, {}, 'https://praktika.praktika.net.au/php/forms/db_getFormData.php', 'https://praktika.praktika.net.au/private') : {})};
  assert.deepEqual(JSON.parse(JSON.stringify(entries[0][1])),JSON.parse(JSON.stringify(expected)));
  assert.deepEqual(JSON.parse(JSON.stringify(f.job.response.uploadFailure)),JSON.parse(JSON.stringify(expected)));
  assert.equal(f.job.error_message,'Report upload outcome is unconfirmed. Reconcile before retrying.');
  assert.equal(f.job.status,'failed'); assert.equal(f.job.attempts,1);
  await f.run(); assert.equal(f.operations(),1);
  assert.doesNotMatch(JSON.stringify(entries),/sensitive|private|iFileId/);
});
test('upload pre-invocation validation failure preserves existing retry policy',async()=>{
  const f=fixture(false,'actor',true);f.job.request={method:'GET'};
  await f.run();assert.equal(f.operations(),0);assert.equal(f.job.status,'pending');assert.equal(f.job.attempts,1);
  assert.equal(f.job.response.uploadFailure.stage,'preparation');
  assert.equal(f.job.response.uploadFailure.failureCategory,'preparation_failure');
  assert.equal(f.job.response.uploadFailure.requestInvoked,false);
});
test('upload unavailable before invocation logs without changing queue metadata',async()=>{
 const f=fixture(false,'actor',true);f.onClaim(()=>{f.session.status='waiting_for_mfa';});
 await f.run();const d=f.logs.find(e=>e[0]==='[Praktika upload] failure')![1] as any;
 assert.equal(d.stage,'pre_dispatch');assert.equal(d.requestInvoked,false);assert.equal(d.failureCategory,'browser_unavailable');
 assert.equal(f.job.status,'pending');assert.equal(f.job.attempts,0);assert.equal(f.operations(),0);
});

for(const unavailable of [false,true]) test('upload ownership diagnostic before dispatch '+unavailable,async()=>{
 const f=fixture(false,'actor',true);
 f.onClaim(()=>f.failNextOwnership(unavailable ? Object.assign(new Error('private'),{name:'PraktikaOwnershipUnavailable'}) : new PraktikaOwnershipLost()));
 if(unavailable) await f.run(); else await assert.rejects(f.run());
 assert.equal(f.operations(),0);
 const d=f.logs.find(e=>e[0]==='[Praktika upload] failure')![1] as any;
 assert.equal(d.failureCategory,unavailable?'ownership_unavailable':'ownership_lost');
 assert.equal(d.requestInvoked,false);assert.equal(d.stage,'preparation');
 assert.equal(f.job.status,unavailable?'pending':'processing');
});
test('failure immediately before invocation retains conservative existing uncertainty',async()=>{
 const f=fixture(false,'actor',true);
 f.job.request={method:'POST',contentType:'json'};
 f.prepareRequest(request=>Object.defineProperty(request,'path',{get(){throw new Error('private');}}));
 await f.run();
 assert.equal(f.operations(),0);
 const d=f.job.response.uploadFailure;
 assert.equal(d.stage,'pre_dispatch');assert.equal(d.requestInvoked,false);assert.equal(d.failureCategory,'unknown_failure');
 assert.equal(f.job.status,'failed');
 assert.equal(f.job.error_message,'Report upload outcome is unconfirmed. Reconcile before retrying.');
});

for (const bodyFails of [false,true]) test('upload redirect metadata survives body handling; no replay '+bodyFails, async()=>{
 const f=fixture(false,'actor',true);
 const url='https://praktika.praktika.net.au/php/forms/db_updateFormData.php';
 f.job.request={method:'POST',path:'/php/forms/db_updateFormData.php',contentType:'multipart_storage',reportDraftId:'synthetic',body:{file:{bucket:'fixture',path:'PRIVATE',fieldName:'file',fileName:'PRIVATE'}}};
 f.setHeaders({location:'/php/security/db_refreshToken.php?PRIVATE#PRIVATE','set-cookie':'PRIVATE'});
 f.setResponse('PRIVATE',url); f.setHttp(307); if(bodyFails) f.failRead();
 await f.run();
 const diagnostic=f.job.response.uploadFailure;
 assert.equal(diagnostic.exactRefreshTokenTarget,true); assert.equal(diagnostic.setCookiePresent,true);
 assert.equal(diagnostic.sameOrigin,true); assert.equal(diagnostic.responseUrlMatchesExpected,true);
 assert.equal(diagnostic.stage,bodyFails?'response_read':'response_validation');
 assert.equal(diagnostic.requestInvoked,true); assert.equal(diagnostic.jobId,'job');
 assert.equal(f.job.status,'failed');
 assert.equal(f.job.error_message,'Report upload outcome is unconfirmed. Reconcile before retrying.');
 assert.doesNotMatch(JSON.stringify([f.logs,f.job.response]),/PRIVATE|refreshToken|https:|set-cookie/);
 await f.run();assert.equal(f.operations(),1);
});


test('ordinary idle cycle falls from nine calls to six without skipping ownership or continuation discovery', async () => {
  const f = fixture(); f.empty();
  await f.idleCycle();
  assert.deepEqual(f.calls, [
    'ownership:check', 'praktika_sessions:select', // helper session read
    'ownership:check', 'praktika_helper_jobs:select', // continuation discovery
    'ownership:check', 'praktika_helper_jobs:select', // ordinary job discovery
  ]);
  assert.equal(f.calls.length, 9 - 3);
  assert.equal(f.operations(), 0);
});
test('pending work is discovered before authoritative eligibility and claim', async () => {
  const f = fixture(); await f.run();
  const discovery = f.calls.indexOf('praktika_helper_jobs:select');
  const eligibility = f.calls.indexOf('praktika_sessions:select');
  const claim = f.calls.indexOf('praktika_helper_jobs:update');
  assert.ok(discovery < eligibility && eligibility < claim);
  assert.equal(f.calls[eligibility - 1], 'ownership:check');
  assert.equal(f.calls[eligibility + 1], 'ownership:check');
  assert.ok(f.calls.slice(claim + 1).includes('praktika_sessions:select')); // final dispatch eligibility
  assert.equal(f.operations(), 1);
});
for (const reason of ['ownership_rejected', 'generation_mismatch', 'lease_expired']) {
  test(reason + ' after discovery prevents claim and dispatch', async () => {
    const f = fixture();
    f.onDiscovery(() => {
      if (reason === 'generation_mismatch') f.session.helper_instance_id = 'replacement-generation';
      else if (reason === 'lease_expired') f.session.helper_heartbeat_at = new Date(0).toISOString();
      else f.loseOwnership();
    });
    await assert.rejects(f.run(), PraktikaOwnershipLost);
    assert.equal(f.job.status, 'pending'); assert.equal(f.job.attempts, 0);
    assert.equal(f.operations(), 0);
    assert.ok(!f.calls.includes('praktika_helper_jobs:update'));
  });
}
test('expired session lease leaves discovered work pending', async () => {
  const f = fixture(); f.session.helper_heartbeat_at = new Date(0).toISOString();
  await assert.rejects(f.run(), PraktikaOwnershipLost); assert.equal(f.job.status, 'pending'); assert.equal(f.job.attempts, 0); assert.equal(f.operations(), 0);
});
test('disconnected browser cannot discover/claim a job', async () => {
  const f = fixture(); f.disconnect(); await f.run();
  assert.deepEqual(f.calls, ['ownership:check']); assert.equal(f.operations(), 0); assert.equal(f.job.attempts, 0);
});
test('blocked writes retain filtered read discovery beyond the first twenty jobs', async () => {
  const f = fixture(true); f.session.status = 'refreshing';
  f.jobs.unshift(...Array.from({length:20}, (_,i) => ({...f.job, id:'blocked-'+i, job_type:'upload_report_to_praktika'})));
  await f.run();
  // Existing semantics still reject execution while refreshing, but the second
  // discovery is filtered before its limit, so the read receives eligibility checks.
  assert.equal(f.calls.filter(c => c === 'praktika_helper_jobs:select').length, 2);
  assert.equal(f.calls.filter(c => c === 'praktika_sessions:select').length, 2);
  assert.equal(f.operations(), 0); assert.ok(f.jobs.every(j => j.attempts === 0));
});
