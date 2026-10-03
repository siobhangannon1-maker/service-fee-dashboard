import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"
import { readFileSync } from "node:fs"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"
import { analyseApprovedEdit } from "./edit-learning-analysis"
import { analyseTypistEditWithDeadline, LearningAnalysisDeadlineError, TYPIST_ANALYSIS_BUDGET_MS } from "./typist-learning-deadline"
import { processSavedLearningExample, type SavedLearningExample } from "./typist-learning-worker"

const input = { reportType: "consultation_report", originalText: "Synthetic original",
  finalText: "Synthetic final", actorRole: "typist", source: "typist_existing_draft_approval" }
const normalized = { reusable: true, ignore_reason: null, summary: "Synthetic style",
  behaviours: [{ behaviour_key: "plain_style", category: "style", knowledge_type: "behaviour",
    behaviour_text: "Use plain language", preferred_phrase: null, template_block: null,
    applies_when: null, evidence_summary: "Synthetic evidence", confidence_delta: 2 }] }
const success = () => Response.json({ choices: [{ message: { content: JSON.stringify(normalized) } }] })
const busy = (headers: HeadersInit = { "retry-after": "7200" }) => Response.json(
  { error: { message: "Synthetic sensitive SDK error must never be logged" } }, { status: 429, headers })
function client(fetch: typeof globalThis.fetch) {
  return new OpenAI({ apiKey: "synthetic-placeholder", logLevel: "off", fetch })
}
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)) }
function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 })
  const active = new Set<ReturnType<typeof setTimeout>>()
  const originalSet = globalThis.setTimeout
  const originalClear = globalThis.clearTimeout
  t.mock.method(globalThis, "setTimeout", (callback: () => void, ms?: number) => {
    const timer = originalSet(() => { active.delete(timer); callback() }, ms)
    active.add(timer)
    return timer
  })
  t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => {
    active.delete(timer)
    originalClear(timer)
  })
  return { active, tick: async (ms: number) => { t.mock.timers.tick(ms); await flush() } }
}

test("normal fast analysis succeeds and clears all timers", async t => {
  const time = clock(t)
  let calls = 0
  const result = await analyseTypistEditWithDeadline(client(async () => { calls++; return success() }), input)
  assert.deepEqual(result, normalized)
  assert.equal(calls, 1)
  assert.equal(time.active.size, 0)
})

test("ordinary Retry-After inside the same overall budget succeeds", async t => {
  const time = clock(t)
  let calls = 0
  const promise = analyseTypistEditWithDeadline(client(async () => ++calls === 1
    ? busy({ "retry-after": "2" }) : success()), input)
  await flush(); await time.tick(1999); assert.equal(calls, 1)
  await time.tick(1)
  assert.deepEqual(await promise, normalized)
  assert.equal(calls, 2)
  assert.equal(time.active.size, 0)
})

test("default SDK-style backoff preserves two retries within the budget", async t => {
  const time = clock(t)
  t.mock.method(Math, "random", () => 0)
  let calls = 0
  const promise = analyseTypistEditWithDeadline(client(async () => ++calls < 3 ? busy({}) : success()), input)
  await flush(); await time.tick(500); assert.equal(calls, 2)
  await time.tick(1000); await promise
  assert.equal(calls, 3)
  assert.equal(time.active.size, 0)
})

const longRetryHeaders: Record<string, string>[] = [
  { "retry-after": "7200" }, { "retry-after-ms": "7200000" },
  { "retry-after": new Date(7200000).toUTCString() }, { "retry-after": "1e100" },
]
for (const headers of longRetryHeaders) {
  test(`long retry delay ${JSON.stringify(headers)} stops at 20 minutes with no background retry`, async t => {
    const time = clock(t)
    let calls = 0
    const promise = analyseTypistEditWithDeadline(client(async () => { calls++; return busy(headers) }), input)
    const rejected = assert.rejects(promise, LearningAnalysisDeadlineError)
    await flush(); await time.tick(TYPIST_ANALYSIS_BUDGET_MS - 1)
    assert.equal(calls, 1)
    await time.tick(1); await rejected
    assert.equal(time.active.size, 0)
    await time.tick(3 * 60 * 60 * 1000)
    assert.equal(calls, 1)
  })
}

