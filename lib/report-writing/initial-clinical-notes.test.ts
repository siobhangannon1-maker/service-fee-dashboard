import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { canGenerateFromClinicalNotes, loadInitialClinicalNotes } from './initial-clinical-notes';

const scope = { providerId: 'provider', queueId: 'queue', isCurrent: () => true };
const cache = (text: string): typeof fetch => async () => Response.json({ success: true, ...scope, clinicalNotes: text });
test('Generate is disabled for unresolved/failed/empty selected queue notes and enabled only after success', () => {
  const options = { loading: false, detailLoading: false, queueSelected: true, text: 'Synthetic notes' };
  for (const notesStatus of ['idle', 'loading', 'error'] as const) assert.equal(canGenerateFromClinicalNotes({ ...options, notesStatus }), false);
  assert.equal(canGenerateFromClinicalNotes({ ...options, notesStatus: 'ready' }), true);
  assert.equal(canGenerateFromClinicalNotes({ ...options, notesStatus: 'ready', text: '' }), false);
  assert.equal(canGenerateFromClinicalNotes({ ...options, notesStatus: 'ready', detailLoading: true }), false);
});
test('authoritative cache is read freshly rather than using an old queue snapshot', async () => {
  let live = 0;
  assert.deepEqual(await loadInitialClinicalNotes({ ...scope, request: cache('Fresh clinical notes'), readLive: async () => { live++; return 'Live'; } }),
    { text: 'Fresh clinical notes', fromCache: true });
  assert.equal(live, 0);
});
test('short canonical notes are accepted independently of appointment metadata length', async () => {
  assert.equal((await loadInitialClinicalNotes({ ...scope, request: cache('Short') }))?.text, 'Short');
});
test('empty cache uses the existing authoritative live-note lookup', async () => {
  assert.deepEqual(await loadInitialClinicalNotes({ ...scope, request: cache(''), readLive: async () => 'Live clinical notes' }),
    { text: 'Live clinical notes', fromCache: false });
});
test('hydration completing during an empty live lookup is picked up before reporting failure', async () => {
  let reads = 0;
  const request: typeof fetch = async () => Response.json({ success: true, ...scope, clinicalNotes: ++reads === 1 ? '' : 'Hydrated notes' });
  assert.equal((await loadInitialClinicalNotes({ ...scope, request, readLive: async () => '' }))?.text, 'Hydrated notes');
});
for (const mode of ['empty', 'failed', 'malformed']) test(`${mode} lookup errors are controlled and never use appointment text`, async () => {
  const request: typeof fetch = mode === 'failed' ? async () => { throw Error('PRIVATE_UPSTREAM'); }
    : mode === 'malformed' ? async () => Response.json({ success: true, providerId: 'other', queueId: 'queue', clinicalNotes: 'OTHER_PATIENT' }) : cache('');
  await assert.rejects(loadInitialClinicalNotes({ ...scope, request, readLive: async () => '' }), error =>
    /Retry/.test(String(error)) && !/PRIVATE_UPSTREAM|OTHER_PATIENT/.test(String(error)));
});
test('late live response after a selection change is discarded', async () => {
  let active = true, resolve!: (text: string) => void;
  const pending = loadInitialClinicalNotes({ ...scope, isCurrent: () => active, request: cache(''), readLive: () => new Promise(r => { resolve = r; }) });
  await settle(); active = false; resolve('A clinical notes'); assert.equal(await pending, null);
});
async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }

