import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const source = readFileSync('app/api/report-writing/update-draft/route.ts', 'utf8')
const code = ts.transpileModule(source.slice(source.indexOf('function clean(')).replace('export async function POST', 'async function POST') + '\nPOST', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function fixture(status = 'draft', updatedAt: string | null = '2026-01-01T00:00:00.000Z') {
  let row: Record<string, unknown> = { id: 'A', status, updated_at: updatedAt, provider_id: 'P', edited_text: 'Old', provider_approved_at: status === 'approved' ? '2025-12-01' : null, approved_by_name: status === 'approved' ? 'Provider' : null, approved_by_initials: status === 'approved' ? 'PR' : null }
  const audits: string[] = []
  const learning: string[] = [], queue: string[] = []
  const predicates: Record<string, unknown>[] = []
  let blockedText: string | null = null, unblock!: () => void, arrived!: () => void
  let blocked = Promise.resolve(), arrival = Promise.resolve()
  const fixedNow = '2026-01-01T00:00:00.000Z'
  class FrozenDate extends Date {
    constructor(value?: string | number) { super(value ?? fixedNow) }
    static now() { return Date.parse(fixedNow) }
  }
  let hold = false, arrivals = 0, release!: () => void
  let ready!: () => void
  const gate = new Promise<void>(r => release = r), waiting = new Promise<void>(r => ready = r)
  const db = { from(table: string) {
    let payload: Record<string, unknown> | undefined
    const filters: Record<string, unknown> = {}
    const query = {
      select() { return query }, eq(k: string, v: unknown) { filters[k] = v; return query }, is(k: string, v: unknown) { filters[k] = v; return query },
      update(p: Record<string, unknown>) { payload = p; return query },
      async single() { return { data: { ...row }, error: null } },
      async maybeSingle() {
        assert.equal(table, 'report_drafts')
        predicates.push({ ...filters })
        if (payload?.edited_text === blockedText) { arrived(); await blocked }
        if (hold) { if (++arrivals === 2) ready(); await gate }
        if (Object.entries(filters).some(([k,v]) => row[k] !== v)) return { data: null, error: null }
        row = { ...row, ...payload }; return { data: { ...row }, error: null }
      },
      then(resolve: (value: unknown) => void) { assert.equal(table, 'report_letter_queue'); queue.push('updated'); resolve({ error: null }) },
    }; return query
  } }
  function post(name: string, role = 'provider', denied = false) {
    return runInNewContext(code, { supabase: db, sensitiveApiAccess: async () => denied ? Response.json({}, { status: 403 }) : null,
      getAuditActor: async () => ({ actorFullName: name, actorInitials: name.slice(0,2), actorRole: role }),
      createReportAuditEvent: async (event: { action: string }) => { audits.push(event.action) },
      approvalResponse: async (params: { draft: unknown; synchronous: () => Promise<unknown>; audit: (value: unknown) => Promise<void> }) => { await params.audit(await params.synchronous()); return Response.json({ success: true, draft: params.draft }) },
      isTypistApproval: () => false, noLearningRequested: () => ({}), processApprovedEdit: async () => { learning.push(name); return {} }, NextResponse: { json: Response.json }, console, Date: FrozenDate,
    }) as (req: Request) => Promise<Response>
  }
  const save = (name: string, body: Record<string, unknown> = {}, role?: string, denied?: boolean) => post(name,role,denied)(new Request('http://fixture', { method: 'POST', body: JSON.stringify({ draftId: 'A', expectedUpdatedAt: row.updated_at, ...body }) }))
  return { save, audits, learning, queue, predicates, row: () => row,
    block(text: string) {
      blockedText = text
      blocked = new Promise<void>(r => unblock = r)
      arrival = new Promise<void>(r => arrived = r)
      return { arrival, release: () => { blockedText = null; unblock() } }
    }, race: async (a: () => Promise<Response>, b: () => Promise<Response>) => { hold = true; const pa = a(), pb = b(); await waiting; release(); return Promise.all([pa,pb]) } }
}
function attribution(f: ReturnType<typeof fixture>) { const r = f.row(); return [r.provider_approved_at, r.approved_by_name, r.approved_by_initials] }
test('provider approval records server actor and ignores arbitrary client identity', async () => {
  const f = fixture(); assert.equal((await f.save('Provider', { status: 'approved', approved_by_name: 'Forged', approved_by_initials: 'XX', approvedByName: 'Forged', provider_approved_at: '1900' })).status,200)
  assert.equal(f.row().approved_by_name,'Provider'); assert.equal(f.row().approved_by_initials,'Pr'); assert.deepEqual(f.audits,['Approved report'])
})
for (const role of ['typist','admin']) test(`${role} edit preserves attribution and uses update audit`, async () => {
  const f = fixture('approved'), before = attribution(f)
  assert.equal((await f.save('Editor', { status: 'approved', editedText: 'Changed' },role)).status,200)
  assert.deepEqual(attribution(f),before); assert.equal(f.row().edited_text,'Changed'); assert.deepEqual(f.audits,['Updated report'])
})
test('approved autosave preserves attribution', async () => {
  const f = fixture('approved'), before = attribution(f)
  assert.equal((await f.save('Typist', { status: 'approved', learningSource: 'typist_autosave', expectedUpdatedAt: f.row().updated_at, editedText: 'Autosaved' })).status,200)
  assert.deepEqual(attribution(f),before); assert.deepEqual(f.audits,['Updated report'])
})
for (const initial of ['approved','draft']) test(`concurrent saves from ${initial}: one revision wins`, async () => {
  const f = fixture(initial), before = attribution(f)
  const results = await f.race(() => f.save('First', { status: 'approved' }), () => f.save('Second', { status: 'approved' }))
  assert.deepEqual(results.map(r => r.status).sort(),[200,409])
  if (initial === 'approved') { assert.deepEqual(attribution(f),before); assert.deepEqual(f.audits,['Updated report']) }
  else { assert.equal(f.row().approved_by_name,'First'); assert.deepEqual(f.audits,['Approved report']) }
  await f.save('Later', { status: 'approved' }); assert.equal(f.row().approved_by_name,initial === 'approved' ? 'Provider' : 'First')
})
test('explicit unapprove clears attribution; reapproval records new actor/time', async () => {
  const f = fixture('approved'), old = attribution(f)
  await f.save('Admin', { unapprove: true, status: 'awaiting_provider_approval' })
  assert.deepEqual(attribution(f),[null,null,null])
  await f.save('New provider', { status: 'approved' })
  assert.equal(f.row().approved_by_name,'New provider'); assert.notEqual(f.row().provider_approved_at,old[0]); assert.deepEqual(f.audits,['Unapproved report','Approved report'])
})
test('authorization still runs before attribution write', async () => {
  const f = fixture('approved'), before = { ...f.row() }
  assert.equal((await f.save('Denied', { status: 'approved' },'typist',true)).status,403)
  assert.deepEqual(f.row(),before); assert.deepEqual(f.audits,[])
})
test('upload, MediRef and completion routes do not write approval provenance', () => {
  for (const route of ['upload-to-praktika','send-via-mediref','verify-workflow-completion','continue-praktika-workflow','workflow-status']) {
    assert.doesNotMatch(readFileSync(`app/api/report-writing/${route}/route.ts`,'utf8'), /(?:approved_by_name|approved_by_initials|provider_approved_at)\s*[:=]/)
  }
})

function effects(f: ReturnType<typeof fixture>) {
  return { audits: [...f.audits], learning: [...f.learning], queue: [...f.queue] }
}
async function conflict(response: Response) {
  assert.equal(response.status, 409)
  const result = await response.json()
  assert.equal(result.code, 'draft_revision_conflict')
  assert.equal(result.reloadRequired, true)
  assert.equal(result.draftId, 'A')
  assert.equal('draft' in result, false)
}
test('stale ordinary draft save cannot overwrite an approval committed after its read', async () => {
  const f = fixture(), gate = f.block('Stale')
  const stale = f.save('Editor', { status: 'draft', editedText: 'Stale', referrerName: 'Stale referrer' })
  await gate.arrival
  assert.equal((await f.save('Provider', { status: 'approved', editedText: 'Final', learnFromEdits: true })).status, 200)
  const before = { ...f.row() }, beforeEffects = effects(f)
  gate.release(); await conflict(await stale)
  assert.deepEqual(f.row(), before); assert.deepEqual(effects(f), beforeEffects)
  assert.deepEqual(f.audits, ['Approved report']); assert.deepEqual(f.learning, ['Provider'])
})
test('ordinary save wins first: stale approval conflicts, deliberate approval after reload wins', async () => {
  const f = fixture(), gate = f.block('Approval from old revision'), originalRevision = f.row().updated_at
  const approval = f.save('Provider', { status: 'approved', editedText: 'Approval from old revision', learnFromEdits: true })
  await gate.arrival
  assert.equal((await f.save('Editor', { status: 'draft', editedText: 'New draft' })).status, 200)
  const before = { ...f.row() }, beforeEffects = effects(f)
  gate.release(); await conflict(await approval)
  assert.deepEqual(f.row(), before); assert.deepEqual(effects(f), beforeEffects)
  await conflict(await f.save('Provider', { status: 'approved', expectedUpdatedAt: originalRevision }))
  assert.equal((await f.save('Provider', { status: 'approved', editedText: 'New draft', expectedUpdatedAt: f.row().updated_at })).status, 200)
  assert.equal(f.row().approved_by_name, 'Provider'); assert.deepEqual(f.audits, ['Saved draft report', 'Approved report'])
})
test('approved autosave loses to explicit unapproval without any side effect', async () => {
  const f = fixture('approved'), gate = f.block('Stale autosave')
  const stale = f.save('Typist', { status: 'approved', editedText: 'Stale autosave', learningSource: 'typist_autosave', learnFromEdits: true, referrerName: 'Stale' })
  await gate.arrival
  assert.equal((await f.save('Provider', { status: 'awaiting_provider_approval', unapprove: true })).status, 200)
  const before = { ...f.row() }, beforeEffects = effects(f)
  gate.release(); await conflict(await stale)
  assert.deepEqual(f.row(), before); assert.deepEqual(effects(f), beforeEffects)
  assert.deepEqual(attribution(f), [null, null, null])
})
test('stale approved save cannot cross same-clock unapprove/reapprove cycle', async () => {
  const f = fixture('approved'), gate = f.block('Old approved text')
  const stale = f.save('Old editor', { status: 'approved', editedText: 'Old approved text', learnFromEdits: true, referrerName: 'Stale' })
  await gate.arrival
  await f.save('Provider', { status: 'awaiting_provider_approval', unapprove: true })
  await f.save('New provider', { status: 'approved', editedText: 'New approved text' })
  const before = { ...f.row() }, beforeEffects = effects(f)
  gate.release(); await conflict(await stale)
  assert.deepEqual(f.row(), before); assert.deepEqual(effects(f), beforeEffects)
  assert.equal(f.row().approved_by_name, 'New provider')
})
test('two ordinary content saves from one revision: winner advances even with frozen clock', async () => {
  const f = fixture(), initialRevision = f.row().updated_at
  const results = await f.race(
    () => f.save('First', { status: 'draft', editedText: 'First', referrerName: 'First' }),
    () => f.save('Second', { status: 'draft', editedText: 'Second', referrerName: 'Second' }),
  )
  assert.deepEqual(results.map(r => r.status), [200, 409])
  assert.equal(f.row().updated_at, '2026-01-01T00:00:00.001Z')
  assert.equal(f.row().edited_text, 'First'); assert.deepEqual(f.audits, ['Saved draft report']); assert.equal(f.queue.length, 1)
  await conflict(await f.save('Stale', { expectedUpdatedAt: initialRevision, editedText: 'Stale' }))
})
test('microsecond token is compared intact and next millisecond exceeds it', async () => {
  const revision = '2026-01-01T00:00:00.000999+00:00', f = fixture('draft', revision)
  await conflict(await f.save('Truncated', { expectedUpdatedAt: '2026-01-01T00:00:00.000Z', editedText: 'Stale' }))
  assert.equal((await f.save('Editor', { editedText: 'Exact', expectedUpdatedAt: revision })).status, 200)
  assert.equal(f.predicates[0].updated_at, revision)
  assert.equal(f.row().updated_at, '2026-01-01T00:00:00.001Z')
  await conflict(await f.save('Stale', { expectedUpdatedAt: revision, editedText: 'Stale' }))
})
test('clock regression never reuses a future revision', async () => {
  const f = fixture('draft', '2026-01-02T00:00:00.123456+00:00')
  await f.save('Editor', { editedText: 'First' }); assert.equal(f.row().updated_at, '2026-01-02T00:00:00.124Z')
  await f.save('Editor', { editedText: 'Second' }); assert.equal(f.row().updated_at, '2026-01-02T00:00:00.125Z')
})
test('null legacy revision is explicitly fenced; missing/malformed tokens never write', async () => {
  const f = fixture('draft', null)
  await conflict(await f.save('Missing', { expectedUpdatedAt: undefined, editedText: 'Missing' }))
  await conflict(await f.save('Malformed', { expectedUpdatedAt: 'invalid', editedText: 'Invalid' }))
  assert.equal((await f.save('Editor', { expectedUpdatedAt: null, editedText: 'Saved' })).status, 200)
  assert.equal(f.predicates[0].updated_at, null); assert.equal(f.predicates[0].status, 'draft')
  await conflict(await f.save('Old', { expectedUpdatedAt: null, editedText: 'Stale' }))
})
test('metadata-only writes also fence and advance the revision', async () => {
  const f = fixture(), gate = f.block('New text')
  const late = f.save('Editor', { editedText: 'New text' })
  await gate.arrival
  assert.equal((await f.save('Metadata editor', { patientDob: '2000-01-01' })).status, 200)
  const before = { ...f.row() }, beforeEffects = effects(f)
  gate.release(); await conflict(await late)
  assert.deepEqual(f.row(), before); assert.deepEqual(effects(f), beforeEffects)
})
