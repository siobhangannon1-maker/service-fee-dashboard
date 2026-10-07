import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function handler(path: string, name: string) {
  const source = readFileSync(path, 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.FunctionDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, name)
  return ts.transpileModule(found.getText(ast) + '\n' + name, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
}

const provider = 'app/(protected)/report-writing/provider/ProviderReportClient.tsx'
const typist = 'app/(protected)/report-writing/typist/TypistPage.tsx'
const scribe = 'app/clinical-scribe/ProviderClinicalScribeClient.tsx'
const revision = '2026-01-01T00:00:00.123456+00:00'
const draft = { id: 'A', updated_at: revision, status: 'draft', edited_text: 'Final', ai_generated_text: 'Original' }

for (const name of ['unapproveLetter', 'updateExistingDraftFromEditor', 'approveCurrentDraft', 'approveDraft', 'returnToTypist']) {
  test(`provider ${name} sends loaded revision and surfaces conflict without replay`, async () => {
    let calls = 0, warnings = 0
    const fn = runInNewContext(handler(provider, name), {
      selectedDraft: draft, selectedApprovalDraft: draft, providerId: 'P',
      detailSelectionRef: { current: 0 }, detailProviderRef: { current: 'P' },
      validatePatientName: () => true, getReportText: () => 'Final', inferDraftSourceType: () => 'clinical_notes',
      dictatedLetter: 'Final', generatedReport: '', originalGeneratedReport: 'Original',
      patientName: 'Synthetic', patientDob: null, referrerName: '', referrerAddress: '',
      reportType: 'consultation_report', clinicalNotes: '', typistInstructions: '',
      confirm: () => true, alert: () => warnings++, setLoading() {}, setSavedMessage() {},
      readJsonSafely: (response: Response) => response.json(),
      fetch: async (url: string, options: RequestInit) => {
        assert.equal(url, '/api/report-writing/update-draft'); calls++
        assert.equal(JSON.parse(String(options.body)).expectedUpdatedAt, revision)
        return Response.json({ success: false, error: 'Reload the letter.' }, { status: 409 })
      },
    }) as (...args: unknown[]) => Promise<unknown>
    await fn(name === 'unapproveLetter' ? draft : undefined)
    assert.equal(calls, 1); assert.equal(warnings, 1)
  })
}

test('Clinical Scribe keeps each successful revision for the next save and stops on conflict', async () => {
  const box = {
    letterDraftId: 'A', letterDraftUpdatedAt: revision, letterText: 'Final', originalLetterText: 'Original',
    patientFirstName: 'Synthetic', patientLastName: 'Fixture', patientName: 'Synthetic Fixture', patientDob: null,
    referrerName: '', referrerAddress: '', reportType: 'consultation_report', editedNote: '', typistInstructions: '',
    confirm: () => true, setWorking() {}, setLetterSaveStatus() {}, setMessage() {}, showToast() {},
    setLetterDraftUpdatedAt: (value: string) => { box.letterDraftUpdatedAt = value },
    readJsonSafely: (response: Response) => response.json(), alert: () => { warnings++ }, console,
    fetch: async (_url: string, options: RequestInit) => {
      tokens.push(JSON.parse(String(options.body)).expectedUpdatedAt)
      return tokens.length === 1
        ? Response.json({ success: true, draft: { ...draft, updated_at: nextRevision } })
        : Response.json({ success: false, error: 'Reload the letter.' }, { status: 409 })
    },
  }
  const tokens: string[] = [], nextRevision = '2026-01-01T00:00:00.124Z'; let warnings = 0
  const save = runInNewContext(handler(scribe, 'saveLetterDraft'), box) as (status?: string) => Promise<void>
  await save(); await save('approved')
  assert.deepEqual(tokens, [revision, nextRevision]); assert.equal(warnings, 1)
  assert.equal(box.letterDraftUpdatedAt, nextRevision)
})

test('Typist serialized saves advance only through their own successful preceding write', async () => {
  const requests: Record<string, unknown>[] = []
  const revisions = ['2026-01-01T00:00:00.124Z', '2026-01-01T00:00:00.125Z', '2026-01-01T00:00:00.126Z']
  const save = runInNewContext(handler(typist, 'savePatientDraft'), {
    patientSaveChainsRef: { current: new Map() }, localDraftEditsRef: { current: new Map() },
    selectedProviderIdRef: { current: "P" }, queueSelectionTokenRef: { current: 0 }, Response,
    fetch: async (_url: string, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)))
      return Response.json({ success: true, draft: { ...draft, updated_at: revisions[requests.length - 1] } })
    },
  }) as (id: string, options: RequestInit) => Promise<Response>
  const request = (text: string) => ({ body: JSON.stringify({ draftId: 'A', expectedUpdatedAt: revision, editedText: text }) })
  await Promise.all([save('A', request('First')), save('A', request('Second')), save('A', request('Third'))])
  assert.deepEqual(requests.map(r => r.expectedUpdatedAt), [revision, revisions[0], revisions[1]])
  assert.deepEqual(requests.map(r => r.editedText), ['First', 'Second', 'Third'])
})

