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
    attachmentExists: async () => true,
    claim: async (_draft, update) => { if (claimed) return false; claimed = true; updates.push(update); return true; },
    enqueue: async (request) => { requests.push(request); return { id: "new-job" }; },
  };
  return { store, requests, updates };
}
test("failed draft queues a new trusted MediRef request and preserves other workflow fields", async () => {
  const f = fixture();
  assert.equal((await queueRetry(f.store, id, "report-assets")).jobId, "new-job");
  assert.deepEqual(f.requests, [{ action: "send_letter", draftId: id, patient: { firstName: "Test", lastName: "Patient", dob: "1990-06-09" }, recipient: { name: "", practiceName: "", email: "", providerNumber: "" }, medirefAutoMatchRecipient: false, attachments: [attachment], message: "Existing message" }]);
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
