import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { approvalResponse, readApprovalResponse } from './typist-approval-stream';
import { partitionApprovedForVerification } from './typist-approved-partition';
import { toDraftListItem } from './draft-contract';
import { approvedDraftFixture } from './typist-approval-fixtures.test-helper';

// Run the real page handlers with synthetic state and deferred responses.
const source = readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx', 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'TypistPage')!;
const names = ['saveNewDraft', 'loadQueue', 'loadDrafts', 'clearForm', 'beginPatientSelection', 'isCurrentProviderDataRequest'];
const handlers = names.map(name => page.body!.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name)!.getText(ast)).join('\n');
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const settle = () => new Promise(r => setImmediate(r));
const draft = approvedDraftFixture({ id: 'a', provider_id: 'provider' });
const row = (id: string) => ({ id, status: 'started', report_draft_id: null });
type State = Record<string, unknown>;
function fixture(image = false) {
  const state: State = { selectedDraft: { ...draft, status: 'draft' }, listTab: 'queue', activeQueueItemId: 'queue-a',
    selectedProviderId: 'provider', imageDraftId: image ? draft.id : null, loading: false,
    patientFirstName: 'Synthetic', patientLastName: 'Fixture', patientName: 'Synthetic Fixture', patientDob: null, patientGender: 'neutral',
    letterText: 'Synthetic final', generatedAiLetterText: 'Synthetic original', referrerName: '', referrerAddress: '',
    reportType: 'consultation_report', clinicalNotes: '', typistQueries: '', selectedPraktikaPatientId: null, queueStatusTab: 'active', saveStatus: 'idle',
    queue: [row('queue-a'), row('queue-b')], drafts: [], detailLoading: false, detailError: null };
  const queueToken = { current: 0 }, workspace = { current: { listTab: 'queue', activeQueueItemId: 'queue-a' as string | null } };
  const requests: { url: string; reply: (data: object, ok?: boolean) => void }[] = [];
  const saveGate = gate<Response>();
  let autoSelections = 0;
  const globals: Record<string, unknown> = {
    URLSearchParams, Date, Error, console, clearTimeout, confirm: () => true, alert() {}, readApprovalResponse,
    queueSelectionTokenRef: queueToken, queueWorkspaceRef: workspace,
    queueListRequestSequenceRef: { current: 0 }, draftListRequestSequenceRef: { current: 0 },
    draftListMountedRef: { current: true }, providerDataRequestRef: { current: 1 }, selectedProviderIdRef: { current: 'provider' },
    pendingPatientSavesRef: { current: {} }, patientSaveChainsRef: { current: new Map() }, localDraftEditsRef: { current: new Map() },
    autosaveTimerRef: { current: null }, patientDetailsAutosaveTimerRef: { current: null }, referrerAutosaveTimerRef: { current: null },
    lastAutosavedTextRef: { current: '' }, autoImageDraftQueueIdRef: { current: null }, DEFAULT_PDF_BODY_FONT_SIZE: 10,
    getLetterTextForSave: () => state.letterText, hydrateQueueInBackground: async () => ({ enqueued: 0 }),
    selectDraft: () => { autoSelections++; }, mergeDraftWorkflow: (current: object, item: object) => ({ ...current, ...item }),
    fetch: (url: string) => {
      if (url.includes('save-draft') || url.includes('update-draft')) return saveGate.promise;
      const pending = gate<Response>(); requests.push({ url, reply: (data, ok = true) => pending.resolve(Response.json(data, { status: ok ? 200 : 500 })) }); return pending.promise;
    },
  };
  for (const name of new Set(handlers.match(/\bset[A-Z]\w+/g))) {
    const key = name.slice(3, 4).toLowerCase() + name.slice(4);
    globals[name] = (value: unknown) => {
      state[key] = typeof value === 'function' ? value(state[key]) : value;
      if (key === 'listTab' || key === 'activeQueueItemId') workspace.current = { listTab: String(state.listTab), activeQueueItemId: state.activeQueueItemId as string | null };
    };
  }
  const factory = runInNewContext(ts.transpileModule(`(snapshot => { const {${Object.keys(state).join(',')}} = snapshot; ${handlers}; return {${names.join(',')}}; })`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals) as (state: State) => {
    saveNewDraft: (status: string) => Promise<void>; loadQueue: (provider: string) => Promise<void>; loadDrafts: (provider: string) => Promise<void>;
  };
  return { state, requests, queueToken, workspace, saveGate, globals, api: () => factory({ ...state }), autoSelections: () => autoSelections,
    tab: (tab: string) => { state.listTab = tab; workspace.current.listTab = tab; },
    selectOther: () => { queueToken.current++; state.selectedDraft = { id: 'b' }; state.activeQueueItemId = 'queue-b'; workspace.current.activeQueueItemId = 'queue-b'; },
  };
}
async function acknowledge(f: ReturnType<typeof fixture>, learningFailure = false) {
  const learning = gate<void>(); let finished = false;
  const response = await approvalResponse({ typist: true, draft, initialLearning: { requested: true, exampleSaved: false, exampleId: null, duplicate: false, analysisStatus: 'pending', behavioursCreated: 0, behavioursReinforced: 0, error: null },
    audit: async () => {}, synchronous: async () => { await learning.promise; finished = true; if (learningFailure) throw new Error('Synthetic learning failure'); return { requested: true, exampleSaved: false, exampleId: null, duplicate: false, analysisStatus: 'ignored', behavioursCreated: 0, behavioursReinforced: 0, error: null }; } });
  f.saveGate.resolve(response); await settle();
  return { finish: async () => { learning.resolve(); await settle(); assert.equal(finished, true); } };
}
for (const image of [false, true]) for (const learningFailure of [false, true]) {
  test(`Queue approval preserves tab; authoritative removal clears editor without next selection; late learning is inert (image=${image}, failure=${learningFailure})`, async () => {
    const f = fixture(image); const approval = f.api().saveNewDraft('approved'); await settle();
    assert.equal(f.state.selectedDraft && (f.state.selectedDraft as State).id, 'a');
    const learning = await acknowledge(f, learningFailure);
    assert.equal(f.state.listTab, 'queue'); assert.equal((f.state.selectedDraft as State).id, 'a'); assert.equal(f.state.letterText, 'Synthetic final');
    assert.equal(f.requests.length, 1); assert.match(f.requests[0].url, /letter-queue/);
    f.requests[0].reply({ success: true, queue: [row('queue-b')] }); await settle();
    assert.equal(f.state.selectedDraft, null); assert.equal(f.state.activeQueueItemId, null); assert.equal(f.state.letterText, ''); assert.equal(f.state.imageDraftId, null);
    assert.equal(f.state.detailError, null); assert.equal(f.state.detailLoading, false); assert.equal(f.state.generatedAiLetterText, '');
    assert.equal(f.state.listTab, 'queue'); assert.equal(f.autoSelections(), 0);
    assert.equal(f.requests.length, 2); f.requests[1].reply({ success: true, drafts: [draft] }); await approval;
    assert.equal((f.state.queue as unknown[]).length, 1); assert.equal((f.state.drafts as unknown[]).length, 1);
    const before = JSON.stringify(f.state); await learning.finish(); assert.equal(JSON.stringify(f.state), before);
  });
}
test('user tab change during pending approval is respected through reconciliation and late learning', async () => {
  const f = fixture(); const approval = f.api().saveNewDraft('approved'); await settle(); f.tab('verification');
  const learning = await acknowledge(f); assert.equal(f.state.listTab, 'verification');
  f.requests[0].reply({ success: true, queue: [row('queue-b')] }); await settle();
  f.requests[1].reply({ success: true, drafts: [draft] }); await approval; await learning.finish();
  assert.equal(f.state.listTab, 'verification'); assert.equal((f.state.selectedDraft as State).id, 'a'); assert.equal(f.autoSelections(), 0);
});
test('approval failure does not clear selection or request reconciliation', async () => {
  const f = fixture(); const approval = f.api().saveNewDraft('approved'); await settle();
  f.saveGate.resolve(Response.json({ success: false, error: 'Synthetic failure' }, { status: 500 })); await approval;
  assert.equal((f.state.selectedDraft as State).id, 'a'); assert.equal(f.state.letterText, 'Synthetic final'); assert.equal(f.requests.length, 0); assert.equal(f.state.listTab, 'queue');
});
test('failed authoritative Queue refresh preserves editor after acknowledgement', async () => {
  const f = fixture(); const approval = f.api().saveNewDraft('approved'); await settle(); const learning = await acknowledge(f);
  f.requests[0].reply({ success: false, queue: [] }, false); await settle(); f.requests[1].reply({ success: true, drafts: [draft] }); await approval;
  assert.equal((f.state.selectedDraft as State).id, 'a'); assert.equal(f.state.activeQueueItemId, 'queue-a'); assert.equal(f.state.letterText, 'Synthetic final'); await learning.finish();
});
test('another selected Queue item survives approval reconciliation', async () => {
  const f = fixture(); const approval = f.api().saveNewDraft('approved'); await settle(); const learning = await acknowledge(f);
  f.selectOther(); f.requests[0].reply({ success: true, queue: [row('queue-b')] }); await settle();
  f.requests[1].reply({ success: true, drafts: [draft] }); await approval; await learning.finish();
  assert.equal((f.state.selectedDraft as State).id, 'b'); assert.equal(f.state.activeQueueItemId, 'queue-b'); assert.equal(f.autoSelections(), 0);
});
test('older Queue absence cannot clear selection after newer response retained it', async () => {
  const f = fixture(); const old = f.api().loadQueue('provider'), newer = f.api().loadQueue('provider');
  f.requests[1].reply({ success: true, queue: [row('queue-a'), row('queue-b')] }); await newer;
  f.requests[0].reply({ success: true, queue: [] }); await old;
  assert.equal((f.state.selectedDraft as State).id, 'a'); assert.equal((f.state.queue as unknown[]).length, 2);
});
test('newer Queue failure still invalidates older absence', async () => {
  const f = fixture(); const old = f.api().loadQueue('provider'), newer = f.api().loadQueue('provider');
  f.requests[1].reply({ success: false }, false); await newer; f.requests[0].reply({ success: true, queue: [] }); await old;
  assert.equal((f.state.selectedDraft as State).id, 'a');
});
test('authoritative draft response alone cannot clear Queue based on local linked-draft filtering', async () => {
  const f = fixture(); const refresh = f.api().loadDrafts('provider'); f.requests[0].reply({ success: true, drafts: [draft] }); await refresh;
  assert.equal((f.state.selectedDraft as State).id, 'a'); assert.equal(f.state.letterText, 'Synthetic final');
});
test('Queue response after provider switch or unmount cannot clear selection', async () => {
  for (const unmount of [false, true]) {
    const f = fixture(); const refresh = f.api().loadQueue('provider');
    if (unmount) (f.globals.draftListMountedRef as { current: boolean }).current = false;
    else (f.globals.selectedProviderIdRef as { current: string }).current = 'other';
    f.requests[0].reply({ success: true, queue: [] }); await refresh; assert.equal((f.state.selectedDraft as State).id, 'a');
  }
});

// Execute the page's existing count/filter declarations so the UX change cannot
// hide a card/count regression behind a list-length assertion.
test('authoritative Queue removal and workflow reconciliation preserve actual card counts', () => {
  const declarations = ['approvedPartition', 'visibleQueue', 'countDrafts', 'countAwaiting', 'countCompleted', 'countVerification'];
  const code = page.body!.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => declarations.includes(d.name.getText(ast)))).map(n => n.getText(ast)).join('\n');
  const evaluate = (drafts: unknown[], queue: unknown[]) => runInNewContext(ts.transpileModule(code + '\n({queue:visibleQueue.length,drafts:countDrafts,awaiting:countAwaiting,approved:countCompleted,verification:countVerification})', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { drafts, queue, partitionApprovedForVerification, useMemo: (fn: () => unknown) => fn() });
  const approved = toDraftListItem({ ...draft, workflow_continuation_context: 'present', workflow_resolved: { status: 'not_started', branches: { praktika: 'unknown', mediref: 'unknown', icon: 'unknown', periodontal: 'unknown' }, lookupUnavailable: false, message: null, lastProgressAt: null, praktikaRecovery: false, medirefRecovery: false } }, true);
  const saved = toDraftListItem({ ...draft, id: 'saved', status: 'draft' }, true);
  const awaiting = toDraftListItem({ ...draft, id: 'awaiting', status: 'awaiting_provider_approval' }, true);
  const initial = evaluate([saved, awaiting], [row('queue-a'), row('queue-b')]);
  assert.equal(initial.queue, 2); assert.equal(initial.drafts, 1); assert.equal(initial.awaiting, 1); assert.equal(initial.approved, 0);
  const refreshed = evaluate([approved, saved, awaiting], [row('queue-b')]);
  assert.equal(refreshed.queue, 1); assert.equal(refreshed.drafts, 1); assert.equal(refreshed.awaiting, 1); assert.equal(refreshed.approved, 1); assert.equal(refreshed.verification, 0);
  const completed = { ...approved, workflow_resolved: { ...approved.workflow_resolved!, status: 'completed', branches: { praktika: 'completed', mediref: 'completed', icon: 'skipped', periodontal: 'skipped' } } };
  const reconciled = evaluate([completed, saved, awaiting], [row('queue-b')]);
  assert.equal(reconciled.queue, 1); assert.equal(reconciled.approved, 0); assert.equal(reconciled.verification, 0);
});
