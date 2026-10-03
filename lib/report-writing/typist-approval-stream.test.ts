import { approvedDraftFixture } from './typist-approval-fixtures.test-helper'
import assert from 'node:assert/strict'
import test from 'node:test'
import { claimWorkflowStart } from './complete-workflow'
import type { SupabaseClient } from '@supabase/supabase-js'
import { approvalResponse, readApprovalResponse, isTypistApproval } from './typist-approval-stream'
import type { EditLearningResult } from './edit-learning-analysis'
const initial: EditLearningResult = { requested: false, exampleSaved: false, exampleId: null, duplicate: false, analysisStatus: 'ignored', behavioursCreated: 0, behavioursReinforced: 0, error: null }
const gate = () => { let release!: () => void; return { promise: new Promise<void>(r => release = r), release: () => release() } }

test('audit gates acknowledgement, UI releases while same response awaits learning; A tail cannot mutate B or workflow', async () => {
  const audit = gate(), learning = gate(); let started = false, completed = false
  const responsePromise = approvalResponse({ typist: true, draft: approvedDraftFixture({ id: 'A' }), initialLearning: initial,
    audit: () => audit.promise, synchronous: async () => { started = true; await learning.promise; completed = true; return initial } })
  let acknowledged = false
  const resultPromise = responsePromise.then(readApprovalResponse).then(result => { acknowledged = true; return result })
  await Promise.resolve(); assert.equal(acknowledged, false); assert.equal(started, false)
  audit.release(); const result = await resultPromise
  assert.equal(result.success, true); assert.equal(started, true); assert.equal(completed, false)
  let workflowStarted = false
  const workflowDb = { from(table: string) {
    assert.equal(table, 'report_drafts')
    const q = {
      update(update: Record<string, unknown>) { assert.equal(update.workflow_status, 'running'); return q },
      eq(column: string, value: string) { assert.equal(column, 'id'); assert.equal(value, 'A'); return q },
      is(column: string) { assert.equal(column, 'deleted_at'); return q },
      in(column: string, statuses: string[]) { assert.equal(column, 'status'); assert.ok(statuses.includes('approved')); return q },
      or(filter: string) { assert.doesNotMatch(filter, /learning|analysis/); return q },
      select() { return q },
      async maybeSingle() { workflowStarted = true; return { data: { id: 'A', workflow_status: 'running' }, error: null } },
    }; return q
  } } as unknown as SupabaseClient
  await claimWorkflowStart(workflowDb, 'A', { workflow_status: 'running' })
  assert.equal(workflowStarted, true); assert.equal(completed, false)
  const selection = { letter: 'B', tab: 'drafts', workflow: 'running', revision: 2 }
  // Workflow A and approval B proceed while A's original response remains open.
  const bLearning = gate()
  const b = await approvalResponse({ typist: true, draft: approvedDraftFixture({ id: 'B' }), initialLearning: initial,
    audit: async () => {}, synchronous: async () => { await bLearning.promise; return initial } })
  assert.equal((await readApprovalResponse(b)).draft?.id, 'B')
  learning.release(); await new Promise(r => setImmediate(r))
  assert.equal(completed, true)
  assert.deepEqual(selection, { letter: 'B', tab: 'drafts', workflow: 'running', revision: 2 })
  bLearning.release()
})
test('learning failure and response termination never undo acknowledged approval', async () => {
  for (const terminate of [false, true]) {
    const learning = gate(); const persisted = { status: 'approved', text: 'Final' }
    const response = await approvalResponse({ typist: true, draft: persisted, initialLearning: initial,
      audit: async () => {}, synchronous: async () => { await learning.promise; throw new Error('synthetic') } })
    const reader = response.body!.getReader(); const first = await reader.read()
    assert.equal(JSON.parse(new TextDecoder().decode(first.value)).type, 'approval_complete')
    if (terminate) await reader.cancel()
    learning.release()
    if (!terminate) { const tail = await reader.read(); assert.equal(JSON.parse(new TextDecoder().decode(tail.value)).type, 'learning_failed') }
    assert.deepEqual(persisted, { status: 'approved', text: 'Final' })
  }
})
test('non-Typist approvals retain learning then audit and JSON; all three Typist sources stream even without edits', async () => {
  for (const source of ['typist_direct_approval','typist_image_workspace_final_save','typist_existing_draft_approval']) assert.equal(isTypistApproval('approved', source), true)
  for (const source of ['provider_approval','clinical_scribe']) {
    assert.equal(isTypistApproval('approved', source), false)
    const order: string[] = []
    const response = await approvalResponse({ typist: false, draft: {}, initialLearning: initial,
      synchronous: async () => { order.push('learning'); return initial }, audit: async () => { order.push('audit') } })
    assert.deepEqual(order, ['learning','audit']); assert.match(response.headers.get('content-type')!, /application\/json/)
  }
})
test('missing acknowledgement fails approval; malformed late tail cannot undo acknowledgement', async () => {
  await assert.rejects(readApprovalResponse(new Response('', { headers: { 'content-type': 'application/x-ndjson' } })))
  const response = new Response(JSON.stringify({ type: 'approval_complete', success: true, draft: approvedDraftFixture() }) + '\ninvalid\n', { headers: { 'content-type': 'application/x-ndjson' } })
  assert.equal((await readApprovalResponse(response)).success, true)
})
