import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type { SupabaseClient } from "@supabase/supabase-js"
import type OpenAI from "openai"
import type { AuditActor } from "./audit"
import { prepareApprovedEdit } from "./approved-edit-input"
import * as analysisModule from "./edit-learning-analysis"
import { analyseApprovedEdit, getEvidenceWeight } from "./edit-learning-analysis"
import * as queueModule from "./typist-learning-queue"
import { enqueueTypistLearning, TYPIST_LEARNING_SOURCES } from "./typist-learning-queue"
import { LearningConfigurationError, processSavedLearningExample, runTypistLearningWorker } from "./typist-learning-worker"

const actor: AuditActor = {
  actorUserId: null, actorRole: "typist", actorFullName: "Synthetic reviewer",
  actorEmail: null, actorInitials: "SY", rawProfileRole: "typist",
}
const noLearning = () => ({
  requested: false, exampleSaved: false, exampleId: null, duplicate: false,
  analysisStatus: "not_requested" as const, behavioursCreated: 0,
  behavioursReinforced: 0, error: null,
})
const input = {
  providerId: "provider", draftId: "draft", reportType: "consultation_report",
  originalText: "Synthetic original", finalText: "Synthetic final",
  source: TYPIST_LEARNING_SOURCES[0], actor,
}
type Row = Record<string, unknown>

class FakeDatabase {
  events: string[] = []
  drafts = new Map<string, Row>()
  examples = new Map<string, Row>()
  behaviour: Row | null = null
  behaviourWrites: Row[] = []
  failDraft = false
  failEnqueue = false
  from(table: string) {
    let operation = "select"
    let payload: Row = {}
    const filters = new Map<string, unknown>()
    const run = async () => {
      if (table === "report_drafts") {
        if (operation === "select") return { data: this.drafts.get(String(filters.get("id"))), error: null }
        this.events.push("draft")
        if (this.failDraft) return { data: null, error: { message: "synthetic_write_failure" } }
        const id = operation === "insert" ? randomUUID() : String(filters.get("id"))
        const data = { ...this.drafts.get(id), ...payload, id }
        this.drafts.set(id, data)
        return { data, error: null }
      }
      if (table === "report_letter_queue") {
        this.events.push("queue")
        return { data: null, error: null }
      }
      if (table === "provider_behaviours") {
        if (operation === "select") return { data: this.behaviour, error: null }
        this.behaviourWrites.push(payload)
        return { data: null, error: null }
      }
      assert.equal(table, "provider_report_edit_examples")
      if (operation === "select") {
        return { data: this.examples.get(String(filters.get("edit_fingerprint"))), error: null }
      }
      this.events.push("enqueue")
      if (this.failEnqueue) return { data: null, error: { code: "XX000" } }
      const fingerprint = String(payload.edit_fingerprint)
      if (operation === "insert" && this.examples.has(fingerprint)) {
        return { data: null, error: { code: "23505" } }
      }
      const data = { ...payload, id: "example" }
      if (operation === "insert") this.examples.set(fingerprint, data)
      return { data, error: null }
    }
    const query = {
      insert: (value: Row) => { operation = "insert"; payload = value; return query },
      update: (value: Row) => { operation = "update"; payload = value; return query },
      select: () => query,
      eq: (key: string, value: unknown) => { filters.set(key, value); return query },
      single: run,
      maybeSingle: run,
      then: (resolve: (value: Awaited<ReturnType<typeof run>>) => unknown) => run().then(resolve),
    }
    return query
  }
  client() { return this as unknown as SupabaseClient }
}

function compileModule(path: string, requireModule: (name: string) => unknown) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports: Record<string, unknown> = {}
  new Function("require", "exports", "console", "process", code)(
    requireModule, exports, { error() {}, warn() {} },
    { env: { OPENAI_API_KEY: "synthetic-test-placeholder" } },
  )
  return exports
}

