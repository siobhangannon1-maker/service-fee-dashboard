import { continuationIntentId, workflowAuthorization } from "./workflow-continuation-token";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUserPraktikaReady, praktikaConnectionRequired, canQueueUserPraktikaWorkflow } from "./praktika-readiness";
import { isConfirmedPraktikaUpload } from "./praktika-upload-result";
import { claimWorkflowStart } from "./complete-workflow";
import { PraktikaAuthenticationUnverified } from "../praktika/authentication-probe";
import { PraktikaOwnershipLost } from "../praktika/helper-lease";

type Row = Record<string, any>;
function extract(path: string, name: string) {
  const source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)!;
  assert.ok(fn, name);
  return ts.transpileModule(fn.getText(ast).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function database(tables: Record<string, Row[]>, events: string[], lookupError?: unknown, throws = false) {
  return { from(table: string) {
    let patch: Row | undefined, filters: ((r: Row) => boolean)[] = [], limit = Infinity;
    const field = (r: Row, key: string) => key.includes("->>") ? r[key.split("->>")[0]]?.[key.split("->>")[1]] : r[key];
    const query: any = {
      select: () => query, abortSignal: () => query,
      update: (value: Row) => { patch = value; return query; },
      eq: (k: string, v: unknown) => { filters.push(r => field(r, k) === v); return query; },
      is: (k: string, v: unknown) => { filters.push(r => (field(r, k) ?? null) === v); return query; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(field(r, k))); return query; },
      limit: (n: number) => { limit = n; return query; },
      or: (expression: string) => {
        const clauses = expression.split(/,(?![^()]*\))/);
        filters.push(r => clauses.some(c => {
          const [key, op, ...rest] = c.split("."); const value = rest.join(".");
          if (op === "is") return field(r, key) == null;
          if (op === "neq") return field(r, key) != null && field(r, key) !== value;
          if (op === "in") return value.slice(1, -1).split(",").includes(field(r, key));
          throw new Error(`Unsupported test filter ${op}`);
        })); return query;
      },
      execute(single: boolean) {
        if (table === "praktika_helper_jobs" && lookupError) {
          if (throws) throw lookupError;
          return { data: null, error: lookupError };
        }
        const rows = (tables[table] || []).filter(r => filters.every(f => f(r))).slice(0, limit);
        if (patch) { events.push(`update:${table}`); rows.forEach(r => Object.assign(r, patch)); }
        return { data: single ? rows[0] ?? null : rows, error: null };
      },
      maybeSingle: async () => query.execute(true), single: async () => query.execute(true),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(query.execute(false)).then(resolve),
    }; return query;
  }} as unknown as SupabaseClient;
}
function fixture(status = "connected", lookupError?: unknown, throws = false) {
  const events: string[] = [];
  const tables: Record<string, Row[]> = {
    praktika_sessions: [{ scope: "user", app_user_id: "current-user", status,
      helper_instance_id: "generation", helper_heartbeat_at: new Date().toISOString(),
      authenticated_at: status === "connected" ? new Date().toISOString() : null }],
    report_drafts: [{ id: "synthetic-draft", status: "approved", uploaded_to_praktika: false,
      edited_text: "Synthetic approved text", provider_approved_at: "unchanged", deleted_at: null,
      workflow_status: "idle", workflow_praktika_upload_status: "pending", workflow_icon_update_status: "pending" }],
    report_letter_queue: [{ report_draft_id: "synthetic-draft", status: "started" }], praktika_helper_jobs: [],
  };
  const db = database(tables, events, lookupError, throws);
  const mocks: Row = {
    currentWorkflowExecution: () => undefined, canQueueUserPraktikaWorkflow, continuationIntentId, workflowAuthorization, process: { env: { SUPABASE_SERVICE_ROLE_KEY: "synthetic" } }, workflowConfigurationIssue: () => null,
    supabase: db, isUserPraktikaReady, praktikaConnectionRequired, isConfirmedPraktikaUpload,
    claimWorkflowStart, AbortSignal, Date, URL, Buffer, console: { log() {}, error() {}, warn() {} },
    NextResponse: { json: (data: unknown, options?: { status: number }) => Response.json(data, options) },
    getAuditActor: async () => ({ actorUserId: "current-user", actorInitials: "T" }), getUserStatus: async () => true,
    getCurrentUserPraktikaSessionMode: async () => ({ scope: "user", appUserId: "current-user" }),
    clean: (v: unknown) => String(v ?? "").trim(), validOrNull: (v: unknown) => v,
    ALLOWED_WORKFLOW_STATUSES: new Set(), ALLOWED_STEP_STATUSES: new Set(),
    fetch: async () => { events.push("pdf"); return new Response(Buffer.alloc(1024)); },
    ensureUploadBucketExists: async () => {}, verifyStagedUploadExists: async () => {},
    getReportPdfFileName: () => "synthetic.pdf", getPdfFileNameFromResponse: () => "synthetic.pdf",
    HELPER_UPLOAD_BUCKET: "synthetic", PRAKTIKA_BASE_URL: "https://fixture.invalid", PRAKTIKA_PRACTICE_ID: "1",
    appUserIdFromMode: () => "current-user", formatPraktikaDateTime: () => "synthetic",
    createReportAuditEvent: async () => {},
    createPraktikaHelperJob: async (input: Row) => {
      events.push("upload-job"); const job = { id: "synthetic-job", job_type: input.jobType, request: input.request, status: "pending", app_user_id: input.appUserId };
      tables.praktika_helper_jobs.push(job); return job;
    },
  };
  (db as any).storage = { from: () => ({ upload: async () => { events.push("stage"); return { error: null }; },
    remove: async () => { events.push("remove-stage"); return { error: null }; } }) };
  const route = (path: string) => runInNewContext(extract(path, "POST") + "\nPOST", mocks);
  return { events, tables, db, mocks, route };
}
const uploadPath = "app/api/report-writing/upload-to-praktika/route.ts";
const startPath = "app/api/report-writing/workflow-status/route.ts";
const request = (extra: Row = {}) => new Request("https://fixture.invalid/api", { method: "POST", body: JSON.stringify({ draftId: "synthetic-draft", praktikaPatientId: "synthetic-patient", ...extra }) });

