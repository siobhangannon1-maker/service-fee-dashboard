import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { APIRequestContext, APIResponse, Page } from "playwright";
import { buildPatientDraft, buildFileMetadata, decodeRemoteResult, draftIdFromComposeUrl, encodeRemotePayload, flattenRemotePayload, makeUploadIdentity, MedirefRemoteDraftError, prepareRemoteDraft, prepareRemoteDraftWithBrowser } from "./remote-draft-adapter";

const patient = { firstName: "Fixture", lastName: "Patient", dob: "1990-06-09" };
const draftId = "fixturecurrentdraft";
const signed = "https://storage.invalid/private.pdf?signature=PRIVATE";
const response = (value: unknown, status = 200, raw?: string): APIResponse => ({
  ok: () => status >= 200 && status < 300, status: () => status,
  headers: () => ({ "content-type": "application/json" }),
  text: async () => raw ?? JSON.stringify({ type: "result", result: JSON.stringify(flattenRemotePayload(value as never)) }),
  dispose: async () => undefined,
}) as unknown as APIResponse;

function fixture(failure?: string) {
  const calls: Array<{ method: string; url: string; data: unknown }> = [];
  const logs: unknown[] = [];
  const request = {
    post: async (url: string, options: { data: { payload: string }; maxRedirects: number }) => {
      assert.equal(options.maxRedirects, 0);
      const data = decodeRemoteResult(JSON.stringify({ result: Buffer.from(options.data.payload, "base64").toString("utf8") }));
      calls.push({ method: "POST", url, data });
      if (failure === "rawError") throw new Error(`${signed} ${patient.dob} SECRET COOKIE`);
      const params = url.endsWith("getUploadParameters");
      if (failure === "patientSave" && calls.length === 1) return response({}, 500);
      if (failure === "parameters" && params) return response({}, 200);
      if (failure === "finalSave" && calls.length === 4) return response({ success: false });
      return response(params ? signed : { success: true });
    },
    put: async (url: string, options: { data: Buffer; headers: Record<string, string> }) => {
      assert.equal(options.headers["content-type"], "application/pdf");
      assert.ok(Buffer.isBuffer(options.data));
      calls.push({ method: "PUT", url, data: null });
      return response(null, failure === "put" ? 403 : 204);
    },
  } as unknown as Pick<APIRequestContext, "post" | "put">;
  const run = (overrides = {}) => prepareRemoteDraft({ request, s3uuid: draftId, patient, filename: "private-fixture.pdf", pdf: Buffer.from("%PDF-1.4\nfixture"), log: (...args) => logs.push(args), ...overrides });
  return { calls, logs, run };
}

test("encoding retains the captured initial flattened shape including shared defaults", () => {
  const draft = buildPatientDraft(draftId, patient);
  assert.deepEqual(flattenRemotePayload({ ...draft, patient: { ...draft.patient, dob: "" } }), [
    { s3uuid: 1, patient: 2, recipients: 6, files: 7, recipientMsg: 4 }, draftId,
    { name: 3, dob: 4, ptEmail: 4, extraPwType: 5, customPw: 4, pwHint: 4, ptMsg: 4 }, "Fixture Patient", "", "none", [], [],
  ]);
  assert.deepEqual(JSON.parse(Buffer.from(encodeRemotePayload(draft), "base64").toString()), flattenRemotePayload(draft));
  assert.equal(draft.patient.dob, "1990-06-09");
  assert.equal(draft.s3uuid, draftId);
  assert.throws(() => buildPatientDraft(draftId, { ...patient, dob: "1990-02-30" }));
  assert.throws(() => buildPatientDraft(draftId, { ...patient, dob: "09/06/1990" }));
});

test("key uses validated historical constant and a fresh 24-character suffix", async () => {
  const source = await readFile(new URL("../../app/api/mediref/test-upload2/route.ts", import.meta.url), "utf8");
  const historical = source.match(/const PRACTICE_ID\s*=\s*"([^"]+)"/)?.[1];
  const first = makeUploadIdentity(draftId); const second = makeUploadIdentity(draftId);
  // Boolean assertions avoid printing private values on a failure.
  assert.ok(first.key.split("/")[0] === historical);
  assert.equal(first.key.split("/")[1], draftId);
  assert.match(first.uploadId, /^[a-z0-9]{24}$/);
  assert.notEqual(first.uploadId, second.uploadId);
});

test("only current trusted Compose URL supplies identity; no new ID is invented", () => {
  assert.equal(draftIdFromComposeUrl(`https://www.mediref.com.au/compose/${draftId}`), draftId);
  for (const url of ["https://www.mediref.com.au/compose", "https://other.invalid/compose/draft", "https://www.mediref.com.au/login"]) assert.equal(draftIdFromComposeUrl(url), null);
});

test("remote decoder resolves success references and rejects error/malformed envelopes", () => {
  assert.deepEqual(decodeRemoteResult('{"type":"result","result":"[{\\"success\\":1},true]"}'), { success: true });
  assert.equal(decodeRemoteResult('{"type":"result","result":"-1"}'), undefined);
  for (const raw of ['{}', '<html>login</html>', '{"type":"error","result":"[true]"}', '{"result":"[{\\"success\\":1},false]"}', '{"result":"[{\\"x\\":99}]"}']) assert.throws(() => decodeRemoteResult(raw));
});

