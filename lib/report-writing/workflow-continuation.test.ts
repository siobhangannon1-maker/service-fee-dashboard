import { projectWorkflowRecovery } from "./workflow-recovery";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { continuationIntentId, continuationChildId, continuationToken, validContinuationToken, workflowAuthorization, validWorkflowAuthorization } from './workflow-continuation-token';
import { isConfirmedPraktikaUpload } from './praktika-upload-result';

type Row = Record<string, any>;
function declaration(path: string, name: string) {
  const source = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  return ts.transpileModule(fn.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const routeCode = declaration('app/api/report-writing/continue-praktika-workflow/route.ts', 'POST');
function fixture(stage = 'upload') {
  const intentId = 'fixture-intent', lock = 'fixture-lock', actor = 'fixture-actor', secret = 'synthetic-secret';
  const intent: Row = { id: intentId, job_type: 'complete_report_workflow', status: 'processing', locked_by: lock,
    app_user_id: actor, request: { reportDraftId: 'draft', actorUserId: actor, options: { actor: { actorUserId: actor }, praktikaPatientId: '123' } },
    response: { stage, dispatched: false } };
  intent.request.options.authorization = workflowAuthorization('draft', actor, intent.request.options, secret);
  const draft: Row = { id: 'draft', status: 'approved', deleted_at: null, workflow_status: 'running', uploaded_to_praktika: false,
    workflow_praktika_upload_status: 'waiting_for_authentication', workflow_icon_update_status: 'pending', edited_text: 'synthetic approved text' };
  const rows: Record<string, Row[]> = { praktika_helper_jobs: [intent], report_drafts: [draft], mediref_helper_jobs: [{ id: 'existing', status: 'pending', job_type: 'send_mediref_letter', payload: { draftId: 'draft' } }] };
  const events: string[] = [];
  const db = { from(table: string) {
    const filters: Array<(row: Row) => boolean> = []; let patch: Row | null = null; let limit = Infinity;
    const field = (row: Row, key: string) => { const [root, sub] = key.split('->>'); return sub ? String(row[root]?.[sub]) : row[root]; };
    const q: any = {
      select: () => q, abortSignal: () => q,
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
      eq: (key: string, value: unknown) => { filters.push(row => field(row, key) === value); return q; },
      is: (key: string, value: unknown) => { filters.push(row => (field(row, key) ?? null) === value); return q; },
      limit: (n: number) => { limit = n; return q; },
      update: (value: Row) => { patch = value; return q; },
      execute(single = false) {
        const matches = rows[table].filter(row => filters.every(f => f(row))).slice(0, limit);
        if (patch && table === 'report_drafts' && events.includes('fail-draft-update')) return { data: null, error: { code: 'synthetic' } };
        if (patch) matches.forEach(row => Object.assign(row, patch));
        return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
      },
      single: async () => q.execute(true), maybeSingle: async () => q.execute(true),
      then: (resolve: (r: unknown) => void) => Promise.resolve(q.execute()).then(resolve),
    }; return q;
  } };
  let fresh = true, active = true;
  const handler = (name: string) => async () => { events.push(name); return Response.json({ success: true }); };
  const mocks: Row = { db, validContinuationToken, validWorkflowAuthorization, continuationChildId, isConfirmedPraktikaUpload, Request, Date,
    process: { env: { SUPABASE_SERVICE_ROLE_KEY: secret } }, NextResponse: { json: Response.json },
    workflowAccountState: async () => active ? "active" : "inactive", workflowAccountMessage: "Staff account status unavailable.", isUserPraktikaReady: async () => fresh,
    withWorkflowExecution: async (ctx: Row, run: () => Promise<unknown>) => { assert.equal(ctx.actor.actorUserId, actor); return run(); },
    upload: handler('upload'), icon: handler('icon'), mediref: handler('mediref'),
  };
  const call = () => runInNewContext(routeCode + '\nPOST', mocks)(new Request('https://fixture.invalid/api', {
    method: 'POST', headers: { 'X-Workflow-Token': continuationToken(intentId, lock, secret) }, body: JSON.stringify({ intentId, lock }),
  }));
  const child = (status: string, type = 'upload_report_to_praktika', response: unknown = { patient_communication: { iFileId: 42 } }) => {
    rows.praktika_helper_jobs.push({ id: continuationChildId(intentId, type), app_user_id: actor, job_type: type, status, response,
      request: { continuationId: intentId }, locked_at: new Date().toISOString() });
  };
  const dispatchedAgain = () => Object.assign(intent, { status: 'processing', locked_by: lock, response: { ...intent.response, dispatched: false } });
  return { intent, draft, rows, events, mocks, call, child, dispatchedAgain, setFresh: (v: boolean) => { fresh = v; }, setActive: (v: boolean) => { active = v; } };
}
test('stale proof leaves continuation waiting and approved text unchanged', async () => {
  const f = fixture(); f.setFresh(false); await f.call();
  assert.equal(f.intent.status, 'waiting'); assert.deepEqual(f.events, []); assert.equal(f.draft.edited_text, 'synthetic approved text');
  f.setFresh(true); f.dispatchedAgain(); await f.call(); assert.deepEqual(f.events, ['upload']);
});
test('concurrent repeated dispatch invokes upload only once', async () => {
  const f = fixture(); await Promise.all([f.call(), f.call()]); assert.deepEqual(f.events, ['upload']);
});
for (const state of ['pending', 'processing']) test(`${state} exact child is observed without another upload`, async () => {
  const f = fixture(); f.child(state); await f.call(); assert.equal(f.intent.status, 'waiting'); assert.deepEqual(f.events, []);
});
test('uncertain/failed external write is never replayed', async () => {
  const f = fixture(); f.child('failed'); await f.call(); assert.equal(f.intent.status, 'failed'); assert.deepEqual(f.events, []);
});
test('completed but invalid upload result never authorizes next stage', async () => {
  const f = fixture(); f.child('completed', 'upload_report_to_praktika', {}); await f.call(); assert.equal(f.intent.status, 'failed'); assert.deepEqual(f.events, []);
});
test('lost completion acknowledgement reconciles without repeat upload', async () => {
  const f = fixture(); f.child('completed'); Object.assign(f.draft, { uploaded_to_praktika: true, workflow_praktika_upload_status: 'completed' });
  await f.call(); assert.equal(f.intent.response.stage, 'icon'); assert.deepEqual(f.events, []);
});
test('icon cannot run without confirmed upload', async () => {
  const f = fixture('icon'); await f.call(); assert.equal(f.intent.status, 'failed'); assert.deepEqual(f.events, []);
});
for (const status of ['pending', 'processing', 'completed', 'failed']) test(`existing ${status} MediRef job is never duplicated`, async () => {
  const f = fixture('mediref'); f.child('completed'); Object.assign(f.draft, { uploaded_to_praktika: true, workflow_praktika_upload_status: 'completed', workflow_icon_update_status: 'completed' });
  if (status === 'completed') f.draft.workflow_mediref_status = 'completed';
  f.rows.mediref_helper_jobs.length = 0;
  f.rows.mediref_helper_jobs.push({ id: 'existing', status, job_type: 'send_mediref_letter', payload: { draftId: 'draft' } });
  await f.call(); assert.equal(f.intent.status, status === 'failed' ? 'failed' : status === 'completed' ? 'completed' : 'waiting'); assert.deepEqual(f.events, []);
});
test('independent MediRef then upload and icon complete across dispatches', async () => {
  const f = fixture(); f.rows.mediref_helper_jobs.length = 0;
  f.mocks.mediref = async () => { f.events.push('mediref'); f.rows.mediref_helper_jobs.push({ id: 'new', status: 'completed', job_type: 'send_mediref_letter', payload: { draftId: 'draft' } }); f.draft.workflow_mediref_status = 'completed'; return Response.json({success:true}); };
  f.mocks.upload = async () => { f.events.push('upload'); f.child('completed'); Object.assign(f.draft, { uploaded_to_praktika: true, workflow_praktika_upload_status: 'completed' }); return Response.json({ success: true }); };
  f.mocks.icon = async () => { f.events.push('icon'); f.draft.workflow_icon_update_status = 'completed'; return Response.json({ success: true }); };
  await f.call(); f.dispatchedAgain(); await f.call(); f.dispatchedAgain(); await f.call();
  assert.deepEqual(f.events, ['mediref', 'upload', 'icon']); assert.equal(f.intent.status, 'completed');
});
test('disabled actor cannot execute a continuation', async () => {
  const f = fixture(); f.setActive(false); await f.call(); assert.equal(f.intent.status, 'failed'); assert.deepEqual(f.events, []);
});
test('signed dispatch is bound to exact intent and lock', () => {
  const token = continuationToken('a', 'b', 'synthetic');
  assert.equal(validContinuationToken(token, 'a', 'b', 'synthetic'), true);
  assert.equal(validContinuationToken(token, 'a', 'other', 'synthetic'), false);
  assert.equal(validContinuationToken(token, 'other', 'b', 'synthetic'), false);
  assert.equal(validContinuationToken('malformed', 'a', 'b', 'synthetic'), false);
});

test('stored actor/options cannot be changed into a new authorization', async () => {
  const f = fixture(); f.intent.request.options.praktikaPatientId = '999';
  assert.equal((await f.call()).status, 403); assert.deepEqual(f.events, []);
});
test('JSONB property order does not change server authorization', () => {
  const authorization = workflowAuthorization('draft', 'actor', { b: 2, a: 1 }, 'synthetic');
  assert.equal(validWorkflowAuthorization('draft', 'actor', { a: 1, b: 2, authorization }, 'synthetic'), true);
});

test('lost MediRef enqueue acknowledgement observes new job instead of creating another', async () => {
  const f = fixture('mediref'); f.child('completed');
  Object.assign(f.draft, { uploaded_to_praktika: true, workflow_praktika_upload_status: 'completed', workflow_icon_update_status: 'completed' });
  f.rows.mediref_helper_jobs.length = 0;
  f.mocks.mediref = async () => {
    f.events.push('mediref');
    f.rows.mediref_helper_jobs.push({ id: 'created', status: 'pending', job_type: 'send_mediref_letter', payload: { draftId: 'draft' } });
    return Response.json({ success: false }, { status: 503 });
  };
  await f.call(); assert.equal(f.intent.status, 'waiting'); assert.deepEqual(f.events, ['mediref']);
});

test('durable helper failure survives failed draft update and refresh returns failed', async () => {
  const f = fixture(); f.child('failed'); f.events.push('fail-draft-update');
  await f.call(); assert.equal(f.intent.status, 'failed'); assert.equal(f.draft.workflow_status, 'running');
  const db = { from: () => { const q: any = { select: () => q, eq: () => q, in: () => q,
    abortSignal: async () => ({ data: [{ ...f.intent, id: continuationIntentId(f.draft.id) }], error: null }) }; return q; } };
  for (let refresh = 0; refresh < 2; refresh++) {
    const projected: { id: string; workflow_status: string; edited_text: string } = (await projectWorkflowRecovery(db as any, [{ id: String(f.draft.id), workflow_status: String(f.draft.workflow_status), edited_text: String(f.draft.edited_text) }]))[0];
    assert.equal(projected.workflow_status, 'failed'); assert.equal(projected.edited_text, 'synthetic approved text');
  }
});
test('unavailable account pauses without external operation', async () => {
  const f = fixture(); f.mocks.workflowAccountState = async () => 'unavailable';
  await f.call(); assert.equal(f.intent.status, 'waiting'); assert.equal(f.intent.response.issue, 'account_unavailable'); assert.deepEqual(f.events, []);
});
test('completed icon with unreconcilable target stops rather than re-enqueues', async () => {
  const f = fixture('icon'); f.child('completed'); f.child('completed', 'update_praktika_letter_icons', { success: true });
  Object.assign(f.draft, { uploaded_to_praktika: true, workflow_praktika_upload_status: 'completed' });
  f.mocks.icon = async () => Response.json({ success: false }, { status: 502 });
  await f.call(); assert.equal(f.intent.status, 'failed'); assert.deepEqual(f.events, []);
});
test('periodontal uncertainty before insertion waits without MediRef enqueue', async () => {
  const f = fixture('mediref'); f.child('completed');
  Object.assign(f.draft,{uploaded_to_praktika:true,workflow_praktika_upload_status:'completed',workflow_icon_update_status:'completed'});
  f.rows.mediref_helper_jobs.length = 0;
  f.mocks.mediref=async()=>Response.json({success:false,stage:'periodontal_preparation',insertionOutcome:'not_attempted'},{status:503});
  await f.call(); assert.equal(f.intent.status,'waiting'); assert.equal(f.intent.response.issue,'periodontal_unavailable');
  assert.equal(f.rows.mediref_helper_jobs.length,0);
});

for (const complete of [false, true]) test(`legacy upload intent with stale proof independently prepares MediRef (complete=${complete})`, async () => {
  const f = fixture(); f.rows.mediref_helper_jobs.length = 0; f.setFresh(false);
  f.mocks.mediref = async () => { f.events.push('mediref');
    f.rows.mediref_helper_jobs.push({ id:'new',status:complete?'completed':'pending',job_type:'send_mediref_letter',payload:{draftId:'draft'} });
    f.draft.workflow_mediref_status = complete ? 'completed' : 'running'; return Response.json({success:true}); };
  await f.call(); f.dispatchedAgain(); await f.call();
  assert.deepEqual(f.events,['mediref']); assert.equal(f.intent.status,'waiting');
  assert.equal(f.draft.workflow_status,'running'); assert.equal(f.draft.workflow_praktika_upload_status,'waiting_for_authentication');
  if (complete) assert.match(f.draft.workflow_last_message,/MediRef prepared/);
  f.setFresh(true); f.dispatchedAgain(); await f.call(); assert.deepEqual(f.events,['mediref','upload']);
});
test('uncertain icon cannot be replayed after independent MediRef completion', async () => {
  const f = fixture('icon'); f.child('completed'); f.child('failed','update_praktika_letter_icons');
  Object.assign(f.draft,{uploaded_to_praktika:true,workflow_praktika_upload_status:'completed',workflow_mediref_status:'completed'});
  await f.call(); assert.equal(f.intent.status,'failed'); assert.deepEqual(f.events,[]);
});
for (const thrown of [false,true]) test(`History preserves durable partial fields on projection failure (throw=${thrown})`,async()=>{
  const draft={id:'draft',workflow_status:'running',workflow_praktika_upload_status:'waiting_for_authentication',workflow_mediref_status:'completed'};
  const q:any={select:()=>q,eq:()=>q,in:()=>q,abortSignal:async()=>{if(thrown)throw new Error('SECRET');return{error:{message:'SECRET'},data:null};}};
  const result=await projectWorkflowRecovery({from:()=>q} as any,[draft]);
  for(const key of Object.keys(draft))assert.equal((result[0] as any)[key],(draft as any)[key]);
  assert.match((result[0] as any).workflow_reconciliation_warning,/temporarily out of date/);assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});
