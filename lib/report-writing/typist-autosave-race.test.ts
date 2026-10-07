import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { approvalResponse, isTypistApproval } from './typist-approval-stream'
const noLearningRequested = () => ({ requested: false, exampleSaved: false, exampleId: null, duplicate: false, analysisStatus: 'ignored', behavioursCreated: 0, behavioursReinforced: 0, error: null })
const route = readFileSync('app/api/report-writing/update-draft/route.ts','utf8')
const code = ts.transpileModule(route.slice(route.indexOf('function clean(')).replace('export async function POST','async function POST') + '\nPOST', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
for (const lateWrite of [false,true]) test(`actual route fences stale autosave; approval wins lateWrite=${lateWrite}`, async () => {
  let row = { id: 'A', updated_at: '2026-01-01T00:00:00.000Z', status: 'draft', edited_text: 'Old', provider_id: 'P', ai_generated_text: 'Original' }
  let audit = false; let release!: () => void, started!: () => void
  const gate = new Promise<void>(r => release = r), writing = new Promise<void>(r => started = r)
  const db = { from(table: string) {
    let payload: Record<string, unknown> | null = null; const filters: Record<string, unknown> = {}
    const query = {
      select() { return query }, eq(k: string,v: unknown) { filters[k] = v; return query },
      update(p: Record<string, unknown>) { payload = p; return query },
      async single() { return { data: { ...row }, error: null } },
      async maybeSingle() {
        if (payload?.edited_text === 'Stale') { started(); await gate }
        if (Object.entries(filters).some(([k,v]) => (row as Record<string,unknown>)[k] !== v)) return { data: null, error: null }
        row = { ...row, ...payload }; return { data: { ...row }, error: null }
      },
      then(resolve: (v: unknown) => void) { assert.equal(table,'report_letter_queue'); resolve({ error: null }) },
    }; return query
  } }
  const post = runInNewContext(code, { supabase: db, sensitiveApiAccess: async () => null,
    getAuditActor: async () => ({ actorInitials: 'S', actorFullName: 'Synthetic', actorRole: 'typist' }),
    createReportAuditEvent: async (event: { action: string }) => { if (event.action === 'Approved report') { assert.equal(row.status,'approved'); audit = true } },
    approvalResponse, isTypistApproval, noLearningRequested, processApprovedEdit: async () => noLearningRequested(),
    NextResponse: { json: Response.json }, console: { error() {}, warn() {} },
    Date: class extends Date { constructor(value?: string | number) { super(value ?? '2026-01-01T00:00:00.000Z') } static now() { return Date.parse('2026-01-01T00:00:00.000Z') } } }) as (request: Request) => Promise<Response>
  const request = (body: unknown) => new Request('http://fixture/update', { method: 'POST', body: JSON.stringify(body) })
  if (!lateWrite) {
    const normal = await post(request({ draftId: 'A', editedText: 'Current', status: 'draft',
      learningSource: 'typist_autosave', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' }))
    assert.equal(normal.status, 200); assert.equal((await normal.json()).success, true)
    assert.equal(row.edited_text, 'Current'); assert.equal(row.status, 'draft')
  }
  let old: Promise<Response> | undefined
  if (lateWrite) { old = post(request({ draftId: 'A', editedText: 'Stale', status: 'draft', learningSource: 'typist_autosave', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })); await writing }
  const approved = await post(request({ draftId: 'A', expectedUpdatedAt: row.updated_at, editedText: 'Final', status: 'approved', learningSource: 'typist_existing_draft_approval' }))
  assert.equal(audit,true)
  const reader = approved.body!.getReader(); const ack = JSON.parse(new TextDecoder().decode((await reader.read()).value))
  assert.ok(Date.parse(row.updated_at) > Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(ack.type,'approval_complete'); assert.equal(ack.draft.edited_text,'Final')
  release()
  const stale = await (old || post(request({ draftId: 'A', editedText: 'Stale', status: 'draft', learningSource: 'typist_autosave', expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })))
  assert.equal(stale.status,409); assert.equal(row.status,'approved'); assert.equal(row.edited_text,'Final')
})
test('both routes persist then linked queue then audit before acknowledgement and same-request learning', () => {
  for (const name of ['save-draft','update-draft']) {
    const source = readFileSync(`app/api/report-writing/${name}/route.ts`,'utf8')
    const post = source.slice(source.indexOf('export async function POST'))
    const persist = post.indexOf(name === 'save-draft' ? '.insert(insertPayload)' : '.update(updatePayload)')
    const queue = post.indexOf(name === 'save-draft' ? 'await updateLinkedQueueItem' : 'await updateLinkedQueueRows')
    const response = post.indexOf('return await approvalResponse')
    assert.ok(persist >= 0 && queue > persist && response > queue)
    assert.match(post, /learning = await processApprovedEdit/)
    assert.doesNotMatch(post, /enqueueTypistLearning|after\(/)
  }
})
test('critical persistence failure returns failure without streaming Approved', async () => {
  const query = { select() { return this }, eq() { return this }, single: async () => ({ data: null, error: { message: 'synthetic failure' } }) }
  const post = runInNewContext(code, { supabase: { from: () => query }, sensitiveApiAccess: async () => null,
    getAuditActor: async () => ({}), NextResponse: { json: Response.json }, console, Date })
  const response: Response = await post(new Request('http://fixture/update', { method: 'POST', body: JSON.stringify({ draftId: 'A', status: 'approved' }) }))
  assert.equal(response.status,404); assert.equal((await response.json()).success,false)
  assert.match(response.headers.get('content-type')!,/application\/json/)
})