function route(name: string, db: FakeDatabase, options: {
  synchronous?: () => Promise<ReturnType<typeof noLearning>>
  denied?: boolean
  failAudit?: boolean
} = {}) {
  const exports = compileModule(`app/api/report-writing/${name}/route.ts`, module => {
    switch (module) {
      case "@/lib/auth": return { sensitiveApiAccess: async () => options.denied ? Response.json({}, { status: 403 }) : null }
      case "next/server": return { NextResponse: { json: Response.json } }
      case "@supabase/supabase-js": return { createClient: () => db.client() }
      case "@/lib/report-writing/audit": return {
        getAuditActor: async () => actor,
        createReportAuditEvent: async () => {
          db.events.push("audit")
          if (options.failAudit) throw new Error("synthetic_audit_failure")
        },
      }
      case "@/lib/report-writing/edit-learning": return {
        noLearningRequested: noLearning,
        processApprovedEdit: options.synchronous ?? (async () => {
          db.events.push("synchronous_learning")
          return noLearning()
        }),
      }
      case "@/lib/report-writing/typist-learning-queue": return queueModule
      default: throw new Error(`Unexpected route dependency: ${module}`)
    }
  })
  return exports.POST as (req: Request) => Promise<Response>
}

function request(source: string, extra: Row = {}) {
  return new Request("http://localhost/approval", { method: "POST", body: JSON.stringify({
    providerId: "provider", patientName: "Synthetic fixture", reportType: "consultation_report",
    status: "approved", originalAiText: input.originalText, generatedReport: input.originalText,
    editedText: input.finalText, finalApprovedText: input.finalText,
    learnFromEdits: true, learningSource: source, queueId: "queue", referrerName: "Synthetic referrer", ...extra,
  }) })
}

for (const source of TYPIST_LEARNING_SOURCES) {
  const name = source === "typist_direct_approval" ? "save-draft" : "update-draft"
  test(`${source}: real route persists, audits, enqueues, responds without synchronous AI`, async () => {
    const db = new FakeDatabase()
    db.drafts.set("draft", { id: "draft", provider_id: "provider", status: "draft", ai_generated_text: input.originalText })
    const post = route(name, db, { synchronous: async () => assert.fail("AI must not run") })
    const response = await post(request(source, { draftId: "draft" }))
    const body = await response.json()
    assert.equal(body.success, true)
    assert.equal(body.learningQueued, true)
    assert.equal(body.draft.status, "approved")
    assert.deepEqual(db.events, ["draft", "queue", "audit", "enqueue"])
    assert.equal(db.examples.size, 1)
    const example = [...db.examples.values()][0]
    assert.equal(example.original_text, input.originalText)
    assert.equal(example.final_text, body.draft.edited_text)
    assert.equal(example.analysis_status, "pending")
    assert.equal(example.analysis_attempts, 0)
    assert.ok(example.next_attempt_at)
  })
}

for (const source of ["provider_direct_approval", "provider_existing_draft_approval", "provider_approval_edit", "clinical_scribe_letter_approval"]) {
  for (const name of ["save-draft", "update-draft"]) {
    test(`${source} on ${name} retains synchronous learning before audit/response`, async () => {
      const db = new FakeDatabase()
      db.drafts.set("draft", { provider_id: "provider", ai_generated_text: input.originalText })
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      let started!: () => void
      const ready = new Promise<void>(resolve => { started = resolve })
      const post = route(name, db, { synchronous: async () => {
        db.events.push("synchronous_learning"); started(); await gate; return noLearning()
      } })
      let responded = false
      const pending = post(request(source, { draftId: "draft" })).then(result => { responded = true; return result })
      await ready
      assert.equal(responded, false)
      assert.equal(db.events.includes("audit"), false)
      release()
      const body = await (await pending).json()
      assert.equal(body.success, true)
      assert.deepEqual(db.events, ["draft", "queue", "synchronous_learning", "audit"])
      assert.equal(body.learningQueued, undefined)
    })
  }
}

test("failed draft/auth/audit never enqueues", async () => {
  for (const failure of ["draft", "auth", "audit"]) {
    const db = new FakeDatabase(); db.failDraft = failure === "draft"
    const post = route("save-draft", db, { denied: failure === "auth", failAudit: failure === "audit" })
    assert.ok((await post(request(TYPIST_LEARNING_SOURCES[0]))).status >= 400)
    assert.equal(db.examples.size, 0)
  }
})

