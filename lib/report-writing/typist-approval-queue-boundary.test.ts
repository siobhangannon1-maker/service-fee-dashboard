import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { approvalResponse, isTypistApproval, readApprovalResponse } from './typist-approval-stream'
import { approvedDraftFixture } from './typist-approval-fixtures.test-helper'
const initial = { requested: false, exampleSaved: false, exampleId: null, duplicate: false, analysisStatus: 'not_requested', behavioursCreated: 0, behavioursReinforced: 0, error: null }
const gate = () => { let release!: () => void; return { promise: new Promise<void>(r => release = r), release: () => release() } }
const actor = { actorRole: 'typist', actorInitials: 'S', actorFullName: 'Synthetic' }

for (const [route, source, completesQueue] of [
  ['save-draft', 'typist_direct_approval', true],
  ['update-draft', 'typist_image_workspace_final_save', true],
  ['update-draft', 'typist_existing_draft_approval', false],
] as const) {
  for (const queueFails of completesQueue ? [false, true] : [false]) test(`${source}: queue handling settles before audit/ack/learning, queue failure=${queueFails}`, async () => {
    const events: string[] = []; const queueGate = gate(), learningGate = gate(), queueEntered = gate()
    let row = { ...approvedDraftFixture(), status: 'draft' }
    const queue = { id: 'queue', provider_id: 'provider', patient_first_name: 'Synthetic', patient_last_name: 'Fixture', report_draft_id: source === 'typist_image_workspace_final_save' ? null : row.id, status: 'started' }
    const db = { from(table: string) {
      let payload: Record<string, unknown> | null = null
      const filters: [string, unknown][] = []
      const query = {
        select() { return query }, eq(key: string, value: unknown) { filters.push([key, value]); return query },
        update(p: Record<string, unknown>) { payload = p; return query },
        insert(p: Record<string, unknown>) { payload = p; return query },
        async single() { return execute() }, async maybeSingle() { return execute() },
        then(resolve: (v: unknown) => void, reject: (v: unknown) => void) { return execute().then(resolve, reject) },
      }
      async function execute() {
        if (table === 'report_drafts') {
          if (payload) { row = { ...row, ...payload }; events.push('draft persisted') }
          return { data: { ...row }, error: null }
        }
        assert.equal(table, 'report_letter_queue')
        if (payload?.status === 'completed') {
          assert.deepEqual(filters, [['id', 'queue']]);
          events.push('queue completion started'); queueEntered.release(); await queueGate.promise
          events.push('queue completion settled')
          if (queueFails) return { data: null, error: { message: 'Synthetic queue failure' } }
          Object.assign(queue, payload)
        }
        return { data: { ...queue }, error: null }
      }
      return query
    } }
    const routeSource = readFileSync(`app/api/report-writing/${route}/route.ts`, 'utf8')
    const code = ts.transpileModule(routeSource.slice(routeSource.indexOf('function clean(')).replace('export async function POST', 'async function POST') + '\nPOST', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const post = runInNewContext(code, {
      supabase: db, sensitiveApiAccess: async () => null, getAuditActor: async () => actor,
      createReportAuditEvent: async (event: { action: string }) => { events.push(`audit ${event.action}`) },
      approvalResponse, isTypistApproval, noLearningRequested: () => initial,
      processApprovedEdit: async () => { events.push('learning started'); await learningGate.promise; return initial },
      NextResponse: { json: Response.json }, Date, console: { warn() {}, error() {} },
    }) as (req: Request) => Promise<Response>
    let responseReady = false
    const request = new Request('http://fixture/approval', { method: 'POST', body: JSON.stringify({
      draftId: row.id, providerId: row.provider_id, queueId: queue.id, patientName: row.patient_name,
      status: 'approved', learningSource: source, learnFromEdits: true,
      generatedReport: 'Original', originalAiText: 'Original', editedText: 'Final', finalApprovedText: 'Final',
    }) })
    const pending = post(request).then(r => { responseReady = true; return r })
    if (completesQueue) {
      await queueEntered.promise
      assert.equal(responseReady, false); assert.equal(row.status, 'approved')
      assert.ok(!events.some(e => e.startsWith('audit'))); assert.ok(!events.includes('learning started'))
      queueGate.release()
    }
    const response = await pending
    const acknowledged = await readApprovalResponse(response, { providerId: row.provider_id, draftId: row.id })
    events.push('browser acknowledgement')
    assert.equal(acknowledged.draft?.status, 'approved')
    assert.equal(queue.status, completesQueue && !queueFails ? 'completed' : 'started')
    if (completesQueue && !queueFails) assert.equal(queue.report_draft_id, row.id)
    assert.equal(events.filter(e => e === 'queue completion started').length, completesQueue ? 1 : 0)
    const approvalAudit = events.findIndex(e => e === 'audit Approved report' || e === 'audit Created and approved report')
    assert.ok(approvalAudit > events.indexOf('draft persisted'))
    if (completesQueue) assert.ok(approvalAudit > events.indexOf('queue completion settled'))
    assert.ok(events.indexOf('learning started') > approvalAudit)
    // Response parsing has already returned, while this same request is learning.
    learningGate.release()
  })
}

for (const image of [true, false]) test(`actual ${image ? 'image-workspace' : 'direct'} client sends queue ID to server and makes only reads/UI changes after acknowledgement`, async () => {
  const source = readFileSync('app/(protected)/report-writing/typist/TypistPage.tsx', 'utf8')
  const start = source.indexOf('  async function saveNewDraft('), end = source.indexOf('\n  async function ', start + 1)
  const code = ts.transpileModule(source.slice(start, end) + '\nsaveNewDraft', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const learning = gate(); let learningFinished = false; let loading = false
  const calls: string[] = []; const draft = approvedDraftFixture(); let selected = { ...draft, status: 'draft' }
  const response = await approvalResponse({ typist: true, draft, initialLearning: { ...initial, analysisStatus: 'not_requested' },
    audit: async () => {}, synchronous: async () => { await learning.promise; learningFinished = true; return { ...initial, analysisStatus: 'not_requested' } } })
  const client = runInNewContext(code, {
    loading, selectedDraft: selected, selectedProviderId: draft.provider_id, imageDraftId: image ? draft.id : null,
    patientFirstName: 'Synthetic', patientLastName: 'Fixture', patientName: 'Synthetic Fixture', patientDob: null, patientGender: 'neutral',
    letterText: draft.edited_text, generatedAiLetterText: draft.ai_generated_text,
    referrerName: '', referrerAddress: '', reportType: draft.report_type, clinicalNotes: '', typistQueries: '', selectedPraktikaPatientId: null,
    activeQueueItemId: 'queue', queueStatusTab: 'active',
    queueSelectionTokenRef: { current: 0 }, autosaveTimerRef: { current: null }, pendingPatientSavesRef: { current: {} },
    patientSaveChainsRef: { current: new Map() }, localDraftEditsRef: { current: new Map() }, draftListRequestSequenceRef: { current: 0 }, lastAutosavedTextRef: { current: '' },
    getLetterTextForSave: () => draft.edited_text, confirm: () => true, alert() {}, Date, Error,
    setLoading: (v: boolean) => { loading = v }, readApprovalResponse,
    setSelectedDraft: (update: (current: typeof selected) => typeof selected) => { selected = update(selected) },
    mergeDraftWorkflow: (saved: typeof selected) => saved,
    setImageDraftId() {}, setListTab() {}, setSaveStatus() {}, setLastSavedAt() {}, setActiveQueueItemId() {},
    loadDrafts: async () => { calls.push('read drafts') }, loadQueue: async () => { calls.push('read queue') },
    fetch: async (url: string, init: RequestInit) => {
      calls.push(url); assert.equal(url, image ? '/api/report-writing/update-draft' : '/api/report-writing/save-draft')
      const body = JSON.parse(String(init.body)); assert.equal(body.queueId, 'queue'); assert.equal(body.learningSource, image ? 'typist_image_workspace_final_save' : 'typist_direct_approval')
      return response
    },
  }) as (status: string) => Promise<void>
  await client('approved')
  assert.equal(loading, false); assert.equal(selected.status, 'approved'); assert.equal(learningFinished, false)
  assert.deepEqual(calls, [image ? '/api/report-writing/update-draft' : '/api/report-writing/save-draft', 'read queue', 'read drafts'])
  learning.release()
})
