import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimWorkflowStart, performQueuedIconAction, runCompleteWorkflowIconStep } from "./complete-workflow";

test("icon running is saved only after a real job is queued, then completion is awaited", async () => {
  const events: string[] = [];
  await performQueuedIconAction({
    enqueue: async () => { events.push("queued"); return { id: "icon-job" }; },
    markRunning: async () => { events.push("running"); },
    wait: async (id) => { assert.equal(id, "icon-job"); events.push("completed"); },
  });
  assert.deepEqual(events, ["queued", "running", "completed"]);
});
test("failed icon insertion never marks running or starts waiting", async () => {
  await assert.rejects(performQueuedIconAction({
    enqueue: async () => { throw new Error("insertion failed"); },
    markRunning: async () => { assert.fail("must not mark running"); },
    wait: async () => { assert.fail("must not wait without a job"); },
  }));
});
for (const skipped of [false, true]) {
  test(`${skipped ? "missing target skips" : "completed icon finishes"} and MediRef can continue`, async () => {
    const updates: Record<string, unknown>[] = []; let medirefQueued = false;
    const request: typeof fetch = async (url, options) => {
      assert.ok(options?.signal instanceof AbortSignal);
      if (String(url).endsWith("workflow-status")) {
        updates.push(JSON.parse(String(options?.body)));
        return Response.json({ success: true });
      }
      return Response.json({ success: true, skipped, iconUpdated: !skipped });
    };
    await runCompleteWorkflowIconStep("draft", { queueId: null, praktikaPatientId: "fixture-id" }, request);
    medirefQueued = true;
    assert.equal(medirefQueued, true);
    assert.equal(updates[0].praktikaUploadStatus, undefined);
    assert.equal(updates[0].iconUpdateStatus, undefined);
    assert.equal(updates[1].iconUpdateStatus, skipped ? "skipped" : "completed");
    assert.ok(updates.every((update) => update.iconUpdateStatus !== "running"));
    assert.ok(updates.every((update) => !("uploaded_to_praktika" in update)));
  });
}
for (const timeout of [false, true]) {
  test(`icon ${timeout ? "timeout/missing job" : "creation failure"} records failed and stops before MediRef`, async () => {
    const updates: Record<string, unknown>[] = []; let continued = false;
    const request: typeof fetch = async (url, options) => {
      if (String(url).endsWith("workflow-status")) {
        updates.push(JSON.parse(String(options?.body)));
        return Response.json({ success: true });
      }
      if (timeout) throw new DOMException("Timeout", "TimeoutError");
      return Response.json({ success: false, error: "fixture error" }, { status: 502 });
    };
    await assert.rejects(async () => {
      await runCompleteWorkflowIconStep("draft", { queueId: null, praktikaPatientId: "fixture-id" }, request);
      continued = true;
    });
    assert.equal(continued, false);
    assert.equal(updates.at(-1)?.iconUpdateStatus, "failed");
    assert.equal(updates.at(-1)?.workflowStatus, "failed");
  });
}
test("atomic workflow start rejects concurrent starts before a second upload", async () => {
  let running = false; let uploads = 0;
  const filters: unknown[][] = [];
  const query = {
    update: () => query,
    eq: (...args: unknown[]) => { filters.push(args); return query; },
    is: (...args: unknown[]) => { filters.push(args); return query; },
    in: (...args: unknown[]) => { filters.push(args); return query; },
    or: (value: string) => { assert.ok(["workflow_status.is.null,workflow_status.neq.running", "workflow_praktika_upload_status.is.null,workflow_praktika_upload_status.neq.running"].includes(value)); return query; },
    select: () => query,
    maybeSingle: async () => {
      if (running) return { data: null, error: null };
      running = true;
      return { data: { id: "draft", workflow_status: "running" }, error: null };
    },
  };
  const db = { from: (table: string) => { assert.equal(table, "report_drafts"); return query; } } as unknown as SupabaseClient;
  async function start() {
    const { data } = await claimWorkflowStart(db, "draft", { workflow_status: "running" });
    if (!data) return "rejected";
    uploads++;
    return "started";
  }
  assert.deepEqual(await Promise.all([start(), start()]), ["started", "rejected"]);
  assert.equal(uploads, 1);
  assert.ok(filters.some((filter) => filter[0] === "deleted_at" && filter[1] === null));
  assert.ok(filters.some((filter) => filter[0] === "status"));
});

test("stale creation is bounded and cannot mark running when a late insert returns", async () => {
  let resolveJob!: (job: { id: string }) => void;
  let running = false;
  await assert.rejects(performQueuedIconAction({
    deadlineMs: 5,
    enqueue: () => new Promise((resolve) => { resolveJob = resolve; }),
    markRunning: async () => { running = true; },
    wait: async () => { assert.fail("must not wait on a timed-out action"); },
  }), /allowed time/);
  resolveJob({ id: "late-job" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(running, false);
});
test("a queued icon with an unresponsive status check also has a bounded wait", async () => {
  await assert.rejects(performQueuedIconAction({
    deadlineMs: 5,
    enqueue: async () => ({ id: "job" }),
    markRunning: async () => {},
    wait: () => new Promise(() => {}),
  }), /allowed time/);
});