test("deadline cancels an actual installed-SDK active fetch and waits for cancellation", async t => {
  const time = clock(t)
  let calls = 0
  let active = 0
  let cancelled = 0
  const sdk = client(async (_url, options) => {
    calls++
    if (calls === 1) return busy({ "retry-after": "1140" })
    active++
    return new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => {
        active--; cancelled++; reject(new DOMException("Synthetic abort", "AbortError"))
      }, { once: true })
    })
  })
  const promise = analyseTypistEditWithDeadline(sdk, input)
  const rejected = assert.rejects(promise, LearningAnalysisDeadlineError)
  await flush(); await time.tick(19 * 60 * 1000)
  assert.equal(active, 1)
  await time.tick(60 * 1000); await rejected
  assert.equal(cancelled, 1)
  assert.equal(active, 0)
  assert.equal(time.active.size, 0)
  await time.tick(3 * 60 * 60 * 1000)
  assert.equal(calls, 2)
})

test("deadline cancels response-body reading after headers have arrived", async t => {
  const time = clock(t)
  let activeBody = false
  let cancelled = false
  const sdk = client(async (_url, options) => {
    activeBody = true
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      options!.signal!.addEventListener("abort", () => {
        activeBody = false; cancelled = true
        controller.error(new DOMException("Synthetic body abort", "AbortError"))
      }, { once: true })
    } })
    return new Response(stream, { headers: { "content-type": "application/json" } })
  })
  const rejected = assert.rejects(analyseTypistEditWithDeadline(sdk, input), LearningAnalysisDeadlineError)
  await flush(); assert.equal(activeBody, true)
  await time.tick(TYPIST_ANALYSIS_BUDGET_MS); await rejected
  assert.equal(activeBody, false)
  assert.equal(cancelled, true)
  assert.equal(time.active.size, 0)
})

test("ordinary permanent failure clears the deadline and does not retry", async t => {
  const time = clock(t)
  let calls = 0
  await assert.rejects(analyseTypistEditWithDeadline(client(async () => {
    calls++; return Response.json({ error: { message: "Synthetic rejection" } }, { status: 401 })
  }), input), OpenAI.AuthenticationError)
  assert.equal(calls, 1)
  assert.equal(time.active.size, 0)
})

test("an overdue success cannot return analysis even if the timer was delayed", async t => {
  const time = clock(t)
  let release!: (response: Response) => void
  const promise = analyseTypistEditWithDeadline(client(() => new Promise(resolve => { release = resolve })), input)
  const rejected = assert.rejects(promise, LearningAnalysisDeadlineError)
  await flush()
  t.mock.timers.setTime(TYPIST_ANALYSIS_BUDGET_MS + 1)
  release(success()); await rejected
  assert.equal(time.active.size, 0)
})

test("each of three deadline failures uses sanitized retry completion and never applies behaviours", async t => {
  const time = clock(t)
  const events: unknown[] = []
  const completions: Record<string, unknown>[] = []
  const example: SavedLearningExample = { id: "synthetic-example", provider_id: "synthetic-provider",
    report_type: input.reportType, original_text: input.originalText, final_text: input.finalText,
    editor_role: "typist", source: input.source, claim_token: "synthetic-token", analysis_attempts: 1 }
  const db = createClient("http://synthetic.invalid", "synthetic-placeholder", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (_url, options) => {
      completions.push(JSON.parse(String(options!.body)))
      return Response.json(true)
    } },
  })
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now()
    const sdk = client(async () => busy())
    const job = processSavedLearningExample({ db, example: { ...example, analysis_attempts: attempt },
      analyse: value => analyseTypistEditWithDeadline(sdk, value), log: event => events.push(event) })
    await flush(); await time.tick(TYPIST_ANALYSIS_BUDGET_MS); await job
    assert.equal(completions.length, attempt)
    assert.equal(completions[attempt - 1].p_analysis, null)
    assert.equal(completions[attempt - 1].p_failure_code, "learning_execution_failed")
    assert.equal(completions[attempt - 1].p_retryable, true)
    assert.equal(Date.now() - started, TYPIST_ANALYSIS_BUDGET_MS)
    assert.ok(Date.now() - started < 45 * 60 * 1000)
    assert.equal(time.active.size, 0)
  }
  assert.ok(!JSON.stringify(events).includes("Synthetic sensitive"))
  assert.ok(!JSON.stringify(events).includes(input.originalText))
  await time.tick(3 * 60 * 60 * 1000)
  assert.equal(completions.length, 3)
  const sql = readFileSync("supabase/migrations/20261003000000_typist_edit_learning_queue.sql", "utf8")
  assert.match(sql, /p_retryable and e.analysis_attempts < 3/)
  assert.match(sql, /interval '1 minute' else interval '5 minutes'/)
})

