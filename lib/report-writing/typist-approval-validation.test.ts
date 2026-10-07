import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { readApprovalResponse } from './typist-approval-stream'
import { approvedDraftFixture } from './typist-approval-fixtures.test-helper'

const draft = approvedDraftFixture()
const valid = { type: 'approval_complete', success: true, draft }
const expected = { providerId: draft.provider_id, draftId: draft.id }
const headers = { 'content-type': 'application/x-ndjson' }
const response = (event: unknown) => new Response(JSON.stringify(event) + '\n', { headers })
const malformed: [string, unknown][] = [
  ['string true', { ...valid, success: 'true' }],
  ['string false', { ...valid, success: 'false' }],
  ['numeric truthy', { ...valid, success: 1 }],
  ['object truthy', { ...valid, success: {} }],
  ['missing success', { type: valid.type, draft }],
  ['missing draft', { type: valid.type, success: true }],
  ['malformed draft', { ...valid, draft: { id: draft.id, status: 'approved' } }],
  ['array draft', { ...valid, draft: [] }],
  ['invalid text', { ...valid, draft: { ...draft, edited_text: {} } }],
  ['invalid workflow field', { ...valid, draft: { ...draft, workflow_status: {} } }],
  ['invalid upload flag', { ...valid, draft: { ...draft, uploaded_to_praktika: 'true' } }],
  ['invalid timestamp', { ...valid, draft: { ...draft, updated_at: 'invalid' } }],
  ['non-approved draft', { ...valid, draft: { ...draft, status: 'draft' } }],
  ['mismatched draft', { ...valid, draft: { ...draft, id: 'other' } }],
  ['mismatched provider', { ...valid, draft: { ...draft, provider_id: 'other' } }],
  ['wrong event type', { ...valid, type: 'learning_complete' }],
  ['failure event', { type: 'learning_failed' }],
]

test('boolean true and validated approved draft accepted with captured identity', async () => {
  const result = await readApprovalResponse(response(valid), expected)
  assert.equal(result.success, true); assert.equal(result.draft?.id, draft.id)
  assert.equal(result.draft?.status, 'approved'); assert.equal(result.draft?.has_final_text, true)
})
for (const [name, event] of malformed) {
  test(`parser rejects ${name}`, async () => {
    await assert.rejects(readApprovalResponse(response(event), expected), /approval.*acknowledged|approval acknowledgement/i)
  })
  test(`actual client rejects ${name} without approving or changing draft/workflow state`, async () => {
    const source = readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx', 'utf8')
    const start = source.indexOf('  async function updateExistingDraft(')
    const end = source.indexOf('\n  async function ', start + 1)
    const code = ts.transpileModule(source.slice(start, end) + '\nupdateExistingDraft', {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
    let loading = false; const alerts: string[] = []
    const initial = { ...draft, status: 'draft', workflow_status: 'not_started' }
    const sequence = { current: 3 }
    const client = runInNewContext(code, {
      loading, saveStatus: "idle", selectedDraft: initial, selectedProviderId: draft.provider_id,
      imageDraftId: null, autosaveTimerRef: { current: null }, patientDetailsAutosaveTimerRef: { current: null }, referrerAutosaveTimerRef: { current: null }, pendingPatientSavesRef: { current: {} },
      patientSaveChainsRef: { current: new Map() }, localDraftEditsRef: { current: new Map() },
      queueSelectionTokenRef: { current: 0 }, draftListRequestSequenceRef: sequence,
      getLetterTextForSave: () => draft.edited_text, generatedAiLetterText: draft.ai_generated_text,
      referrerName: '', referrerAddress: '', patientName: 'Synthetic', patientDob: null,
      reportType: draft.report_type, clinicalNotes: '', typistQueries: '',
      fetch: async () => response(event), readApprovalResponse,
      setLoading: (v: boolean) => { loading = v },
      setSelectedDraft: () => assert.fail('Malformed acknowledgement must not install an approval'),
      setSaveStatus: () => assert.fail('Malformed acknowledgement must not mark saved'),
      loadDrafts: () => assert.fail('Malformed acknowledgement must not reconcile as success'),
      alert: (message: string) => alerts.push(message), Date, Error,
    }) as (status: string) => Promise<void>
    await client('approved')
    assert.equal(loading, false); assert.equal(initial.status, 'draft')
    assert.equal(initial.workflow_status, 'not_started'); assert.equal(sequence.current, 3)
    assert.equal(alerts.length, 1); assert.match(alerts[0], /acknowledg/i)
  })
}

test('fragmented UTF-8, partial lines, and multiple events per chunk remain supported', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...valid, draft: { ...draft, edited_text: 'Synthetic café' } }) + '\n' + JSON.stringify({ type: 'learning_complete' }) + '\n')
  const stream = new ReadableStream<Uint8Array>({ start(c) {
    for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7))
    c.close()
  } })
  assert.equal((await readApprovalResponse(new Response(stream, { headers }), expected)).draft?.edited_text, 'Synthetic café')
  const combined = new Response(JSON.stringify(valid) + '\n' + JSON.stringify({ type: 'learning_failed' }) + '\n', { headers })
  assert.equal((await readApprovalResponse(combined, expected)).success, true)
})
test('successful JSON cannot bypass streaming validation for an approval operation', async () => {
  await assert.rejects(readApprovalResponse(Response.json({ success: true, draft }), expected), /not acknowledged/)
  const failure = await readApprovalResponse(Response.json({ success: false, error: 'Synthetic failure' }, { status: 500 }), expected)
  assert.equal(failure.success, false)
})

test('failed HTTP streaming response cannot approve even with a valid-looking event', async () => {
  await assert.rejects(readApprovalResponse(new Response(JSON.stringify(valid) + '\n', { headers, status: 500 }), expected), /not acknowledged/)
})