test("successful patient save, upload and final file save happen in order, with safe logs", async () => {
  const f = fixture(); const result = await f.run();
  assert.deepEqual(f.calls.map(c => c.method), ["POST", "POST", "PUT", "POST"]);
  assert.ok(f.calls[0].url.endsWith("saveDraft")); assert.ok(f.calls[1].url.endsWith("getUploadParameters"));
  assert.ok(f.calls[3].url.endsWith("saveDraft"));
  const first = f.calls[0].data as ReturnType<typeof buildPatientDraft>;
  assert.deepEqual(first.patient, buildPatientDraft(draftId, patient).patient);
  assert.deepEqual(first.files, []); assert.deepEqual(first.recipients, []);
  const last = f.calls[3].data as { files: Array<Record<string, unknown>>; s3uuid: string };
  assert.equal(last.s3uuid, draftId); assert.equal(last.files.length, 1);
  const params = f.calls[1].data as { key: string };
  assert.ok(last.files[0].key === params.key);
  assert.equal(last.files[0].status, "complete");
  assert.deepEqual(last.files[0].progress && Object.keys(last.files[0].progress), ["uploadStarted", "bytesUploaded", "bytesTotal", "percentage"]);
  assert.equal(result.sent, false); assert.equal(result.prepared, true);
  assert.equal(result.recipientMatchingSkipped, true);
  const output = JSON.stringify(f.logs);
  for (const value of [patient.firstName, patient.dob, draftId, signed, "private-fixture.pdf", params.key, params.key.split("/")[0]]) assert.ok(!output.includes(value));
  assert.equal(f.logs.length, 10);
});

for (const [failure, count, stage] of [["patientSave", 1, "patient_save_started"], ["parameters", 2, "upload_parameters_requested"], ["put", 3, "pdf_upload_started"], ["finalSave", 4, "attachment_save_started"], ["rawError", 1, "patient_save_started"]] as const) {
  test(`${failure} fails safely without later steps or success`, async () => {
    const f = fixture(failure);
    await assert.rejects(f.run(), (error: unknown) => error instanceof MedirefRemoteDraftError && error.stage === stage && !error.message.includes("PRIVATE") && !error.message.includes(patient.dob));
    assert.equal(f.calls.length, count); assert.ok(!JSON.stringify(f.logs).includes("draft_prepared"));
  });
}

test("invalid patient or PDF fails before any requests", async () => {
  const f = fixture(); await assert.rejects(f.run({ pdf: Buffer.from("not-pdf") }));
  await assert.rejects(f.run({ patient: { ...patient, dob: "bad" } })); assert.equal(f.calls.length, 0);
  assert.deepEqual(buildFileMetadata("key", "id", "fixture.pdf", 42, 100).progress, { uploadStarted: 100, bytesUploaded: 42, bytesTotal: 42, percentage: 100 });
});

test("worker flag selects endpoint exclusively, preserves DOM rollback and never falls back after failure", async () => {
  const source = await readFile(new URL("../../scripts/refresh-mediref-session.ts", import.meta.url), "utf8");
  assert.match(source, /const USE_REMOTE_DRAFT_API = process.env.MEDIREF_USE_REMOTE_DRAFT_API\?\.toLowerCase\(\) === "true"/);
  const body = source.slice(source.indexOf("async function sendMedirefLetterWithBrowser("), source.indexOf("async function processOnePendingMedirefJob("));
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const enabled of [true, false]) for (const fail of [true, false]) {
    const calls: string[] = [];
    const step = (name: string) => async () => { calls.push(name); return true; };
    const run = runInNewContext(`${compiled}\nsendMedirefLetterWithBrowser`, {
      USE_REMOTE_DRAFT_API: enabled, console: { log() {} }, path: { basename: () => "fixture.pdf" },
      prepareRemoteDraftWithBrowser: async () => { calls.push("remote"); if (fail) throw new Error("remote failed"); return { prepared: true }; },
      openComposePage: step("compose"), fillComposePatientDetails: step("dob"), uploadPdfsToFileInput: step("fileInput"), fillFirstVisibleTextFieldByHints: step("message"), safePageUrl: async () => "compose",
    });
    const promise = run({ waitForTimeout: async () => undefined }, { payload: { patient } }, ["fixture.pdf"]);
    if (enabled && fail) await assert.rejects(promise); else await promise;
    assert.deepEqual(calls, enabled ? ["remote"] : ["compose", "dob", "fileInput", "message"]);
  }
  const adapter = await readFile(new URL("./remote-draft-adapter.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapter, /sendCorrespondence|deleteDraft|setInputFiles|enterPatientDob|test-send|test-upload2/);
});


test("browser adapter reuses authenticated context and preserves Compose identity; missing ID or multiple PDFs fails safely", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mediref-remote-test-"));
  try {
    const filename = path.join(directory, "fixture.pdf"); await writeFile(filename, "%PDF-1.4 fixture");
    let opens = 0; let posts = 0;
    const request = {
      post: async (url: string) => { posts++; return response(url.endsWith("getUploadParameters") ? signed : { success: true }); },
      put: async () => response(null, 200),
    };
    const page = {
      waitForURL: async (predicate: (url: URL) => boolean) => { assert.equal(predicate(new URL(`https://www.mediref.com.au/compose/${draftId}`)), true); },
      url: () => `https://www.mediref.com.au/compose/${draftId}`,
      context: () => ({ request }),
    } as unknown as Page;
    const open = async () => { opens++; };
    await assert.rejects(prepareRemoteDraftWithBrowser(page, patient, [filename, filename], open));
    assert.equal(opens, 0); assert.equal(posts, 0);
    const result = await prepareRemoteDraftWithBrowser(page, patient, [filename], open);
    assert.equal(result.prepared, true); assert.equal(opens, 1); assert.equal(posts, 3);
    page.waitForURL = async () => { throw new Error("PRIVATE URL timeout"); };
    await assert.rejects(prepareRemoteDraftWithBrowser(page, patient, [filename], open), (error: unknown) => error instanceof MedirefRemoteDraftError && error.stage === "compose_identity" && !error.message.includes("PRIVATE"));
    assert.equal(posts, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
