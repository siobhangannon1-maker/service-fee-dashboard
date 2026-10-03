import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createOrReinforceBehaviour } from './behaviour-reinforcement'
import type { AuditActor } from './audit'
import type { AnalysedBehaviour } from './edit-learning-analysis'
const actor: AuditActor = { actorUserId: null, actorFullName: 'Synthetic', actorEmail: null, actorInitials: 'S', actorRole: 'typist', rawProfileRole: 'typist' }
const behaviour: AnalysedBehaviour = { behaviour_key: 'concise', category: 'style', knowledge_type: 'behaviour', behaviour_text: 'Be concise', evidence_summary: 'Shorter sentences', confidence_delta: 5, preferred_phrase: null, template_block: null, applies_when: null }
for (const absent of [false, true]) test(`concurrent reinforcement preserves both increments, initially absent=${absent}`, async () => {
  let row: Record<string, unknown> | null = absent ? null : { id: 'one', support_count: 1, confidence: 50, evidence_summary: null }
  let reads = 0; let release!: () => void
  const barrier = new Promise<void>(r => release = r)
  const db = { from() {
    let payload: Record<string, unknown> = {}, mode = 'read'; const filters: Record<string, unknown> = {}
    const query = {
      select() { return mode === 'update' ? execute() : query },
      eq(k: string, v: unknown) { filters[k] = v; return query },
      is(k: string, v: unknown) { filters[k] = v; return query },
      async maybeSingle() { const snapshot = row ? { ...row } : null; if (++reads <= 2) { if (reads === 2) release(); await barrier } return { data: snapshot, error: null } },
      update(p: Record<string, unknown>) { mode = 'update'; payload = p; return query },
      async insert(p: Record<string, unknown>) { if (row) return { error: { code: '23505' } }; row = { id: 'one', ...p }; return { error: null } },
    }
    async function execute() { if (!row || Object.entries(filters).some(([k,v]) => row![k] !== v)) return { data: [], error: null }; row = { ...row, ...payload }; return { data: [{ id: 'one' }], error: null } }
    return query
  } } as unknown as SupabaseClient
  const outcomes = await Promise.all([1,2].map(() => createOrReinforceBehaviour({ providerId: 'p', reportType: 'r', behaviour, source: 'typist_existing_draft_approval', actor }, db)))
  assert.equal(row!.support_count, absent ? 2 : 3)
  assert.equal(outcomes.filter(x => x === 'created').length, absent ? 1 : 0)
  assert.ok(Number(row!.confidence) > 50)
})