test("enqueue failure returns approved partial success and never replays draft persistence", async () => {
  const db = new FakeDatabase(); db.failEnqueue = true
  const body = await (await route("save-draft", db)(request(TYPIST_LEARNING_SOURCES[0]))).json()
  assert.equal(body.success, true)
  assert.equal(body.learningQueued, false)
  assert.equal(body.draft.status, "approved")
  assert.equal(body.learning.error, "learning_enqueue_failed")
  assert.equal(db.drafts.size, 1)
  assert.deepEqual(db.events, ["draft", "queue", "audit", "enqueue"])
})

test("queued final text is the persisted text, not an inconsistent finalApprovedText field", async () => {
  const db = new FakeDatabase(); db.drafts.set("draft", { provider_id: "provider", ai_generated_text: input.originalText })
  await route("update-draft", db)(request(TYPIST_LEARNING_SOURCES[2], {
    draftId: "draft", finalApprovedText: "Unpersisted synthetic value",
  }))
  assert.equal([...db.examples.values()][0].final_text, input.finalText)
})

test("stable existing draft fingerprint preserves pending/processing/terminal records", async () => {
  for (const status of ["pending", "processing", "failed", "processed", "ignored"]) {
    const db = new FakeDatabase()
    await enqueueTypistLearning(db.client(), input)
    const example = [...db.examples.values()][0]
    example.analysis_status = status; example.analysis_attempts = 3
    if (["failed", "processed", "ignored"].includes(status)) example.next_attempt_at = null
    const before = structuredClone(example)
    const result = await enqueueTypistLearning(db.client(), input)
    assert.equal(result.learning.duplicate, true)
    assert.equal(result.learning.exampleId, "example")
    assert.deepEqual(example, before)
  }
})

test("non-approved/learning-disabled requests do not enroll examples", async () => {
  for (const extra of [{ status: "draft" }, { learnFromEdits: false }]) {
    const db = new FakeDatabase()
    await route("save-draft", db)(request(TYPIST_LEARNING_SOURCES[0], extra))
    assert.equal(db.examples.size, 0)
  }
})

test("new save-draft ambiguous retry retains documented new-ID/new-example limitation", async () => {
  const db = new FakeDatabase(); const post = route("save-draft", db)
  const first = await (await post(request(TYPIST_LEARNING_SOURCES[0]))).json()
  const retry = await (await post(request(TYPIST_LEARNING_SOURCES[0]))).json()
  assert.notEqual(first.draft.id, retry.draft.id)
  assert.equal(db.examples.size, 2)
})

test("saved input applicability, fingerprint and evidence weights preserve current semantics", () => {
  assert.equal(prepareApprovedEdit({ ...input, finalText: input.originalText }), null)
  assert.equal(prepareApprovedEdit({ ...input, originalText: " " }), null)
  assert.equal(prepareApprovedEdit(input)?.edit_fingerprint, prepareApprovedEdit({ ...input, finalText: ` ${input.finalText} ` })?.edit_fingerprint)
  for (const [role, weight] of [["provider", 12], ["admin", 9], ["typist", 6], ["staff", 4], ["unknown", 3]] as const) {
    assert.equal(getEvidenceWeight({ ...actor, actorRole: role }, input.source), weight)
  }
  assert.equal(getEvidenceWeight(actor, "provider_approval"), 9)
})

