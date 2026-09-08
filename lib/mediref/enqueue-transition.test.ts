import assert from "node:assert/strict";
import { test } from "node:test";
import { enqueueMedirefTransition, requestMedirefEnqueue, EnqueueBusy } from "./enqueue-transition";
import type { MedirefHelperRequest } from "./helper-jobs";
import { runCompleteWorkflowIconStep } from "../report-writing/complete-workflow";

function fixture() {
  const request: MedirefHelperRequest = {
    action: "send_letter", draftId: "fixture", patient: { firstName: "Test", lastName: "Fixture", dob: "1990-06-09" },
    recipient: { name: "" }, attachments: [{ bucket: "report-assets", storagePath: "fixture.pdf", fileName: "fixture.pdf", contentType: "application/pdf" }],
  };
  let job: { id: string } | null = null;
  let claimed = false;
  const events: string[] = [];
  const actions = {
    active: async () => job,
    claim: async () => { if (claimed) return false; claimed = true; events.push("pending"); return true; },
    prepare: async (_signal: AbortSignal) => ({ request }),
    insert: async () => { events.push("insert"); job = { id: "job" }; return job; },
    running: async () => { assert.ok(job, "running requires a real job"); events.push("running"); },
    failed: async (_attempted: boolean) => { if (!job) events.push("failed"); },
  };
  return { request, actions, events };
}

test("successful insertion precedes running", async () => {
  const f = fixture();
  assert.equal((await enqueueMedirefTransition(f.actions)).job.id, "job");
  assert.deepEqual(f.events, ["pending", "insert", "running"]);
});
for (const failure of ["insert", "attachment", "patient", "dob", "staging"] as const) {
  test(`${failure} failure leaves failed, never running without a job`, async () => {
    const f = fixture();
    if (failure === "insert") f.actions.insert = async () => { throw new Error("database failure"); };
    if (failure === "attachment") f.request.attachments = [];
    if (failure === "patient") f.request.patient.lastName = "";
    if (failure === "dob") f.request.patient.dob = "1990-02-31";
    if (failure === "staging") f.actions.prepare = async () => { throw new Error("storage unavailable"); };
    await assert.rejects(enqueueMedirefTransition(f.actions), /preparation or queueing failed/);
    assert.deepEqual(f.events, ["pending", "failed"]);
  });
}
test("active job is reused without preparing or inserting", async () => {
  const f = fixture(); f.actions.active = async () => ({ id: "existing" });
  const result = await enqueueMedirefTransition(f.actions);
  assert.equal(result.job.id, "existing"); assert.equal(result.reused, true);
  assert.deepEqual(f.events, []);
});
test("concurrent calls require one atomic claim and insert only once", async () => {
  const f = fixture();
  const results = await Promise.allSettled([enqueueMedirefTransition(f.actions), enqueueMedirefTransition(f.actions)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(f.events.filter(e => e === "insert").length, 1);
  assert.equal(f.events.includes("failed"), false);
});
test("timed out preparation cannot insert when it eventually returns", async () => {
  const f = fixture(); let finish!: () => void;
  f.actions.prepare = () => new Promise(resolve => { finish = () => resolve({ request: f.request }); });
  await assert.rejects(enqueueMedirefTransition({ ...f.actions, deadlineMs: 5 }));
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.events, ["pending", "failed"]);
});
test("lost insert response is reconciled without failing an actual active job", async () => {
  const f = fixture(); const insert = f.actions.insert;
  f.actions.insert = async () => { await insert(); throw new Error("response lost"); };
  await assert.rejects(enqueueMedirefTransition(f.actions));
  assert.deepEqual(f.events, ["pending", "insert"]);
});
for (const skipped of [false, true]) {
  test(`icon ${skipped ? "skipped" : "completed"} proceeds into real MediRef enqueue`, async () => {
    const f = fixture();
    const request: typeof fetch = async (url, options) => {
      assert.ok(options?.signal);
      if (String(url).endsWith("send-via-mediref")) {
        const result = await enqueueMedirefTransition(f.actions);
        return Response.json({ success: true, jobId: result.job.id });
      }
      return Response.json({ success: true, skipped, iconUpdated: !skipped });
    };
    await runCompleteWorkflowIconStep("fixture", { queueId: null, praktikaPatientId: "fixture" }, request);
    await requestMedirefEnqueue("fixture", {}, request);
    assert.deepEqual(f.events, ["pending", "insert", "running"]);
  });
}
for (const network of [false, true]) {
  test(`${network ? "network" : "non-OK"} enqueue failure reconciles failed and stops continuation`, async () => {
    let failed = false; let continued = false;
    const request: typeof fetch = async (url, options) => {
      if (String(url).endsWith("workflow-status")) {
        failed = JSON.parse(String(options?.body)).failMedirefEnqueue;
        return Response.json({ success: true });
      }
      if (network) throw new Error("network");
      return Response.json({ success: false }, { status: 500 });
    };
    await assert.rejects(async () => { await requestMedirefEnqueue("fixture", {}, request); continued = true; });
    assert.equal(failed, true); assert.equal(continued, false);
  });
}
test("client reconciles a lost success response by reusing the active job", async () => {
  const request: typeof fetch = async url => {
    if (String(url).endsWith("workflow-status")) return Response.json({ success: true, jobId: "existing" });
    throw new Error("response lost");
  };
  assert.equal((await requestMedirefEnqueue("fixture", {}, request)).jobId, "existing");
});
test("busy response does not fail the other request's preparation", async () => {
  let calls = 0;
  const request: typeof fetch = async () => { calls++; return Response.json({ success: false }, { status: 409 }); };
  await assert.rejects(requestMedirefEnqueue("fixture", {}, request), EnqueueBusy);
  assert.equal(calls, 1);
});

test("claim returning after the deadline is failed without preparation or insertion", async () => {
  const f = fixture(); let finish!: (value: boolean) => void;
  f.actions.claim = () => new Promise(resolve => { finish = resolve; });
  await assert.rejects(enqueueMedirefTransition({ ...f.actions, deadlineMs: 5 }));
  finish(true); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(f.events, ["failed"]);
});
test("late insertion cannot run the normal success callback after timeout", async () => {
  const f = fixture(); let finish!: (value: { id: string }) => void; let attempted = false;
  f.actions.insert = () => new Promise(resolve => { finish = resolve; });
  f.actions.failed = async (value) => { attempted = value; };
  await assert.rejects(enqueueMedirefTransition({ ...f.actions, deadlineMs: 5 }));
  finish({ id: "late-job" }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(attempted, true); assert.deepEqual(f.events, ["pending"]);
});
