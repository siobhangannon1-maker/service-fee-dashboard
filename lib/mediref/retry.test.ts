import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRetryRequest, queueRetry, prepareRetry, retryWarning, type RetryDraft, type RetryStore } from "./retry";
const id = "00000000-0000-0000-0000-000000000001";
const draft: RetryDraft = { id, status: "approved", deleted_at: null, updated_at: "2026-09-01", patient_name: "Test Patient", patient_dob: "1990-06-09", workflow_status: "failed", workflow_mediref_status: "failed", emailed_to_referrer_at: null };
const attachment = { bucket: "report-assets", storagePath: `mediref-uploads/${id}/test.pdf`, fileName: "test.pdf", contentType: "application/pdf" };
const job = { status: "failed", payload: { action: "send_letter", draftId: id, patient: { firstName: "Untrusted old name" }, recipient: { email: "old@example.invalid" }, medirefAutoMatchRecipient: true, attachments: [attachment], message: "Existing message" } };
function fixture() {
  let claimed = false;
  const requests: unknown[] = [];
  const updates: Record<string, unknown>[] = [];
  const store: RetryStore = {
    draft: async () => ({ ...draft }), active: async () => false, latest: async () => job,
    attachmentExists: async () => true, markQueued: async () => {},
    claim: async (_draft, update) => { if (claimed) return false; claimed = true; updates.push(update); return true; },
    enqueue: async (request) => { requests.push(request); return { id: "new-job" }; },
  };
  return { store, requests, updates };
}
test("failed draft queues a new trusted MediRef request and preserves other workflow fields", async () => {
  const f = fixture();
  assert.equal((await queueRetry(f.store, id, "report-assets")).jobId, "new-job");
  assert.deepEqual(f.requests, [{ action: "send_letter", draftId: id, retryMediref: true, patient: { firstName: "Test", lastName: "Patient", dob: "1990-06-09" }, recipient: { name: "", practiceName: "", email: "", providerNumber: "" }, medirefAutoMatchRecipient: false, attachments: [attachment], message: "Existing message" }]);
  assert.deepEqual(Object.keys(f.updates[0]).sort(), ["workflow_status", "workflow_mediref_status", "workflow_started_at", "workflow_completed_at", "workflow_error", "workflow_last_message", "updated_at"].sort());
});
for (const patch of [{ workflow_mediref_status: "completed" }, { workflow_status: "running" }, { deleted_at: "today" }, { status: "draft" }, { patient_name: "" }, { patient_dob: "" }]) {
  test(`rejects ineligible or incomplete draft: ${Object.keys(patch)[0]}`, () => {
    assert.throws(() => buildRetryRequest({ ...draft, ...patch }, job, "report-assets"));
  });
}
test("active job prevents retry without changing draft", async () => {
  const f = fixture(); f.store.active = async () => true;
  await assert.rejects(queueRetry(f.store, id, "report-assets"), /already queued/);
  assert.equal(f.requests.length + f.updates.length, 0);
});
test("missing storage object prevents retry", async () => {
  const f = fixture(); f.store.attachmentExists = async () => false;
  await assert.rejects(queueRetry(f.store, id, "report-assets"), /no stored PDF/);
  assert.equal(f.updates.length, 0);
});
test("missing metadata, foreign paths, latest success and wrong draft are rejected", () => {
  for (const candidate of [
    { ...job, status: "completed" },
    { ...job, payload: { ...job.payload, attachments: [] } },
    { ...job, payload: { ...job.payload, draftId: "another" } },
    { ...job, payload: { ...job.payload, attachments: [{ ...attachment, storagePath: "other/file.pdf" }] } },
  ]) assert.throws(() => buildRetryRequest(draft, candidate, "report-assets"));
});
test("concurrent retries create only one job", async () => {
  const f = fixture();
  const results = await Promise.allSettled([queueRetry(f.store, id, "report-assets"), queueRetry(f.store, id, "report-assets")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.requests.length, 1);
});
test("database claim failure never enqueues", async () => {
  const f = fixture(); f.store.claim = async () => { throw new Error("database unavailable"); };
  await assert.rejects(queueRetry(f.store, id, "report-assets"));
  assert.equal(f.requests.length, 0);
});
test("ambiguous enqueue failure remains blocked on subsequent clicks", async () => {
  const f = fixture(); f.store.enqueue = async () => { throw new Error("network"); };
  await assert.rejects(queueRetry(f.store, id, "report-assets"), /further retries are blocked/);
  await assert.rejects(queueRetry(f.store, id, "report-assets"), /already queued/);
});
test("historical attempts require warning even for DOB errors without sequence provenance", async () => {
  const f = fixture();
  await prepareRetry(f.store, id, "report-assets");
  assert.match(retryWarning, /may already have attached/);
  assert.match(retryWarning, /will not re-upload.*Praktika/);
  assert.equal(f.updates.length, 0);
});

const chart = { ...attachment, fileName: "chart.pdf", storagePath: `mediref-uploads/${id}/chart.pdf` };
function periodontalFixture() {
  const f = fixture();
  f.store.draft = async () => ({ ...draft, periodontal_chart_attachment_name: chart.fileName, periodontal_chart_attached_at: "previous-confirmation" });
  f.store.latest = async () => ({ ...job, payload: { ...job.payload, attachments: [attachment, chart] } });
  return f;
}
test("periodontal retry reuses both validated stored PDFs without generation or status reset", async () => {
  const f = periodontalFixture(); const checked: unknown[] = [];
  f.store.attachmentExists = async a => { checked.push(a); return true; };
  await queueRetry(f.store, id, "report-assets");
  assert.deepEqual(checked, [attachment, chart]);
  assert.deepEqual((f.requests[0] as { attachments: unknown[] }).attachments, checked);
  assert.ok(Object.keys(f.updates[0]).every(key => !key.includes("periodontal") && !key.includes("praktika") && !key.includes("icon")));
});
for (const field of ["periodontal_chart_attachment_name", "periodontal_chart_attachment_error", "periodontal_chart_attached_at", "workflow_periodontal_chart_status"]) {
  test(`missing required chart fails before claim: ${field}`, async () => {
    const f = fixture(); f.store.draft = async () => ({ ...draft, [field]: field === "workflow_periodontal_chart_status" ? "pending" : "recorded" });
    await assert.rejects(queueRetry(f.store, id, "report-assets"), /required periodontal chart/);
    assert.equal(f.requests.length + f.updates.length, 0);
  });
}
for (const missing of [attachment.storagePath, chart.storagePath]) test("missing package file fails without partial retry: " + (missing === chart.storagePath ? "chart" : "report"), async () => {
  const f = periodontalFixture(); f.store.attachmentExists = async a => a.storagePath !== missing;
  await assert.rejects(queueRetry(f.store, id, "report-assets"), /no stored PDF/);
  assert.equal(f.requests.length + f.updates.length, 0);
});
test("chart alone and duplicate attachments cannot masquerade as complete package", () => {
  for (const attachments of [[chart], [chart, chart]]) assert.throws(() => buildRetryRequest({ ...draft, periodontal_chart_attachment_name: chart.fileName }, { ...job, payload: { ...job.payload, attachments } }, "report-assets"));
});
test("running is recorded only after a real helper insertion", async () => {
  const f = fixture(); const events: string[] = [];
  f.store.enqueue = async () => { events.push("insert"); return { id: "new" }; };
  f.store.markQueued = async () => { events.push("running"); };
  await queueRetry(f.store, id, "report-assets"); assert.deepEqual(events, ["insert", "running"]);
  const failed = fixture(); failed.store.enqueue = async () => { throw new Error("insert failed"); };
  failed.store.markQueued = async () => { assert.fail("cannot mark running without a job"); };
  await assert.rejects(queueRetry(failed.store, id, "report-assets"));
});
test("retry-created two-file payload goes through the shared remote worker exclusively", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const ts = await import("typescript");
  const f = periodontalFixture(); await queueRetry(f.store, id, "report-assets");
  const source = await readFile(new URL("../../scripts/refresh-mediref-session.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function sendMedirefLetterWithBrowser("), source.indexOf("async function processOnePendingMedirefJob("));
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const paths = ["report.pdf", "chart.pdf"]; let calls = 0;
  const run = runInNewContext(`${compiled}\nsendMedirefLetterWithBrowser`, {
    USE_REMOTE_DRAFT_API: true,
    openComposePage: async () => {},
    prepareRemoteDraftWithBrowser: async (_page: unknown, patient: unknown, files: string[]) => {
      calls++; assert.deepEqual(patient, { firstName: "Test", lastName: "Patient", dob: "1990-06-09" });
      assert.deepEqual(files, paths); return { prepared: true, remoteDraftSaved: true, attachmentCount: 2 };
    },
  });
  assert.equal((await run({}, { payload: f.requests[0] }, paths)).attachmentCount, 2);
  assert.equal(calls, 1); // DOM and other integration helpers are intentionally absent.
  const route = await readFile(new URL("../../app/api/report-writing/retry-mediref/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /generatePeriodontal|praktikaHelper|deleteDraft|setInputFiles|enterPatientDob/);
  assert.match(route, /eq\("workflow_mediref_status", "pending"\)/);
});
test("worker records retry completion/failure without changing Praktika or ordinary periodontal state", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const ts = await import("typescript");
  const source = await readFile(new URL("../../scripts/refresh-mediref-session.ts", import.meta.url), "utf8");
  for (const success of [true, false]) {
    const name = success ? "updateDraftAfterMedirefSuccess" : "updateDraftAfterMedirefFailure";
    const start = source.indexOf(`async function ${name}(`);
    const end = source.indexOf("\nasync function ", start + 1);
    const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const updates: Record<string, unknown>[] = [];
    const db = { from: () => ({ update: (values: Record<string, unknown>) => { updates.push(values); return { eq: async () => ({ error: null }) }; } }) };
    const run = runInNewContext(`${compiled}\n${name}`, { supabase: db, nowIso: () => "now", console: { warn() {} } });
    await run({ id: "job", payload: { draftId: id, attachments: [attachment] } }, success ? { prepared: true } : "Safe failure");
    assert.equal(updates[0].workflow_mediref_status, success ? "completed" : "failed");
    assert.ok(Object.keys(updates[0]).every(k => !k.includes("praktika") && !k.includes("icon") && !k.includes("periodontal")));
  }
});
test("retry logs expose counts and booleans only", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const ts = await import("typescript");
  const source = await readFile(new URL("./retry.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const logs: unknown[] = []; const exports: Record<string, Function> = {};
  runInNewContext(compiled, { exports, console: { log: (...args: unknown[]) => logs.push(args) } });
  await exports.queueRetry(periodontalFixture().store, id, "report-assets");
  assert.deepEqual(JSON.parse(JSON.stringify(logs)), [
    ["[MediRef retry] attachment_set_resolved", { attachmentCount: 2, includesPeriodontalChart: true }],
    ["[MediRef retry] job_payload_ready", { attachmentCount: 2, includesPeriodontalChart: true }],
    ["[MediRef retry] helper_job_created", { jobId: "new-job", attachmentCount: 2 }],
  ]);
});

test('independent MediRef success never completes or overwrites the other workflow branch', async () => {
  const { readFile } = await import('node:fs/promises'); const {runInNewContext}=await import('node:vm'); const ts=await import('typescript');
  const source=await readFile('scripts/refresh-mediref-session.ts','utf8'); const start=source.indexOf('async function updateDraftAfterMedirefSuccess(');
  const code=ts.transpileModule(source.slice(start,source.indexOf('\nasync function ',start+1)),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const patches:any[]=[]; const supabase={from:()=>({update:(p:any)=>{patches.push(p);return{eq:async()=>({error:null})};}})};
  await runInNewContext(code+'\nupdateDraftAfterMedirefSuccess',{supabase,nowIso:()=> 'now',console:{warn(){}}})({id:'job',payload:{draftId:'draft',workflowContinuationId:'intent'}},{});
  assert.equal(patches[0].workflow_mediref_status,'completed');assert.equal(patches[0].workflow_status,undefined);assert.equal(patches[0].workflow_completed_at,undefined);
});