const pagePath = 'app/(protected)/report-writing/typist/TypistPage.tsx';
const pageSource = readFileSync(pagePath, 'utf8');
const ast = ts.createSourceFile(pagePath, pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TypistPage') as ts.FunctionDeclaration;
const names = ['beginPatientSelection', 'startLetterFromQueue', 'loadInitialQueueNotes', 'retryInitialQueueNotes', 'generateLetter'];
const handlers = names.map(name => component.body!.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(ast)).join('\n');
type Values = Record<string, any>; // VM bindings execute actual component handlers.
function fixture() {
  const state: Values = { selectedProviderId: 'provider', selectedDraft: null, detailLoading: false, loading: false, saveStatus: 'idle',
    activeQueueItemId: null, clinicalNotes: '', clinicalNotesLoadStatus: 'idle', clinicalNotesLoadError: '', queue: [], reportTypes: [],
    patientFirstName: '', patientLastName: '', patientName: 'Synthetic Fixture', patientDob: '', patientGender: 'neutral',
    referrerName: '', referrerAddress: '', reportType: 'consultation_report', preferredExampleId: '' };
  const refs = { clinicalNotesRequestRef: { current: 0 }, queueSelectionTokenRef: { current: 0 }, selectedProviderIdRef: { current: 'provider' },
    pendingPatientSavesRef: { current: {} }, localDraftEditsRef: { current: new Map() }, patientSaveChainsRef: { current: new Map() },
    lastAutosavedTextRef: { current: '' }, autoImageDraftQueueIdRef: { current: null } };
  const requests: { provider: string; queue: string; reply: (text: string, status?: number) => void }[] = [];
  const generated: Values[] = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).includes('queue-clinical-notes')) {
      const params = new URL(String(url), 'https://fixture.invalid').searchParams;
      return new Promise(resolve => requests.push({ provider: params.get('providerId')!, queue: params.get('queueId')!, reply: (text, status = 200) =>
        resolve(Response.json({ success: status === 200, providerId: params.get('providerId'), queueId: params.get('queueId'), clinicalNotes: text }, { status })) }));
    }
    if (String(url) === '/api/report-writing/generate') generated.push(JSON.parse(String(init?.body)));
    return Response.json({ success: true, report: 'Synthetic generated letter', debug: {} });
  };
  const globals: Values = { ...refs, fetch: request, canGenerateFromClinicalNotes,
    loadInitialClinicalNotes: (options: Parameters<typeof loadInitialClinicalNotes>[0]) => loadInitialClinicalNotes({ ...options, request }),
    cleanString: (v: unknown) => String(v ?? '').trim(), cleanClinicalNoteText: (v: unknown) => String(v ?? '').trim(),
    inferReportTypeFromQueueItem: () => 'consultation_report', getQueueAppointmentNotes: () => 'Appointment metadata must not generate',
    getQueueReferrerName: () => 'Synthetic referrer', getQueueReferrerAddress: () => 'Synthetic address', asPlainObject: (v: unknown) => v || {},
    autoFillReferrerFromLatestPraktikaReferral: async () => {}, classifyReportTypeWithAi: async () => 'consultation_report',
    pullSameDayClinicalNotes: async () => '', getLetterTextForSave: () => '', DEFAULT_PDF_BODY_FONT_SIZE: 10, alert: () => {}, console: { log() {}, warn() {}, error() {} } };
  for (const name of new Set(handlers.match(/\bset[A-Z]\w+/g))) {
    const key = name[3].toLowerCase() + name.slice(4); if (!(key in state)) state[key] = undefined;
    globals[name] = (value: unknown) => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  const code = ts.transpileModule(`(snapshot => { const {${Object.keys(state).join(',')}}=snapshot; ${handlers}; return {${names.join(',')}}; })`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const render = runInNewContext(code, globals) as (state: Values) => Values;
  const item = (id: string, provider = 'provider') => ({ id, provider_id: provider, report_draft_id: null, praktika_patient_id: 'synthetic',
    patient_first_name: 'Synthetic', patient_last_name: id, patient_dob: '', appointment_time: '2026-01-01', raw_json: { cached_clinical_notes: 'OLD SNAPSHOT' } });
  return { state, refs, requests, generated, render: () => render({ ...state }), item,
    enabled: () => canGenerateFromClinicalNotes({ loading: state.loading, detailLoading: state.detailLoading, queueSelected: Boolean(state.activeQueueItemId),
      notesStatus: state.clinicalNotesLoadStatus, text: state.clinicalNotes }) };
}
test('actual selection keeps Generate disabled until the successful initial lookup populates notes', async () => {
  const f = fixture(), item = f.item('A'); f.state.queue = [item];
  const pending = f.render().startLetterFromQueue(item); assert.equal(f.enabled(), false); assert.equal(f.state.clinicalNotesLoadStatus, 'loading');
  await f.render().generateLetter(); assert.equal(f.generated.length, 0);
  f.requests[0].reply('Authoritative A clinical notes'); await pending;
  assert.equal(f.state.clinicalNotes, 'Authoritative A clinical notes'); assert.equal(f.enabled(), true);
});
test('actual failed/empty lookup offers Retry, remains disabled, and Retry can succeed', async () => {
  const f = fixture(), item = f.item('A'); f.state.queue = [item];
  const pending = f.render().startLetterFromQueue(item); f.requests[0].reply(''); await settle(); f.requests[1].reply(''); await pending;
  assert.equal(f.state.clinicalNotes, ''); assert.equal(f.enabled(), false); assert.equal(f.state.clinicalNotesLoadStatus, 'error');
  assert.match(f.state.clinicalNotesLoadError, /Retry/);
  const retry = f.render().retryInitialQueueNotes(); assert.equal(f.state.clinicalNotesLoadStatus, 'loading'); f.requests[2].reply('Retry loaded notes'); await retry;
  assert.equal(f.enabled(), true); assert.equal(f.state.clinicalNotes, 'Retry loaded notes');
});
test('actual generation uses visible edits; later queue hydration cannot replace the editor', async () => {
  const f = fixture(), item = f.item('A'); f.state.queue = [item]; const pending = f.render().startLetterFromQueue(item);
  f.requests[0].reply('Authoritative notes'); await pending; f.state.clinicalNotes = '\nIntentional user-edited notes\n';
  f.state.queue = [{ ...item, raw_json: { cached_clinical_notes: 'Later hydrated notes' } }];
  await f.render().generateLetter(); assert.equal(f.generated[0].clinicalNotes, '\nIntentional user-edited notes\n');
  assert.equal(f.state.clinicalNotes, '\nIntentional user-edited notes\n');
});
for (const boundary of ['patient/queue', 'provider']) test(`actual ${boundary} switch discards A response and resets B loading`, async () => {
  const f = fixture(), a = f.item('A'), b = f.item('B', boundary === 'provider' ? 'other' : 'provider');
  f.state.queue = [a, b]; const old = f.render().startLetterFromQueue(a);
  f.state.selectedProviderId = b.provider_id; f.refs.selectedProviderIdRef.current = b.provider_id;
  const fresh = f.render().startLetterFromQueue(b); assert.equal(f.state.clinicalNotesLoadStatus, 'loading'); assert.equal(f.state.clinicalNotes, '');
  f.requests[0].reply('A must never install'); await old; assert.equal(f.state.clinicalNotes, ''); assert.equal(f.enabled(), false);
  f.requests[1].reply('B authoritative input'); await fresh; assert.equal(f.state.clinicalNotes, 'B authoritative input'); assert.equal(f.enabled(), true);
});
test('actual JSX disables Generate and exposes a retry; no appointment fallback remains in loading lifecycle', () => {
  const begin = pageSource.indexOf('  async function startLetterFromQueue'), end = pageSource.indexOf('  async function updateQueueStatus', begin);
  const block = pageSource.slice(begin, end);
  assert.doesNotMatch(block, /sameDayClinicalNotes \|\| appointmentNotes|setClinicalNotes\(appointmentNotes|setClinicalNotes\(fallback/);
  assert.match(pageSource, /disabled=\{!canGenerateFromClinicalNotes/); assert.match(pageSource, /onClick=\{retryInitialQueueNotes\}/);
});
test('saved drafts restore saved clinical input and are not refreshed from the canonical cache', () => {
  const provider = readFileSync('app/(protected)/report-writing/provider/ProviderReportClient.tsx', 'utf8');
  const block = provider.slice(provider.indexOf('  function applyDraftToEditor'), provider.indexOf('  function editApprovedLetter'));
  assert.match(block, /setClinicalNotes\(draft.clinical_notes \|\| draft.source_clinical_notes \|\| draft.source_text/);
  assert.doesNotMatch(block, /setClinicalNotes\(draft.ai_generated_text/);
  const typist = pageSource.slice(pageSource.indexOf('  function applyDraftDetail'), pageSource.indexOf('  async function autoFillReferrer'));
  assert.match(typist, /setClinicalNotes\(getDraftClinicalNotes\(draft\)\)/); assert.match(typist, /setClinicalNotesLoadStatus\("ready"\)/);
});

const routePath = 'app/api/report-writing/queue-clinical-notes/route.ts';
const routeSource = readFileSync(routePath, 'utf8');
const routeAst = ts.createSourceFile(routePath, routeSource, ts.ScriptTarget.Latest, true);
const handler = routeAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'GET')!;
const routeCode = ts.transpileModule(handler.getText(routeAst).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class ApiAuthorizationError extends Error { constructor(public status: number) { super(); } }
async function runRoute(role = 'typist', linked = false, deny = 0, missing = false, notes = 'Canonical notes') {
  const reads: string[] = [];
  const db = { from(table: string) { reads.push(table); const row = table === 'user_roles' ? { role } : table === 'providers'
    ? { id: '11111111-1111-4111-8111-111111111111', user_id: linked ? 'actor' : 'other' } : missing ? null
    : { raw_json: { cached_clinical_notes: notes, source_clinical_notes: 'APPOINTMENT_ONLY' }, source_clinical_notes: 'APPOINTMENT_ONLY' };
    const q = { select: () => q, eq: () => q, abortSignal: () => q, maybeSingle: async () => ({ data: row, error: null }) }; return q; } };
  const GET = runInNewContext(routeCode + '\nGET', { NextResponse: { json: Response.json }, headers: { 'Cache-Control': 'private, no-store' }, URL, AbortSignal,
    ApiAuthorizationError, requireActiveApiUser: async () => { if (deny) throw new ApiAuthorizationError(deny); return { user: { id: 'actor' }, supabase: db }; }, supabaseAdmin: db });
  const response: Response = await GET(new Request('https://fixture.invalid?providerId=11111111-1111-4111-8111-111111111111&queueId=22222222-2222-4222-8222-222222222222'));
  return { response, reads };
}
for (const role of ['typist', 'admin', 'super_admin', 'practice_manager']) test(`cache reader preserves active ${role} access and no-store response`, async () => {
  const f = await runRoute(role); assert.equal(f.response.status, 200); assert.equal(f.response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await f.response.json()).clinicalNotes, 'Canonical notes');
});
test('cache reader permits linked providers and denies unlinked/inactive users before queue reads', async () => {
  assert.equal((await runRoute('provider_readonly', true)).response.status, 200);
  for (const deny of [401, 403]) { const f = await runRoute('typist', false, deny); assert.equal(f.response.status, deny); assert.equal(f.reads.length, 0); }
  const denied = await runRoute('provider_readonly'); assert.equal(denied.response.status, 403); assert.equal(denied.reads.includes('report_letter_queue'), false);
});
test('empty canonical cache never returns administrative source text; endpoint is read-only', async () => {
  const f = await runRoute('typist', false, 0, false, ''); assert.equal((await f.response.json()).clinicalNotes, '');
  assert.doesNotMatch(routeSource, /\.(insert|update|delete|upsert|rpc)\s*\(/);
});