test("claim lost on timeout is respected without retrying completion or applying behaviour", async t => {
  const time = clock(t)
  const events: { status: string }[] = []
  let finishes = 0
  const job = processSavedLearningExample({
    db: createClient("http://synthetic.invalid", "synthetic-placeholder", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => { finishes++; return Response.json(false) } },
    }),
    example: { id: "synthetic", provider_id: "synthetic", report_type: input.reportType,
      original_text: input.originalText, final_text: input.finalText, editor_role: "typist",
      source: input.source, claim_token: "stale", analysis_attempts: 1 },
    analyse: value => analyseTypistEditWithDeadline(client(async () => busy()), value),
    log: event => events.push(event),
  })
  await flush(); await time.tick(TYPIST_ANALYSIS_BUDGET_MS); await job
  assert.equal(finishes, 1)
  assert.equal(events[0].status, "claim_lost")
  assert.equal(time.active.size, 0)
})

test("before/after probe: native two-hour Retry-After ignores abort; corrected worker settles at 20 minutes", async t => {
  const time = clock(t)
  let nativeCalls = 0
  const native = client(async () => { nativeCalls++; return busy() })
  const controller = new AbortController()
  let nativeSettled = false
  const old = analyseApprovedEdit(native, input, { signal: controller.signal }).then(
    () => { nativeSettled = true }, error => {
      assert.ok(error instanceof OpenAI.APIUserAbortError)
      nativeSettled = true
    },
  )
  let correctedCalls = 0
  const corrected = analyseTypistEditWithDeadline(client(async () => { correctedCalls++; return busy() }), input)
  const rejected = assert.rejects(corrected, LearningAnalysisDeadlineError)
  await flush(); await time.tick(TYPIST_ANALYSIS_BUDGET_MS)
  controller.abort(); await rejected; await flush()
  assert.equal(nativeSettled, false)
  assert.equal(nativeCalls, 1)
  assert.equal(correctedCalls, 1)
  // Native SDK still owns its uncancellable two-hour retry timer.
  assert.equal(time.active.size, 1)
  await time.tick(2 * 60 * 60 * 1000 - TYPIST_ANALYSIS_BUDGET_MS); await old
  assert.equal(nativeSettled, true)
  assert.equal(nativeCalls, 1)
  assert.equal(correctedCalls, 1)
  assert.equal(time.active.size, 0)
})

test("synchronous Provider/Scribe analyser keeps original SDK retries and no worker signal", async t => {
  const time = clock(t)
  let calls = 0
  const sdk = client(async () => ++calls === 1 ? busy({ "retry-after": "2" }) : success())
  const spy = t.mock.method(sdk.chat.completions, "create")
  const result = analyseApprovedEdit(sdk, input)
  await flush(); await time.tick(2000); await result
  assert.equal(calls, 2)
  assert.equal(spy.mock.calls[0].arguments[1], undefined)
  assert.equal(time.active.size, 0)
  const runner = readFileSync("scripts/process-typist-edit-learning.ts", "utf8")
  assert.match(runner, /return analyseTypistEditWithDeadline\(openai, input\)/)
  const sync = readFileSync("lib/report-writing/edit-learning.ts", "utf8")
  assert.ok(!sync.includes("analyseTypistEditWithDeadline"))
})
