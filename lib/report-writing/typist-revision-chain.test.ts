import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { approvalResponse, isTypistApproval, readApprovalResponse } from './typist-approval-stream'
import { approvedDraftFixture } from './typist-approval-fixtures.test-helper'
import { mergeDraftWorkflow, type DraftDetail } from './draft-contract'
import { partitionApprovedForVerification } from './typist-approved-partition'
import { resolveWorkflow } from './resolved-workflow'

const path = 'app/(protected)/report-writing/typist/TypistPage.tsx'
const source = readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const page = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'TypistPage') as ts.FunctionDeclaration
const names = ['savePatientDraft', 'updateExistingDraft', 'saveNewDraft', 'getSaveStatusLabel', 'getLetterTextForSave',
  'beginPatientSelection', 'clearForm', 'selectDraft', 'applyDraftDetail', 'loadDrafts', 'isCurrentProviderDataRequest'] as const
const handlers = names.map(name => {
  const fn = page.body!.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(fn, name); return fn.getText(ast)
}).join('\n')
const effects = page.body!.statements.flatMap(n => {
  if (!ts.isExpressionStatement(n) || !ts.isCallExpression(n.expression) || n.expression.expression.getText(ast) !== 'useEffect') return []
  const callback = n.expression.arguments[0].getText(ast)
  return /pendingPatientSavesRef.current\.(letter|patient|referrer) = run/.test(callback) ? [callback] : []
})
assert.equal(effects.length, 3)
const route = readFileSync('app/api/report-writing/update-draft/route.ts', 'utf8')
const routeCode = ts.transpileModule(route.slice(route.indexOf('function clean(')).replace('export async function POST', 'async function POST') + '\nPOST', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const R0 = '2026-01-01T00:00:00.000Z'
const revision = (n: number) => `2026-01-01T00:00:00.${String(n).padStart(3, '0')}Z`
const noLearning = () => ({ requested: false, exampleSaved: false, exampleId: null, duplicate: false,
  analysisStatus: 'ignored', behavioursCreated: 0, behavioursReinforced: 0, error: null })
function gate() {
  let release!: () => void
  return { promise: new Promise<void>(r => { release = r }), release: () => release() }
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise<void>(r => setImmediate(r))
  assert.ok(check(), 'synthetic operation settled')
}
type Pending = Promise<Response> & { invalidated?: boolean; observedState?: { revision: string | null; status: string | null }; revisions: Set<string | null> }
type Api = {
  savePatientDraft: (id: string, request: RequestInit, context?: { providerId: string; selectionToken: number; status?: string | null }) => Pending
  updateExistingDraft: (status: string) => Promise<void>
  saveNewDraft: (status: string) => Promise<void>
  getSaveStatusLabel: () => string
  beginPatientSelection: () => void
  clearForm: () => void
  selectDraft: (draft: { id: string }) => Promise<void>
  applyDraftDetail: (draft: DraftDetail) => void
  loadDrafts: (providerId: string) => Promise<void>
  effects: Array<() => (() => void) | undefined>
}

// Execute the actual client handlers/effects against the actual server route.
// Only storage, authentication and transport are synthetic; UPDATE predicates
// and the streamed approval implementation are production code.
function fixture(status = 'draft') {
  const a = { ...approvedDraftFixture(), id: 'A', provider_id: 'P', status, updated_at: R0,
    edited_text: 'Initial', ai_generated_text: 'Original',
    provider_approved_at: status === 'approved' ? R0 : null,
    approved_by_name: status === 'approved' ? 'Original provider' : null,
    approved_by_initials: status === 'approved' ? 'OP' : null }
  const rows = new Map<string, DraftDetail>([['A', a], ['B', { ...a, id: 'B', provider_id: 'Q' }]])
  const audits: string[] = [], queue: string[] = [], learning: string[] = [], requests: Array<Record<string, unknown>> = []
  const writeHolds = new Map<string, ReturnType<typeof gate>>()
  const responseHolds = new Map<string, ReturnType<typeof gate>>()
  const started = new Set<string>()
  let failure: number | 'network' | undefined, learningHold: ReturnType<typeof gate> | undefined
  class FrozenDate extends Date {
    constructor(value?: string | number) { super(value ?? R0) }
    static now() { return Date.parse(R0) }
  }
  const db = { from(table: string) {
    let payload: Record<string, unknown> | undefined
    const filters: Record<string, unknown> = {}
    const query = {
      select() { return query }, eq(k: string, v: unknown) { filters[k] = v; return query },
      is(k: string, v: unknown) { filters[k] = v; return query },
      update(value: Record<string, unknown>) { payload = value; return query },
      async single() { return { data: { ...rows.get(String(filters.id)) }, error: null } },
      async maybeSingle() {
        assert.equal(table, 'report_drafts')
        const text = String(payload?.edited_text || '')
        started.add(text); await writeHolds.get(text)?.promise
        const row = rows.get(String(filters.id))!
        if (Object.entries(filters).some(([k, v]) => (row as unknown as Record<string, unknown>)[k] !== v))
          return { data: null, error: null }
        const saved = { ...row, ...payload }; rows.set(saved.id, saved)
        return { data: { ...saved }, error: null }
      },
      then(resolve: (value: unknown) => void) {
        assert.equal(table, 'report_letter_queue'); queue.push('queue update'); resolve({ error: null })
      },
    }
    return query
  } }
  const post = runInNewContext(routeCode, {
    supabase: db, sensitiveApiAccess: async () => null,
    getAuditActor: async () => ({ actorFullName: 'Authenticated typist', actorInitials: 'AT', actorRole: 'typist' }),
    createReportAuditEvent: async (event: { action: string }) => { audits.push(event.action) },
    approvalResponse, isTypistApproval, noLearningRequested: noLearning,
    processApprovedEdit: async () => { learning.push('started'); await learningHold?.promise; learning.push('finished'); return noLearning() },
    NextResponse: { json: Response.json }, Date: FrozenDate, console: { error() {}, warn() {} },
  }) as (request: Request) => Promise<Response>
  const direct = (body: Record<string, unknown>) => post(new Request('http://synthetic/update', { method: 'POST', body: JSON.stringify({ draftId: 'A', ...body }) }))
  const state: Record<string, unknown> = {
    selectedDraft: { ...a }, selectedProviderId: 'P', letterText: 'Initial', generatedAiLetterText: 'Original',
    loading: false, saveStatus: 'idle', lastSavedAt: null, imageDraftId: null, imageDraftUpdatedAt: null,
    patientName: 'Synthetic fixture', patientFirstName: 'Synthetic', patientLastName: 'Fixture', patientDob: null,
    referrerName: '', referrerAddress: '', clinicalNotes: '', reportType: a.report_type, typistQueries: '',
    pdfCcText: '', pdfLetterDate: '2026-01-01', pdfFontSize: 10, activeQueueItemId: null,
  }
  const refs = {
    patientSaveChainsRef: { current: new Map<string, Pending>() }, localDraftEditsRef: { current: new Map() },
    pendingPatientSavesRef: { current: {} as Record<string, () => void> },
    queueSelectionTokenRef: { current: 0 }, selectedProviderIdRef: { current: 'P' }, providerDataRequestRef: { current: 0 },
    draftListMountedRef: { current: true }, draftListRequestSequenceRef: { current: 0 },
    draftWorkspaceRef: { current: { listTab: 'drafts', selectedDraftId: 'A' } },
    lastAutosavedTextRef: { current: 'Initial' }, autosaveTimerRef: { current: null },
    patientDetailsAutosaveTimerRef: { current: null }, referrerAutosaveTimerRef: { current: null },
    autoImageDraftQueueIdRef: { current: null },
  }
  const globals: Record<string, unknown> = { ...refs, partitionApprovedForVerification, detailLoaderRef: { current: async (id: string) => ({ ...rows.get(id)! }) }, Response, Date: FrozenDate, readApprovalResponse, mergeDraftWorkflow,
    console: { error() {}, warn() {} }, alert: (message: string) => alerts.push(message), confirm: () => true,
    clearTimeout() {}, setTimeout: () => 1, cleanString: (v: unknown) => String(v ?? '').trim(),
    buildLetterTextForSave: (text: string) => text, stripPdfMarkers: (text: string) => text,
    splitPatientName: () => ({ firstName: 'Synthetic', lastName: 'Fixture' }), getDraftClinicalNotes: () => '',
    extractPdfCcText: () => '', extractPdfBodyFontSize: () => 10, extractPdfDateText: () => '', DEFAULT_PDF_BODY_FONT_SIZE: 10,
    fetch: async (url: string, options?: RequestInit) => {
      if (url.includes('get-drafts')) return Response.json({ success: true, drafts: [...rows.values()] })
      assert.equal(url, '/api/report-writing/update-draft')
      const body = JSON.parse(String(options?.body)); requests.push(body)
      if (failure === 'network') throw new Error('Synthetic network failure')
      if (typeof failure === 'number') return Response.json({ success: false, error: 'PRIVATE DATABASE DETAIL' }, { status: failure })
      const response = await direct(body)
      await responseHolds.get(String(body.editedText))?.promise
      return response
    },
  }
  const alerts: string[] = []
  for (const name of new Set((handlers + effects.join()).match(/\bset[A-Z]\w+/g))) {
    if (name === 'setTimeout') continue
    const key = name.slice(3, 4).toLowerCase() + name.slice(4)
    if (!(key in state)) state[key] = undefined
    globals[name] = (value: unknown) => { state[key] = typeof value === 'function' ? value(state[key]) : value }
  }
  const factory = runInNewContext(ts.transpileModule(`(snapshot => {const {${Object.keys(state).join(',')}} = snapshot; ${handlers}; return {${names.join(',')}, effects:[${effects.join(',')}]};})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, globals) as (state: Record<string, unknown>) => Api
  const api = () => factory({ ...state })
  const selected = () => state.selectedDraft as DraftDetail
  function autosave(text: string) {
    state.letterText = text; api().effects[0]()
    refs.pendingPatientSavesRef.current.letter?.()
  }
  return { api, state, refs, selected, rows, requests, audits, learning, queue, alerts, direct, autosave, started,
    block(text: string) { const hold = gate(); writeHolds.set(text, hold); return hold },
    holdResponse(text: string) { const hold = gate(); responseHolds.set(text, hold); return hold },
    fail(value: number | 'network') { failure = value },
    holdLearning() { learningHold = gate(); return learningHold },
  }
}

test('actual autosave effects: mixed R0/R1 queued edits dispatch R0/R1/R2 and install R3', async () => {
  const f = fixture(), first = f.block('First'), second = f.block('Second')
  f.autosave('First'); await waitFor(() => f.started.has('First'))
  f.autosave('Second'); first.release()
  await waitFor(() => f.selected().updated_at === revision(1) && f.started.has('Second'))
  f.autosave('Third'); second.release()
  await waitFor(() => f.selected().updated_at === revision(3))
  assert.deepEqual(f.requests.map(r => r.expectedUpdatedAt), [R0, revision(1), revision(2)])
  assert.equal(f.selected().edited_text, 'Third'); assert.equal(f.state.saveStatus, 'saved')
})

test('approval waits for queued autosaves, dispatches R2, installs R3 and releases UI before learning', async () => {
  const f = fixture(), first = f.block('First'), second = f.block('Second'), learning = f.holdLearning()
  f.autosave('First'); await waitFor(() => f.started.has('First'))
  f.autosave('Second'); first.release()
  await waitFor(() => f.selected().updated_at === revision(1) && f.started.has('Second'))
  f.state.letterText = 'Final'
  const approving = f.api().updateExistingDraft('approved')
  assert.equal(f.requests.length, 2); second.release(); await approving
  assert.deepEqual(f.requests.map(r => r.expectedUpdatedAt), [R0, revision(1), revision(2)])
  assert.equal(f.selected().updated_at, revision(3)); assert.equal(f.selected().status, 'approved')
  assert.equal(f.state.loading, false); assert.deepEqual(f.learning, ['started'])
  const approvedRevision = f.selected().updated_at
  f.api().beginPatientSelection(); f.state.selectedDraft = { ...f.rows.get('B')! }; f.state.selectedProviderId = 'Q'; f.refs.selectedProviderIdRef.current = 'Q'
  learning.release(); await waitFor(() => f.learning.includes('finished'))
  assert.equal(f.selected().id, 'B'); assert.equal(f.selected().updated_at, R0); assert.equal(approvedRevision, revision(3))
})

test('five chained saves from one revision advance monotonically with a frozen millisecond', async () => {
  const f = fixture()
  const responses = await Promise.all(Array.from({ length: 5 }, (_, n) => f.api().savePatientDraft('A', {
    body: JSON.stringify({ draftId: 'A', status: 'draft', expectedUpdatedAt: R0, editedText: `Edit ${n}` }),
  })))
  assert.deepEqual(responses.map(r => r.status), [200, 200, 200, 200, 200])
  assert.deepEqual(f.requests.map(r => r.expectedUpdatedAt), Array.from({ length: 5 }, (_, n) => revision(n)))
  assert.equal(f.rows.get('A')!.updated_at, revision(5))
})

for (const failure of [500, 'network'] as const) test(`failed predecessor ${failure} cannot advance or replay queued saves`, async () => {
  const f = fixture(); f.fail(failure)
  const request = { body: JSON.stringify({ draftId: 'A', status: 'draft', expectedUpdatedAt: R0, editedText: 'Local' }) }
  const first = f.api().savePatientDraft('A', request), second = f.api().savePatientDraft('A', request)
  await first.catch(() => undefined); const stopped = await second
  assert.equal(stopped.status, 503); assert.equal(f.requests.length, 1); assert.equal(f.rows.get('A')!.updated_at, R0)
  assert.deepEqual(f.audits, []); assert.deepEqual(f.queue, [])
})

for (const change of ['provider', 'letter'] as const) test(`${change} switch invalidates old queued advancement and protects new selection`, async () => {
  const f = fixture(), hold = f.block('First')
  f.autosave('First'); await waitFor(() => f.started.has('First'))
  f.autosave('Second'); f.api().beginPatientSelection()
  f.state.selectedDraft = { ...f.rows.get('B')! }; f.state.selectedProviderId = 'Q'
  if (change === 'provider') f.refs.selectedProviderIdRef.current = 'Q'
  hold.release(); await waitFor(() => f.requests.length === 2 && f.refs.patientSaveChainsRef.current.size === 0)
  assert.deepEqual(f.requests.map(r => r.expectedUpdatedAt), [R0, R0])
  assert.equal(f.rows.get('A')!.edited_text, 'First'); assert.equal(f.selected().id, 'B'); assert.equal(f.selected().updated_at, R0)
})

test('incompatible authoritative refresh invalidates a waiting chain before it can borrow an acknowledgement', async () => {
  const f = fixture(), hold = f.holdResponse('First')
  f.autosave('First'); await waitFor(() => f.rows.get('A')!.updated_at === revision(1))
  f.autosave('Second')
  await f.direct({ status: 'draft', expectedUpdatedAt: revision(1), editedText: 'External refresh text' })
  await f.api().loadDrafts('P')
  assert.equal(f.refs.patientSaveChainsRef.current.get('A')!.observedState?.revision, revision(2))
  hold.release(); await waitFor(() => f.state.saveStatus === 'conflict')
  assert.equal(f.requests.length, 1); assert.equal(f.rows.get('A')!.edited_text, 'External refresh text')
})

test('actual full detail replacement invalidates the pending chain', async () => {
  const f = fixture(), hold = f.block('First')
  f.autosave('First'); await waitFor(() => f.started.has('First'))
  f.autosave('Second'); f.api().applyDraftDetail({ ...f.rows.get('A')! })
  assert.equal(f.refs.patientSaveChainsRef.current.get('A')!.invalidated, true)
  hold.release(); await waitFor(() => f.state.saveStatus === 'conflict')
  assert.equal(f.requests.length, 1)
})

for (const operation of ['autosave', 'approval'] as const) test(`external tab ${operation} conflict stays 409 without retry or side effects`, async () => {
  const f = fixture()
  await f.direct({ status: 'approved', expectedUpdatedAt: R0, editedText: 'Other tab approved' })
  const before = JSON.stringify([f.audits, f.queue, f.learning, f.rows.get('A')])
  if (operation === 'autosave') {
    f.autosave('Old local edit'); await waitFor(() => f.state.saveStatus === 'conflict')
    assert.match(f.api().getSaveStatusLabel(), /changed elsewhere.*Reload the letter/)
    f.autosave('Another local edit'); assert.equal(f.requests.length, 1)
  } else {
    f.state.letterText = 'Old local approval'; await f.api().updateExistingDraft('approved')
    assert.match(f.alerts[0], /Reload the letter/); assert.equal(f.requests.length, 1)
    assert.equal(f.state.saveStatus, 'conflict'); f.autosave('After failed approval'); assert.equal(f.requests.length, 1)
  }
  assert.equal(JSON.stringify([f.audits, f.queue, f.learning, f.rows.get('A')]), before)
})

for (const failure of [500, 'network'] as const) test(`ordinary autosave ${failure} remains distinct from a revision conflict`, async () => {
  const f = fixture(); f.fail(failure); f.autosave('Local')
  await waitFor(() => f.state.saveStatus === 'error')
  assert.equal(f.api().getSaveStatusLabel(), 'Autosave failed')
  assert.doesNotMatch(f.api().getSaveStatusLabel(), /PRIVATE|2026/)
})

test('reselection clears the conflict state and installs the authoritative revision for the next autosave', async () => {
  const f = fixture()
  await f.direct({ status: 'draft', expectedUpdatedAt: R0, editedText: 'External' })
  f.autosave('Local'); await waitFor(() => f.state.saveStatus === 'conflict')
  f.api().clearForm(); f.api().applyDraftDetail({ ...f.rows.get('A')! })
  assert.equal(f.state.saveStatus, 'saved'); assert.equal(f.selected().updated_at, revision(1))
  f.autosave('Reconciled'); await waitFor(() => f.selected().updated_at === revision(2))
  assert.equal(f.requests[1].expectedUpdatedAt, revision(1))
})

test('approved letter autosaves retain original attribution through consecutive successful revisions', async () => {
  const f = fixture('approved')
  f.autosave('First edit'); await waitFor(() => f.selected().updated_at === revision(1))
  f.autosave('Second edit'); await waitFor(() => f.selected().updated_at === revision(2))
  assert.equal(f.selected().approved_by_name, 'Original provider'); assert.equal(f.rows.get('A')!.provider_approved_at, R0)
  assert.deepEqual(f.audits, ['Updated report', 'Updated report'])
})


test('background refresh of an own committed but not yet acknowledged save does not create a false conflict', async () => {
  const f = fixture(), hold = f.holdResponse('First')
  f.autosave('First'); await waitFor(() => f.rows.get('A')!.updated_at === revision(1))
  f.autosave('Second'); await f.api().loadDrafts('P')
  hold.release(); await waitFor(() => f.selected().updated_at === revision(2))
  assert.deepEqual(f.requests.map(r => r.expectedUpdatedAt), [R0, revision(1)])
  assert.equal(f.state.saveStatus, 'saved')
})

test('a genuine 409 predecessor stops queued writes without a second server request', async () => {
  const f = fixture()
  await f.direct({ status: 'draft', expectedUpdatedAt: R0, editedText: 'External' })
  const request = { body: JSON.stringify({ draftId: 'A', status: 'draft', expectedUpdatedAt: R0, editedText: 'Local' }) }
  const responses = await Promise.all([f.api().savePatientDraft('A', request), f.api().savePatientDraft('A', request)])
  assert.deepEqual(responses.map(r => r.status), [409, 409]); assert.equal(f.requests.length, 1)
  assert.equal(f.rows.get('A')!.edited_text, 'External')
})

test('approval drains an additional same-context save queued while it is already waiting', async () => {
  const f = fixture(), first = f.block('First'), second = f.block('Second'), third = f.block('Third')
  f.autosave('First'); await waitFor(() => f.started.has('First'))
  f.autosave('Second'); first.release()
  await waitFor(() => f.selected().updated_at === revision(1) && f.started.has('Second'))
  f.state.letterText = 'Final'
  const approving = f.api().updateExistingDraft('approved')
  const saving = f.api().savePatientDraft('A', { body: JSON.stringify({
    draftId: 'A', status: 'draft', expectedUpdatedAt: revision(1), editedText: 'Third',
  }) }, { providerId: 'P', selectionToken: 0, status: 'draft' })
  second.release(); await waitFor(() => f.started.has('Third'))
  assert.equal(f.requests.length, 3); third.release(); await saving; await approving
  assert.deepEqual(f.requests.map(r => r.expectedUpdatedAt), [R0, revision(1), revision(2), revision(3)])
  assert.equal(f.selected().status, 'approved'); assert.equal(f.selected().updated_at, revision(4))
})

test('a newer letter saves independently and never installs the previous letter acknowledgement', async () => {
  const f = fixture(), hold = f.block('A pending')
  f.autosave('A pending'); await waitFor(() => f.started.has('A pending'))
  f.api().beginPatientSelection()
  const b = { ...f.rows.get('B')!, updated_at: revision(9) }; f.rows.set('B', b)
  f.state.selectedProviderId = 'Q'; f.refs.selectedProviderIdRef.current = 'Q'; f.api().applyDraftDetail(b)
  f.autosave('B saved'); await waitFor(() => f.selected().updated_at === revision(10))
  hold.release(); await waitFor(() => f.refs.patientSaveChainsRef.current.size === 0)
  assert.equal(f.selected().id, 'B'); assert.equal(f.selected().updated_at, revision(10))
  assert.deepEqual(f.requests.map(r => [r.draftId, r.expectedUpdatedAt]), [['A', R0], ['B', revision(9)]])
})

test('manual existing-draft save is serialized behind an outstanding autosave', async () => {
  const f = fixture(), hold = f.block('Autosave')
  f.autosave('Autosave'); await waitFor(() => f.started.has('Autosave'))
  f.state.letterText = 'Manual save'
  const manual = f.api().updateExistingDraft('draft')
  assert.equal(f.requests.length, 1); hold.release(); await manual
  assert.deepEqual(f.requests.map(r => r.expectedUpdatedAt), [R0, revision(1)])
  assert.equal(f.selected().updated_at, revision(2)); assert.equal(f.selected().edited_text, 'Manual save')
})


test('actual reselection after 409 loads authoritative text instead of replaying rejected edits on a new token', async () => {
  const f = fixture()
  await f.direct({ status: 'draft', expectedUpdatedAt: R0, editedText: 'Authoritative other-tab text' })

test('Resolve completion in Approved removes the card, invalidates pending saves, and preserves the tab', async () => {
  const f = fixture('approved'), hold = f.holdResponse('Own edit')
  f.refs.draftWorkspaceRef.current.listTab = 'completed'
  f.autosave('Own edit'); await waitFor(() => f.rows.get('A')!.updated_at === revision(1))
  const queued = f.api().savePatientDraft('A', { body: JSON.stringify({ draftId: 'A', status: 'approved', expectedUpdatedAt: R0, editedText: 'Queued stale edit' }) })
  const row = f.rows.get('A')!
  const completed = resolveWorkflow(row, { uploads: [], icons: [], mediref: [], livePraktikaActors: new Set(), liveMediref: false,
    resolution: { draftId: 'A', letterFingerprint: 'synthetic-letter', executionSafe: true, events: [{ id: 'closure', action: 'workflow_resolution_completed',
      details: { contract: 'workflow-resolution-v1', version: 1, draftId: 'A', letterFingerprint: 'synthetic-letter', actorUserId: 'authenticated-operator', completedAt: R0 } }] } })
  assert.equal(completed.status, 'completed')
  f.rows.set('A', { ...row, updated_at: revision(2), workflow_resolved: completed })
  await f.api().loadDrafts('P')
  assert.equal(f.state.selectedDraft, null); assert.equal(f.refs.draftWorkspaceRef.current.listTab, 'completed')
  hold.release(); assert.equal((await queued).status, 409)
  // The existing cross-selection contract allows the queued request to finish
  // with its captured revision. Server fencing rejects it without side effects.
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].expectedUpdatedAt, R0)
  assert.equal(f.rows.get('A')!.updated_at, revision(2))
  assert.equal(f.rows.get('A')!.approved_by_name, 'Original provider')
})

test('Resolve verification refresh still fences a stale approval behind its pending saves', async () => {
  const f = fixture(), hold = f.holdResponse('Own edit')
  f.autosave('Own edit'); await waitFor(() => f.rows.get('A')!.updated_at === revision(1))
  f.state.letterText = 'Approval waiting'
  const approving = f.api().updateExistingDraft('approved')
  // The committed Resolve snapshot changes the revision without changing text.
  f.rows.set('A', { ...f.rows.get('A')!, updated_at: revision(2) })
  await f.api().loadDrafts('P'); hold.release(); await approving
  assert.equal(f.requests.length, 1); assert.equal(f.rows.get('A')!.status, 'draft')
  assert.equal(f.state.saveStatus, 'conflict'); assert.match(f.alerts[0], /Reload the letter/)
})
  f.autosave('Rejected local text'); await waitFor(() => f.state.saveStatus === 'conflict')
  await f.api().selectDraft({ id: 'A' })
  assert.equal(f.state.letterText, 'Authoritative other-tab text'); assert.equal(f.selected().updated_at, revision(1))
  f.api().effects[0](); assert.equal(f.refs.pendingPatientSavesRef.current.letter, undefined)
  assert.equal(f.requests.length, 1); assert.equal(f.rows.get('A')!.edited_text, 'Authoritative other-tab text')
})