test("existing analyser preserves model, prompt boundary, normalization and five-behaviour limit", async () => {
  let captured: Row = {}
  const client = { chat: { completions: { create: async (body: Row) => {
    captured = body
    return { choices: [{ message: { content: JSON.stringify({ reusable: true, behaviours: Array.from({ length: 7 }, (_, i) => ({
      behaviour_key: `Key ${i}!`, behaviour_text: "Plain text", confidence_delta: 99,
      knowledge_type: "invalid", preferred_phrase: "must be removed",
    })) }) } }] }
  } } } } as unknown as Pick<OpenAI, "chat">
  const result = await analyseApprovedEdit(client, { reportType: input.reportType,
    originalText: input.originalText, finalText: input.finalText, actorRole: "typist", source: input.source })
  assert.equal(captured.model, "gpt-4.1-mini")
  assert.equal(captured.temperature, 0)
  assert.ok(JSON.stringify(captured.messages).includes("Do not include patient-identifying information"))
  assert.equal(result.behaviours.length, 5)
  assert.equal(result.behaviours[0].behaviour_key, "key_0")
  assert.equal(result.behaviours[0].confidence_delta, 5)
  assert.equal(result.behaviours[0].preferred_phrase, null)
})

test("synchronous behaviour calculation golden cases match queued SQL parity matrix", async () => {
  for (const [role, weight] of [["provider", 12], ["admin", 9], ["typist", 6], ["staff", 4], ["unknown", 3]] as const) {
    for (const confidence of [null, 0, 50, 99]) {
      const db = new FakeDatabase()
      if (confidence !== null) db.behaviour = { id: "behaviour", confidence, support_count: 0, evidence_summary: " Prior evidence " }
      const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({
        reusable: true, behaviours: [{ behaviour_key: "plain", behaviour_text: "Plain text", confidence_delta: 5 }],
      }) } }] }) } } }
      const exports = compileModule("lib/report-writing/edit-learning.ts", name => {
        if (name === "openai") return { default: class { chat = client.chat } }
        if (name === "@supabase/supabase-js") return { createClient: () => db.client() }
        if (name === "./edit-learning-analysis") return analysisModule
        if (name === "./approved-edit-input") return { prepareApprovedEdit }
        throw new Error(`Unexpected learning dependency: ${name}`)
      })
      const process = exports.processApprovedEdit as (value: typeof input) => Promise<unknown>
      await process({ ...input, actor: { ...actor, actorRole: role } })
      const write = db.behaviourWrites[0]
      assert.ok(write)
      assert.equal(write.confidence, confidence === null ? 45 + weight : Math.min(100, (confidence || 50) + weight))
      assert.equal(write.support_count, confidence === null ? 1 : 2)
    }
  }
})

test("worker uses only saved input; failures and logs contain no supplied sensitive error", async () => {
  const events: unknown[] = []; const calls: Row[] = []
  const db = { rpc: async (name: string, args: Row) => {
    assert.equal(name, "finish_typist_edit_learning"); calls.push(args); return { data: true, error: null }
  } } as unknown as Pick<SupabaseClient, "rpc">
  const example = { id: "example", provider_id: "provider", report_type: input.reportType,
    original_text: "Saved original", final_text: "Saved final", editor_role: "typist",
    source: input.source, claim_token: "token", analysis_attempts: 1 }
  await processSavedLearningExample({ db, example, log: event => events.push(event), analyse: async saved => {
    assert.equal(saved.originalText, "Saved original")
    assert.equal(saved.finalText, "Saved final")
    throw Object.assign(new Error("DO_NOT_LOG_PRIVATE_CONTENT"), { status: 401 })
  } })
  assert.equal(calls[0].p_retryable, false)
  assert.equal(calls[0].p_failure_code, "analysis_rejected")
  assert.ok(!JSON.stringify(events).includes("DO_NOT_LOG"))
  assert.ok(!JSON.stringify(events).includes("Saved original"))
  assert.match(readFileSync("scripts/process-typist-edit-learning.ts", "utf8"), /logLevel: "off"/)
})

test("poller runs one example at a time, sleeps five seconds and stops claiming on shutdown", async () => {
  let stop = false; let claims = 0; const sleeps: number[] = []
  const db = { rpc: async () => { claims++; return { data: [], error: null } } } as unknown as Pick<SupabaseClient, "rpc">
  await runTypistLearningWorker({ db, analyse: async () => assert.fail("No analysis for empty queue"),
    stopping: () => stop, log() {}, sleep: async ms => { sleeps.push(ms); stop = true } })
  assert.deepEqual(sleeps, [5000]); assert.equal(claims, 1)
})