for (const state of ["waiting_for_credentials", "waiting_for_mfa", "error", "stale", "missing-proof", "login-url", "other-user"]) {
  test(`preflight ${state}: no workflow mutation, PDF, upload, icon or MediRef; approved letter retained`, async () => {
    const f = fixture(["stale", "missing-proof", "login-url", "other-user"].includes(state) ? "connected" : state);
    const row = f.tables.praktika_sessions[0];
    if (state === "stale") row.helper_heartbeat_at = new Date(Date.now() - 90000).toISOString();
    if (state === "missing-proof") row.authenticated_at = null;
    if (state === "login-url") row.current_url = "https://praktika.praktika.net.au/v2/login";
    if (state === "other-user") row.app_user_id = "another-user";
    const before = JSON.stringify(f.tables);
    for (const [path, body] of [[startPath, { startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending" }], [uploadPath, {}]] as const) {
      const response = await f.route(path)(request(body));
      assert.equal(response.status, 409); assert.equal((await response.json()).reconnectRequired, true);
    }
    assert.deepEqual(f.events, []); assert.equal(JSON.stringify(f.tables), before);
  });
}
for (const outcome of ["pending", "timeout", "failed", "auth-lost", "invalid", "completed"]) {
  test(`upload ${outcome}: only confirmed completion marks uploaded; attempts never duplicate`, async () => {
    const f = fixture(); const draft = f.tables.report_drafts[0];
    f.mocks.waitForPraktikaHelperJob = async (id: string) => {
      assert.equal(id, "synthetic-job"); assert.equal(draft.uploaded_to_praktika, false);
      if (["timeout", "failed", "auth-lost"].includes(outcome)) throw new Error(outcome);
      return { status: outcome === "pending" ? "pending" : "completed", response: outcome === "invalid" ? { error: "synthetic" } : { patient_communication: { iFileId: 123 } } };
    };
    const response = await f.route(uploadPath)(request()); const result = await response.json();
    assert.equal(result.success, outcome === "completed");
    assert.equal(draft.uploaded_to_praktika, outcome === "completed");
    assert.equal(draft.workflow_praktika_upload_status === "completed", outcome === "completed");
    assert.notEqual(draft.workflow_status, "completed");
    assert.equal(draft.edited_text, "Synthetic approved text"); assert.equal(draft.provider_approved_at, "unchanged");
    assert.equal(f.tables.report_letter_queue[0].status, "started");
    assert.equal((await f.route(uploadPath)(request())).status, 409);
    assert.equal((await f.route(startPath)(request({ startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending" }))).status, 409);
    assert.equal(f.events.filter(e => e === "upload-job").length, 1);
  });
}
test("concurrent direct uploads reserve the draft once", async () => {
  const f = fixture(); f.mocks.waitForPraktikaHelperJob = async () => { throw new Error("pending"); };
  await Promise.all([f.route(uploadPath)(request()), f.route(uploadPath)(request())]);
  assert.equal(f.events.filter(e => e === "upload-job").length, 1);
});
test("ambiguous job insertion preserves reservation and staged PDF", async () => {
  const f = fixture(); f.mocks.createPraktikaHelperJob = async () => { throw new Error("insert acknowledgement lost"); };
  await f.route(uploadPath)(request());
  assert.equal(f.tables.report_drafts[0].workflow_praktika_upload_status, "running");
  assert.ok(!f.events.includes("remove-stage"));
  assert.equal((await f.route(uploadPath)(request())).status, 409);
});
test("upload result contract rejects empty, error and non-positive IDs", () => {
  for (const response of [null, [], {}, { ok: true, empty: true }, { success: true }, { patient_communication: { iFileId: 0 } }, { patient_communication: { iFileId: -1 } }, { error: "failed", patient_communication: { iFileId: 123 } }]) assert.equal(isConfirmedPraktikaUpload(response), false);
  for (const id of [123, "123"]) assert.equal(isConfirmedPraktikaUpload({ patient_communication: { iFileId: id } }), true);
});
test("worker never replays a report upload after an ambiguous external write", async () => {
  const failures: boolean[] = []; let operations = 0;
  const process = runInNewContext(extract("scripts/praktika-helper-job-processor.ts", "processOnePraktikaHelperJob") + "\nprocessOnePraktikaHelperJob", {
    verifiedReadOperation: () => false, allowedPraktikaRead: () => false, jobEligible: async () => true,
    PraktikaOwnershipLost, PraktikaAuthenticationUnverified, isConfirmedPraktikaUpload,
    console: { log() {}, error() {} }, claimNextJob: async () => ({ id: "synthetic", job_type: "upload_report_to_praktika", request: {} }),
    runPraktikaRequest: async (_c: unknown, _r: unknown, before: () => Promise<void>) => { await before(); operations++; throw new Error("response lost"); },
    failJob: async (_job: unknown, _message: unknown, permanent: boolean) => { failures.push(permanent); },
    completeJob: async () => assert.fail("must not complete"),
  });
  const result = await process({}, "user", { assertOwned: async () => {}, ensureAuthenticated: async () => {} });
  assert.equal(result.outcome, "failed"); assert.equal(operations, 1); assert.deepEqual(failures, [true]);
});
test("approval does not complete the linked queue", async () => {
  const f = fixture();
  const update = runInNewContext(extract("app/api/report-writing/update-draft/route.ts", "updateLinkedQueueRows") + "\nupdateLinkedQueueRows", { supabase: f.db, Date, console });
  await update({ draftId: "synthetic-draft", status: "approved" });
  assert.equal(f.tables.report_letter_queue[0].status, "started");
});
test("icon route refuses a pending/unconfirmed upload before any icon job", async () => {
  const f = fixture();
  const response = await f.route("app/api/report-writing/update-praktika-letter-icons/route.ts")(request());
  assert.equal(response.status, 409); assert.deepEqual(f.events, []);
});

for (const outcome of ["pending", "failed", "completed"]) {
  test(`icon ${outcome}: route waits for its job and completes queue only on success`, async () => {
    const f = fixture(); const draft = f.tables.report_drafts[0];
    Object.assign(draft, { uploaded_to_praktika: true, workflow_praktika_upload_status: "completed", workflow_status: "running" });
    f.tables.praktika_helper_jobs.push({ job_type: "upload_report_to_praktika", app_user_id: "current-user",
      request: { reportDraftId: "synthetic-draft" }, status: "completed", response: { patient_communication: { iFileId: 123 } } });
    Object.assign(f.tables.report_letter_queue[0], { id: "queue", appointment_id: "123", raw_json: {} });
    Object.assign(f.mocks, {
      process: { env: { PRAKTIKA_PRACTICE_ID: "1" } },
      findQueueItem: async () => f.tables.report_letter_queue[0], asObject: (v: unknown) => v,
      getIconIdsFromRaw: () => [7360, 0, 0, 0], replaceLetterWorkflowIcons: () => ({ changed: true, oldIconIds: [7360,0,0,0], updatedIconIds: [6597,0,0,0], replacedIconIds: [7360] }),
      TYPIST_LETTER_ICON_ID: 7360, PENDING_LETTER_ICON_IDS: [7360], LETTER_SENT_ICON_ID: 6597,
      saveIconStatus: async (_id: string, state: string) => { draft.workflow_icon_update_status = state; },
      updatePraktikaAppointmentIcons: async () => {
        f.events.push("icon-job"); assert.equal(f.tables.report_letter_queue[0].status, "started");
        if (outcome !== "completed") throw new Error(outcome);
        return { appointment_icon1id: 6597 };
      }, deleteIndexedAppointment: async () => {}, markDraftIconUpdated: async () => {}, logIconAttempt: async () => {},
    });
    const response = await f.route("app/api/report-writing/update-praktika-letter-icons/route.ts")(request());
    assert.equal((await response.json()).success, outcome === "completed");
    assert.equal(f.tables.report_letter_queue[0].status, outcome === "completed" ? "completed" : "started");
    assert.equal(draft.workflow_icon_update_status, outcome === "completed" ? "completed" : "failed");
    assert.equal(draft.uploaded_to_praktika, true); // A later icon failure does not undo a real upload.
    assert.equal(draft.edited_text, "Synthetic approved text");
    assert.equal((await f.route("app/api/report-writing/update-praktika-letter-icons/route.ts")(request())).status, 409);
    assert.equal(f.events.filter(e => e === "icon-job").length, 1);
  });
}

test("client upload failure exits before either icon processing or MediRef enqueue", () => {
  const source = readFileSync("app/(protected)/report-writing/typist/TypistPage.tsx", "utf8");
  const start = source.indexOf("async function runMedirefWorkflowInBackground");
  const handler = source.slice(start);
  const guard = handler.indexOf("if (!uploadResponse.ok || !uploadData.success)");
  const failure = handler.indexOf("throw new Error(", guard);
  const icon = handler.indexOf("await runCompleteWorkflowIconStep(");
  const mediref = handler.indexOf("await requestMedirefEnqueue(");
  assert.ok(guard > 0 && failure > guard && icon > failure && mediref > icon);
});

test("fresh current-user proof permits one workflow start; another user's proof never substitutes", async () => {
  const f = fixture();
  const body = { startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending", iconUpdateStatus: "pending" };
  const responses = await Promise.all([f.route(startPath)(request(body)), f.route(startPath)(request(body))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.tables.report_drafts[0].workflow_status, "running");
  assert.equal(f.tables.report_drafts[0].uploaded_to_praktika, false);
  assert.ok(!f.events.includes("pdf"));
});

for (const path of [startPath, uploadPath]) {
  for (const [name, error, expected] of [
    ["timeout", { name: "TimeoutError", message: "PRIVATE" }, "lookup_timeout"],
    ["database", { code: "42501", message: "PRIVATE" }, "lookup_failed"],
    ["unclassified rejection", {}, "lookup_failed"],
    ["ambiguous abort", { name: "AbortError", message: "PRIVATE" }, "lookup_failed"],
  ] as const) for (const throws of [false, true]) {
    test(`${path}: ${name} ${throws ? "thrown" : "returned"} fails closed before all work`, async () => {
      const f = fixture("connected", error, throws);
      const draft = f.tables.report_drafts[0];
      Object.assign(draft, { workflow_status: null, workflow_praktika_upload_status: null });
      const before = JSON.stringify(f.tables); const logs: unknown[] = [];
      f.mocks.console = { warn: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) };
      const response = await f.route(path)(request({ startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending" }));
      assert.equal(response.status, 503);
      const body = await response.json(); assert.equal(body.code, expected); assert.equal(body.stage, "upload_attempt_lookup");
      assert.match(body.error, /could not be verified/); assert.doesNotMatch(body.error, /already has|already exists/);
      assert.equal(JSON.stringify(f.tables), before); assert.deepEqual(f.events, []);
      assert.equal(JSON.stringify(logs), JSON.stringify([["praktika_upload_attempt", { stage: "upload_attempt_lookup", reason: expected }]]));
      assert.doesNotMatch(JSON.stringify({ body, logs }), /PRIVATE/);
    });
  }
  for (const status of ["pending", "processing", "completed", "failed"]) {
    test(`${path}: existing ${status} attempt retains duplicate protection`, async () => {
      const f = fixture();
      f.tables.praktika_helper_jobs.push({ id: "prior", job_type: "upload_report_to_praktika", request: { reportDraftId: "synthetic-draft" }, status });
      const before = JSON.stringify(f.tables);
      const response = await f.route(path)(request({ startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending" }));
      assert.equal(response.status, 409); assert.equal((await response.json()).code, "existing_attempt");
      assert.equal(JSON.stringify(f.tables), before); assert.deepEqual(f.events, []);
    });
  }
}
test("fresh approved draft with null workflow fields starts and confirms exactly one upload", async () => {
  const f = fixture(); const draft = f.tables.report_drafts[0];
  Object.assign(draft, { workflow_status: null, workflow_praktika_upload_status: null, workflow_icon_update_status: null, workflow_mediref_status: null });
  const response = await f.route(startPath)(request({ startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending" }));
  assert.equal(response.status, 200); assert.equal(draft.workflow_status, "running");
  f.mocks.waitForPraktikaHelperJob = async () => ({ status: "completed", response: { patient_communication: { iFileId: 123 } } });
  assert.equal((await f.route(uploadPath)(request())).status, 200);
  assert.equal(draft.uploaded_to_praktika, true); assert.equal(draft.workflow_praktika_upload_status, "completed");
  assert.equal(f.events.filter(e => e === "upload-job").length, 1);
});

for (const fresh of [true, false]) test(`durable start with ${fresh ? "fresh" : "stale"} proof reserves only intent, without PDF/write`, async () => {
  const f = fixture();
  if (!fresh) f.tables.praktika_sessions[0].authenticated_at = null;
  let calls = 0;
  (f.db as any).rpc = (name: string, args: Row) => ({ abortSignal: async () => {
    assert.equal(name, "reserve_praktika_workflow"); assert.equal(args.p_actor_user_id, "current-user");
    calls++;
    Object.assign(f.tables.report_drafts[0], { workflow_status: "running", workflow_praktika_upload_status: "waiting_for_authentication" });
    return { data: { ok: true, intentId: "intent", reconciled: calls > 1 }, error: null };
  } });
  const body = { startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending", continuationOptions: { praktikaPatientId: "123" } };
  const response = await f.route(startPath)(request(body));
  assert.equal(response.status, 200); assert.equal((await response.json()).intentId, "intent");
  assert.deepEqual(f.events, []); assert.equal(f.tables.praktika_helper_jobs.length, 0);
  assert.equal(f.tables.report_drafts[0].edited_text, "Synthetic approved text");
});
test("durable start never substitutes provider/creator session for authenticated actor", async () => {
  const f = fixture(); f.tables.praktika_sessions[0].app_user_id = "provider";
  f.tables.report_drafts[0].created_by = "provider"; f.tables.report_drafts[0].provider_id = "provider";
  (f.db as any).rpc = () => assert.fail("must not reserve using another person's session");
  const response = await f.route(startPath)(request({ startWorkflow: true, workflowStatus: "running", praktikaUploadStatus: "pending", continuationOptions: { praktikaPatientId: "123" } }));
  assert.equal(response.status, 409); assert.deepEqual(f.events, []);
});
test("new complete workflow is server continued, while client poll is read only", () => {
  const source = readFileSync("app/(protected)/report-writing/typist/TypistPage.tsx", "utf8");
  assert.match(source, /if \(!completeWorkflow\) runMedirefWorkflowInBackground/);
  assert.match(source, /continuationOptions: \{ \.\.\.workflowPayload/);
  assert.match(source, /Workflow queued — waiting for Praktika verification/);
  assert.match(source, /workflowStartPending \|\| selectedDraft\?\.workflow_status === "running"/);
});