test('Typist does not advance the token or replay a queued save after conflict', async () => {
  const tokens: string[] = []
  const save = runInNewContext(handler(typist, 'savePatientDraft'), {
    patientSaveChainsRef: { current: new Map() }, localDraftEditsRef: { current: new Map() },
    selectedProviderIdRef: { current: "P" }, queueSelectionTokenRef: { current: 0 }, Response,
    fetch: async (_url: string, options: RequestInit) => {
      tokens.push(JSON.parse(String(options.body)).expectedUpdatedAt)
      return Response.json({ success: false, reloadRequired: true }, { status: 409 })
    },
  }) as (id: string, options: RequestInit) => Promise<Response>
  const request = { body: JSON.stringify({ draftId: 'A', expectedUpdatedAt: revision, editedText: 'Local' }) }
  const responses = await Promise.all([save('A', request), save('A', request)])
  assert.deepEqual(tokens, [revision]); assert.deepEqual(responses.map(r => r.status), [409, 409])
})

for (const priorSucceeded of [true, false]) test(`explicit Typist approval uses only its own acknowledged save revision: prior success=${priorSucceeded}`, async () => {
  const nextRevision = '2026-01-01T00:00:00.124Z'
  const pending = Object.assign(Promise.resolve(Response.json(priorSucceeded
    ? { success: true, draft: { ...draft, updated_at: nextRevision } }
    : { success: false, reloadRequired: true }, { status: priorSucceeded ? 200 : 409 })), { providerId: "P", selectionToken: 0, revisions: new Set([revision]), states: new Map(), savedRevision: priorSucceeded ? nextRevision : undefined, failed: !priorSucceeded, conflict: !priorSucceeded })
  let calls = 0, warnings = 0, selections = 0
  const approve = runInNewContext(handler(typist, 'updateExistingDraft'), {
    loading: false, saveStatus: "idle", selectedDraft: draft, imageDraftId: null, selectedProviderId: 'P',
    queueSelectionTokenRef: { current: 0 }, autosaveTimerRef: { current: null }, patientDetailsAutosaveTimerRef: { current: null }, referrerAutosaveTimerRef: { current: null }, pendingPatientSavesRef: { current: {} },
    patientSaveChainsRef: { current: new Map([['A', pending]]) }, localDraftEditsRef: { current: new Map() },
    getLetterTextForSave: () => 'Final', generatedAiLetterText: 'Original',
    referrerName: '', referrerAddress: '', patientName: 'Synthetic', patientDob: null,
    reportType: 'consultation_report', clinicalNotes: '', typistQueries: '',
    setLoading() {}, setSaveStatus() {}, setSelectedDraft: () => selections++, alert: () => warnings++,
    readApprovalResponse: (response: Response) => response.json(),
    fetch: async (url: string, options: RequestInit) => {
      assert.equal(url, '/api/report-writing/update-draft'); calls++
      assert.equal(JSON.parse(String(options.body)).expectedUpdatedAt, priorSucceeded ? nextRevision : revision)
      return Response.json({ success: false, error: 'Reload the letter.' }, { status: 409 })
    },
  }) as (status: string) => Promise<void>
  await approve('approved')
  assert.equal(calls, priorSucceeded ? 1 : 0); assert.equal(warnings, 1); assert.equal(selections, 0)
})

test('queued Typist save survives the caller consuming its preceding response body', async () => {
  let release!: () => void
  const gate = new Promise<void>(r => release = r), tokens: string[] = []
  const nextRevision = '2026-01-01T00:00:00.124Z'
  const save = runInNewContext(handler(typist, 'savePatientDraft'), {
    patientSaveChainsRef: { current: new Map() }, localDraftEditsRef: { current: new Map() },
    selectedProviderIdRef: { current: "P" }, queueSelectionTokenRef: { current: 0 }, Response,
    fetch: async (_url: string, options: RequestInit) => {
      tokens.push(JSON.parse(String(options.body)).expectedUpdatedAt)
      if (tokens.length === 1) await gate
      return Response.json({ success: true, draft: { ...draft, updated_at: nextRevision } })
    },
  }) as (id: string, options: RequestInit) => Promise<Response>
  const request = { body: JSON.stringify({ draftId: 'A', expectedUpdatedAt: revision, editedText: 'Local' }) }
  const first = save('A', request)
  const consumed = first.then(response => response.json())
  const second = save('A', request)
  release(); await consumed
  assert.equal((await second).status, 200)
  assert.deepEqual(tokens, [revision, nextRevision])
})