test("shutdown during analysis prevents a second claim and completion contains normalized result only", async () => {
  let stop = false; let claims = 0; let release!: () => void; let began!: () => void
  const running = new Promise<void>(resolve => { began = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const example = { id: "example", provider_id: "provider", report_type: input.reportType,
    original_text: input.originalText, final_text: input.finalText, editor_role: "typist",
    source: input.source, claim_token: "token", analysis_attempts: 1 }
  const db = { rpc: async (name: string, args: Row) => {
    if (name === "claim_typist_edit_learning") { claims++; return { data: [example], error: null } }
    assert.equal(name, "finish_typist_edit_learning")
    assert.equal(args.p_token, "token")
    assert.equal(args.p_failure_code, null)
    assert.deepEqual(args.p_analysis, { reusable: false, ignore_reason: "Not reusable", summary: "Synthetic", behaviours: [] })
    return { data: true, error: null }
  } } as unknown as Pick<SupabaseClient, "rpc">
  const worker = runTypistLearningWorker({ db, stopping: () => stop, log() {}, analyse: async () => {
    began(); await gate
    return { reusable: false, ignore_reason: "Not reusable", summary: "Synthetic", behaviours: [] }
  } })
  await running
  assert.equal(claims, 1)
  stop = true; release(); await worker
  assert.equal(claims, 1)
})

test("invalid saved input is terminal without AI and transient failure remains retryable", async () => {
  for (const invalid of [true, false]) {
    const calls: Row[] = []
    const db = { rpc: async (_: string, args: Row) => { calls.push(args); return { data: true, error: null } } } as unknown as Pick<SupabaseClient, "rpc">
    const example = { id: "example", provider_id: invalid ? null : "provider", report_type: input.reportType,
      original_text: input.originalText, final_text: input.finalText, editor_role: "typist",
      source: input.source, claim_token: "token", analysis_attempts: 1 }
    await processSavedLearningExample({ db, example, log() {}, analyse: async () => {
      assert.equal(invalid, false); throw new Error("DO_NOT_LOG_TRANSIENT_DETAILS")
    } })
    assert.equal(calls[0].p_retryable, !invalid)
    assert.equal(calls[0].p_failure_code, invalid ? "invalid_saved_input" : "learning_execution_failed")
  }
})

test("missing AI configuration is a terminal, sanitized learning failure", async () => {
  const calls: Row[] = []; const events: unknown[] = []
  const db = { rpc: async (_: string, args: Row) => { calls.push(args); return { data: true, error: null } } } as unknown as Pick<SupabaseClient, "rpc">
  await processSavedLearningExample({ db, example: {
    id: "example", provider_id: "provider", report_type: input.reportType,
    original_text: input.originalText, final_text: input.finalText, editor_role: "typist",
    source: input.source, claim_token: "token", analysis_attempts: 1,
  }, analyse: async () => { throw new LearningConfigurationError() }, log: event => events.push(event) })
  assert.equal(calls[0].p_retryable, false)
  assert.equal(calls[0].p_failure_code, "worker_configuration_missing")
  assert.ok(!JSON.stringify(events).includes(input.originalText))
})

test("Typist UI guards ordinary double clicks, releases approved state before refresh and adds no learning spinner", () => {
  const ui = readFileSync("app/(protected)/report-writing/typist/TypistPage.tsx", "utf8")
  for (const name of ["saveNewDraft", "updateExistingDraft"]) {
    const start = ui.indexOf(`  async function ${name}(`)
    const end = ui.indexOf("\n  async function ", start + 1)
    const handler = ui.slice(start, end)
    assert.ok(handler.includes("if (loading) return;"))
    assert.ok(handler.indexOf("approvalFinished = true;") < handler.indexOf("await loadDrafts"))
    assert.ok(!handler.includes("processApprovedEdit"))
  }
  assert.match(ui, /onClick=\{\(\) => saveNewDraft\("approved"\)\}\s+disabled=\{loading\}/)
  assert.match(ui, /onClick=\{\(\) => updateExistingDraft\("approved"\)\}\s+disabled=\{loading\}/)
  assert.ok(!readFileSync("lib/report-writing/complete-workflow.ts", "utf8").includes("learning"))
})

for (const name of ["saveNewDraft", "updateExistingDraft"]) {
  test(`${name}: submission lock rejects a second ordinary approval while the request is pending`, async () => {
    const ui = readFileSync("app/(protected)/report-writing/typist/TypistPage.tsx", "utf8")
    const start = ui.indexOf(`  async function ${name}(`)
    const end = ui.indexOf("\n  async function ", start + 1)
    const code = ts.transpileModule(ui.slice(start, end), {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText
    let calls = 0; let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const context: Record<string, unknown> = {
      loading: false, queueSelectionTokenRef: { current: 1 },
      selectedProviderId: "provider", patientFirstName: "Synthetic", patientLastName: "Fixture",
      patientName: "Synthetic fixture", patientDob: null, patientGender: "neutral",
      letterText: input.finalText, generatedAiLetterText: input.originalText,
      getLetterTextForSave: () => input.finalText, imageDraftId: null,
      selectedDraft: { id: "draft", ai_generated_text: input.originalText },
      reportType: input.reportType, referrerName: "", referrerAddress: "",
      clinicalNotes: "", typistQueries: "", selectedPraktikaPatientId: null,
      activeQueueItemId: null, confirm: () => true, alert() {},
      setLoading: (value: boolean) => { context.loading = value },
      fetch: async () => { calls++; await gate; return Response.json({ success: false, error: "Synthetic rejected request" }) },
    }
    const approve = runInNewContext(code + `\n${name}`, context) as (status: string) => Promise<void>
    const first = approve("approved")
    assert.equal(calls, 1)
    assert.equal(context.loading, true)
    await approve("approved")
    assert.equal(calls, 1)
    release(); await first
    assert.equal(context.loading, false)
  })
}

test("moving to another letter does not skip the original image approval queue completion", async () => {
  const ui = readFileSync("app/(protected)/report-writing/typist/TypistPage.tsx", "utf8")
  const start = ui.indexOf("  async function saveNewDraft(")
  const end = ui.indexOf("\n  async function ", start + 1)
  const code = ts.transpileModule(ui.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const calls: { url: string; body: Row }[] = []
  const selection = { current: 1 }
  const context: Record<string, unknown> = {
    loading: false, queueSelectionTokenRef: selection,
    selectedProviderId: "provider", patientFirstName: "Synthetic", patientLastName: "Fixture",
    patientName: "Synthetic fixture", patientDob: null, patientGender: "neutral",
    letterText: input.finalText, generatedAiLetterText: input.originalText,
    getLetterTextForSave: () => input.finalText, imageDraftId: "draft",
    reportType: input.reportType, referrerName: "", referrerAddress: "",
    clinicalNotes: "", typistQueries: "", selectedPraktikaPatientId: null,
    activeQueueItemId: "queue", queueStatusTab: "started", confirm: () => true, alert() {},
    setLoading: (value: boolean) => { context.loading = value },
    setSelectedDraft: () => assert.fail("Must not replace the newly selected letter"),
    loadQueue: async () => {},
    fetch: async (url: string, options: { body: string }) => {
      calls.push({ url, body: JSON.parse(options.body) })
      if (calls.length === 1) {
        await gate
        return Response.json({ success: true, learningQueued: true, draft: { id: "draft", status: "approved" } })
      }
      return Response.json({ success: true })
    },
  }
  const approve = runInNewContext(code + "\nsaveNewDraft", context) as (status: string) => Promise<void>
  const pending = approve("approved")
  selection.current = 2
  context.loading = false
  release(); await pending
  assert.equal(calls[0].url, "/api/report-writing/update-draft")
  assert.equal(calls[1].url, "/api/report-writing/letter-queue")
  assert.deepEqual(calls[1].body, { queueId: "queue", status: "completed", reportDraftId: "draft" })
})
