import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { sanitizeNetworkPath, sanitizeRequestShape, sanitizeResponseShape, startNetworkDiagnostic } from "./mediref-network-diagnostic";

test("routes hide dynamic IDs, queries and signed storage URLs", () => {
  assert.equal(sanitizeNetworkPath("https://www.mediref.com.au/compose/PRIVATE/__data.json?token=SECRET").pathname, "/compose/{id}/__data.json");
  assert.equal(sanitizeNetworkPath("https://storage.invalid/PRIVATE.pdf?signature=SECRET").pathname, "external_request");
  const route = sanitizeNetworkPath("https://www.mediref.com.au/_app/remote/fd8vn1/saveDraft?secret=VALUE");
  assert.equal(route.routeId, "fd8vn1"); assert.equal(route.action, "saveDraft");
  assert.ok(!JSON.stringify(route).includes("VALUE"));
});

test("JSON/base64 inspection returns allowlisted keys, never values or arbitrary keys", () => {
  const payload = Buffer.from(JSON.stringify([{ patient: 1, files: 2, recipients: 3 }, { name: "PRIVATE NAME", dob: "1990-06-09" }, { filename: "PRIVATE.pdf" }])).toString("base64");
  const shape = sanitizeRequestShape("application/json", JSON.stringify({ payload, refreshes: [], SECRET_KEY: "TOKEN" }));
  assert.deepEqual(shape.topLevelKeys, ["payload", "refreshes"]);
  assert.equal(shape.payloadDecoded, true);
  for (const flag of [shape.containsDobField, shape.containsPatientField, shape.containsFilesField, shape.containsRecipientsField]) assert.equal(flag, true);
  for (const secret of [payload, "PRIVATE", "1990", "SECRET", "TOKEN"]) assert.ok(!JSON.stringify(shape).includes(secret));
  assert.equal(sanitizeRequestShape("application/json", 'not JSON').payloadDecoded, false);
  assert.equal(sanitizeRequestShape("application/json", "x".repeat(300000)).payloadDecoded, false);
  assert.equal(sanitizeRequestShape("application/pdf", null).bodyType, "raw-binary");
  assert.equal(sanitizeRequestShape("multipart/form-data; boundary=SECRET", null).contentType, "multipart/form-data");
});

test("response shape reveals only keys and explicit success flags", () => {
  const shape = sanitizeResponseShape(JSON.stringify({ result: JSON.stringify([{ success: 1, correspondenceId: "PRIVATE-ID", patient: { dob: "PRIVATE-DOB" }, SECRET_KEY: "TOKEN" }]) }));
  assert.equal(shape.successFlagTrue, true);
  assert.ok(shape.responseKeys.includes("correspondenceId"));
  for (const secret of ["PRIVATE", "TOKEN", "SECRET_KEY"]) assert.ok(!JSON.stringify(shape).includes(secret));
});

test("passive capture correlates chronology and signed upload without exposing bodies", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const signed = "https://storage.invalid/PRIVATE.pdf?secret=TOKEN";
    await context.route("**/*", route => {
      const isParams = route.request().url().includes("getUploadParameters");
      const body = JSON.stringify(isParams ? { result: JSON.stringify([signed]) } : { success: true });
      return route.fulfill({ contentType: "application/json", headers: { "content-length": String(Buffer.byteLength(body)), "access-control-allow-origin": "*" }, body });
    });
    const page = await context.newPage(); await page.goto("https://www.mediref.com.au/compose");
    const capture = startNetworkDiagnostic(context, "https://www.mediref.com.au");
    await page.evaluate(async signed => {
      await fetch("/_app/remote/fd8vn1/saveDraft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patient: { dob: "PRIVATE" } }) });
      await fetch("/_app/remote/1wqh9sd/getUploadParameters", { method: "POST" });
    }, signed);
    await page.evaluate(async signed => { await fetch(signed, { method: "PUT", body: "PRIVATE-BYTES" }).catch(() => undefined); }, signed);
    await page.evaluate(async () => { await fetch("/_app/remote/fd8vn1/saveDraft", { method: "POST" }); });
    const result = await capture.stop();
    const save = result.requests.filter(r => r.matchesHistoricalSaveDraftRoute);
    assert.equal(save.length, 2);
    assert.equal(save[0].classification, "draft_save_before_upload_request");
    assert.equal(save[1].classification, "draft_save_after_upload_request");
    assert.ok(result.requests.some(r => r.pathname === "external_signed_upload"));
    assert.deepEqual(result.requests.map(r => r.sequence), [...result.requests.map(r => r.sequence)].sort((a, b) => Number(a) - Number(b)));
    for (const secret of ["PRIVATE", "TOKEN", "storage.invalid"]) assert.ok(!JSON.stringify(result).includes(secret));
  } finally { await browser.close(); }
});


test("network observer has no worker, database, or replay imports", async () => {
  const source = await readFile(new URL("./mediref-network-diagnostic.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(imports, ["playwright"]);
  assert.doesNotMatch(source, /supabase|refresh-mediref-session|route\.continue|route\.fulfill|context\.request/);
  const shape = sanitizeRequestShape("application/x-www-form-urlencoded", "dob=PRIVATE&filename=PRIVATE.pdf&SECRET=TOKEN");
  assert.equal(shape.containsDobField, true);
  assert.equal(shape.containsFilesField, true);
  assert.ok(!JSON.stringify(shape).includes("PRIVATE"));
});

import { sanitizeInitializationStructures, compareInitializationStructures, startInitializationDiagnostic } from "./mediref-network-diagnostic";

test("initialization sanitizer preserves references, types and stable identity without values", () => {
  const table = [{ s3uuid: 1, patient: 2, files: 6, practiceId: 7 }, "private-draft", { name: 3, dob: 4, ptEmail: 5 }, "Private Person", "1990-06-09", "person@example.invalid", [], 987654];
  const result = sanitizeInitializationStructures({ nodes: [{ data: table }], status: null, success: true, error: "", url: "https://example.invalid", signedUrl: "https://example.invalid?X-Amz-Signature=secret", cookie: "private-cookie", csrf: "private-csrf" }, table);
  const output = JSON.stringify(result);
  for (const secret of ["private-draft", "Private Person", "1990-06-09", "person@example.invalid", "987654", "https://", "private-cookie", "private-csrf"]) assert.ok(!output.includes(secret));
  const save = result.saveDraft as unknown[];
  assert.deepEqual(save[0], table[0]);
  assert.deepEqual(save[2], table[2]);
  assert.deepEqual(save[6], []);
  assert.equal(save[1], "<DRAFT_ID>");
  assert.equal(save[3], "<PATIENT_NAME>");
  assert.equal(save[4], "<DOB>");
  assert.deepEqual(save[7], { __placeholder: "PRACTICE_ID", type: "number" });
  const c = result.compose as Record<string, unknown>;
  assert.equal(c.status, null); assert.equal(c.success, true); assert.equal(c.error, "");
  assert.equal(c.url, "<URL>"); assert.equal(c.signedUrl, "<SIGNED_URL>");
  assert.deepEqual((c.nodes as Array<{data: unknown}>)[0].data, save);
});

test("initialization comparison resolves references and never infers client generation from absence", () => {
  const table = [{ s3uuid: 1, patient: 2, files: 3, practiceId: 4, uploadPrefix: 5 }, "draft", {}, [], 1234, "private/prefix"];
  const comparison = compareInitializationStructures({ nodes: [{ data: table }] }, table);
  assert.equal(comparison.composeContainsDraftObject, true);
  assert.equal(comparison.sameDraftIdentifierObserved, true);
  assert.equal(comparison.composeContainsPracticeId, true);
  assert.equal(comparison.saveDraftContainsUploadPrefix, true);
  assert.equal(comparison.practiceIdentifierSource, "ambiguous");
  assert.equal(comparison.baselineDraftSource, "compose");
  assert.equal(compareInitializationStructures(null, table).baselineDraftSource, "ambiguous");
  assert.equal(compareInitializationStructures(null, table).practiceIdentifierSource, "saveDraft");
});

test("initialization capture extracts only first save and observed Compose JSON on selected page", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const table = [{ s3uuid: 1, patient: 2, files: 3 }, "PRIVATE-DRAFT", { name: 4 }, [], "PRIVATE-NAME"];
    const body = JSON.stringify({ nodes: [{ data: table }] });
    await context.route("**/*", route => route.fulfill({ contentType: "application/json", headers: { "content-length": String(Buffer.byteLength(body)) }, body }));
    const page = await context.newPage(); await page.goto("https://www.mediref.com.au/compose");
    const capture = startInitializationDiagnostic(context, page);
    await page.evaluate(async payload => {
      await fetch("/compose/PRIVATE-DRAFT/__data.json");
      await fetch("/_app/remote/fd8vn1/saveDraft", { method: "POST", body: JSON.stringify({ payload, refreshes: [] }) });
      await fetch("/_app/remote/fd8vn1/saveDraft", { method: "POST", body: JSON.stringify({ payload: btoa("[]"), refreshes: [] }) });
    }, Buffer.from(JSON.stringify(table)).toString("base64"));
    await capture.waitForFirstSave(1000);
    const result = await capture.stop();
    assert.equal((result.saveDraft as unknown[]).length, table.length);
    assert.equal(result.comparison.sameDraftIdentifierObserved, true);
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  } finally { await browser.close(); }
});

test("plain patient fields, numeric identifiers and dynamic secret keys are sanitized", () => {
  const result = sanitizeInitializationStructures({ patient: { name: "SensitiveName", dob: "2001-02-03", ptEmail: "private@example.invalid", phone: "0400000000", address: "Private address" }, practiceId: 123456, authorization: "Bearer private-auth", "private-key@example.invalid": "private-value", version: 42 }, null);
  const output = JSON.stringify(result);
  for (const secret of ["SensitiveName", "2001-02-03", "private@example.invalid", "0400000000", "Private address", "123456", "Bearer", "private-auth", "private-key@example.invalid", "private-value"]) assert.ok(!output.includes(secret));
  assert.deepEqual((result.compose as Record<string, unknown>).practiceId, { __placeholder: "PRACTICE_ID", type: "number" });
});

test("flattened sentinel references survive and equal or distinct identities remain distinguishable", () => {
  const table = [{ s3uuid: 1, extraPwType: -1, recipients: 2 }, "private-one", [1, 3], "private-two", null, false, ""];
  const result = sanitizeInitializationStructures(null, table).saveDraft as unknown[];
  assert.deepEqual(result[0], table[0]); assert.deepEqual(result[2], [1, 3]);
  assert.notEqual(result[1], result[3]);
  assert.deepEqual(result.slice(4), [null, false, ""]);
});

import { analyzeUploadKey, savedFileStructure, startUploadKeyDiagnostic } from "./mediref-network-diagnostic";

test("upload key analysis classifies segments and equality without identifiers", () => {
  const key = "987654/privateDraft/12345678-1234-1234-1234-123456789abc";
  const result = analyzeUploadKey(key, "privateDraft", key, [987654]);
  assert.equal(result.keySegmentCount, 3); assert.equal(result.draftIdSegmentIndex, 1);
  assert.equal(result.prefixSegmentCount, 1); assert.equal(result.suffixSegmentCount, 1);
  assert.deepEqual(result.segments.map(s => s.classification), ["matchesKnownPracticeIdentifier", "matchesDraftId", "uuid"]);
  assert.equal(result.practicePrefixClassification, "numeric");
  assert.equal(result.saveDraftFileKeyMatchesUploadRequestKey, true);
  assert.equal(result.uploadIdSource, "unknown");
  for (const secret of key.split("/")) assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(analyzeUploadKey(key, "missing", "different").draftIdSegmentIndex, null);
  assert.equal(analyzeUploadKey(null, null, null).keyPresent, false);
  assert.deepEqual(analyzeUploadKey("opaque/draft/42", "draft", null).segments.map(s => s.classification), ["opaque", "matchesDraftId", "numeric"]);
});

test("saved file metadata retains original wire references but hides names, URLs and IDs", () => {
  const table = [{ files: 1 }, [2], { key: 3, originalName: 4, customName: 4, size: 5, progress: 6, uploadId: 7, s3key: 3, type: 8 }, "private/key", "private.pdf", 12345, { bytesTotal: 5 }, "private-upload", "application/pdf"];
  const result = savedFileStructure(table) as { fileReference: number; indexedEntries: Record<string, unknown> };
  assert.equal(result.fileReference, 2); assert.deepEqual(result.indexedEntries[2], table[2]);
  assert.equal(result.indexedEntries[0], undefined);
  for (const secret of ["private", "12345", "application/pdf"]) assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(savedFileStructure([{ files: 1 }, []]), null);
});

test("upload capture correlates parameters, signed PUT and saved file with no value leakage", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const signed = "https://storage.invalid/private.pdf?signature=secret";
    await context.route("**/*", route => {
      const url = route.request().url();
      const body = JSON.stringify(url.includes("getUploadParameters") ? { result: JSON.stringify([signed]) } : url.includes("__data") ? { practiceId: 987654 } : { ok: true });
      return route.fulfill({ contentType: "application/json", headers: { "content-length": String(Buffer.byteLength(body)), "access-control-allow-origin": "*" }, body });
    });
    const page = await context.newPage(); await page.goto("https://www.mediref.com.au/compose");
    const capture = startUploadKeyDiagnostic(context, page);
    await page.evaluate(async () => { await fetch("/compose/privateDraft/__data.json"); });
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
    const initial = encode([{ s3uuid: 1, files: 2 }, "privateDraft", []]);
    const params = encode([{ key: 1, filename: 2, type: 3 }, "987654/privateDraft/privateUpload", "private.pdf", "application/pdf"]);
    const saved = encode([{ s3uuid: 1, files: 2 }, "privateDraft", [3], { key: 4, originalName: 5 }, "987654/privateDraft/privateUpload", "private.pdf"]);
    await page.evaluate(async ({ initial, params }) => {
      await fetch("/_app/remote/fd8vn1/saveDraft", { method: "POST", body: JSON.stringify({ payload: initial }) });
      await fetch("/_app/remote/1wqh9sd/getUploadParameters", { method: "POST", body: JSON.stringify({ payload: params }) });
    }, { initial, params });
    await page.evaluate(async signed => { await fetch(signed, { method: "PUT", body: "test" }); }, signed);
    await page.evaluate(async saved => { await fetch("/_app/remote/fd8vn1/saveDraft", { method: "POST", body: JSON.stringify({ payload: saved }) }); }, saved);
    await capture.waitForUploadSave(2000);
    const result = await capture.stop();
    assert.equal(result.analysis.saveDraftFileKeyMatchesUploadRequestKey, true);
    assert.equal(result.analysis.signedPutStatus, 200);
    assert.equal(result.analysis.practicePrefixSource, "prior_response");
    assert.equal(result.analysis.uploadIdSource, "unknown");
    for (const secret of ["987654", "private", "secret", "https://"]) assert.ok(!JSON.stringify(result).includes(secret));
  } finally { await browser.close(); }
});

import { assessAutomaticUploadSource, automaticSourceEligible, readLocalUploadBootstrap, verifyLocalPrefixReuse } from "./mediref-network-diagnostic";

test("runtime source comparison hides values and rejects manual-only production sources", () => {
  const result = assessAutomaticUploadSource([{ uploadPrefix: "private-prefix" }], "private-prefix/draft/upload", "draft");
  assert.equal(result.prefixAvailable, true);
  assert.equal(result.sourceType, "bootstrap_data");
  assert.equal(result.productionSourceProven, false);
  assert.ok(!JSON.stringify(result).includes("private-prefix"));
  assert.equal(assessAutomaticUploadSource([], "private-prefix/draft/upload", "draft").prefixAvailable, false);
  for (const source of ["manual", "historical_only", "hardcoded", "unknown"]) assert.equal(automaticSourceEligible(source, true), false);
  assert.equal(automaticSourceEligible("bootstrap_data", false), false);
});

test("targeted bootstrap inspection and local reuse make no upload/send and hide secrets", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<script type="application/json">{"uploadPrefix":"private-prefix"}</script>' }));
    const page = await context.newPage(); await page.goto("https://www.mediref.com.au/compose");
    assert.equal(assessAutomaticUploadSource(await readLocalUploadBootstrap(page), "private-prefix/first/upload", "first").prefixAvailable, true);
    const requests: string[] = [];
    // Stub APIRequestContext: browser routing does not intercept page.request.
    page.request.post = async (url, options) => {
      requests.push(String(url));
      const body = options?.data as { payload: string };
      const decoded = JSON.parse(Buffer.from(body.payload, "base64").toString("utf8"));
      assert.match(decoded[1], /^private-prefix\/second\/[a-z0-9]{24}$/);
      const responseBody = JSON.stringify({ result: JSON.stringify(["https://storage.invalid/private?signature=secret"]) });
      return { status: () => 200, ok: () => true, headers: () => ({ "content-length": String(Buffer.byteLength(responseBody)) }), text: async () => responseBody, dispose: async () => undefined } as unknown as Awaited<ReturnType<typeof page.request.post>>;
    };
    const result = await verifyLocalPrefixReuse(page, "private-prefix", "first", "second");
    assert.equal(result.prefixReusableAcrossDrafts, true);
    assert.equal(result.productionSourceProven, false);
    assert.equal(requests.length, 1); assert.ok(requests[0].endsWith("/getUploadParameters"));
    for (const secret of ["private", "secret", "signature", "cookie", "Bearer"]) assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal((await verifyLocalPrefixReuse(page, "private-prefix", "first", "first")).prefixReusableAcrossDrafts, null);
    assert.equal(requests.length, 1);
  } finally { await browser.close(); }
});

import { startHistoricalPrefixComparison } from "./mediref-network-diagnostic";

test("historical comparison observes two distinct drafts, reports only properties, and detects changed prefixes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", route => route.fulfill({ contentType: "application/json", body: "{}" }));
    const page = await context.newPage(); await page.goto("https://www.mediref.com.au/compose");
    const emit = async (draft: string, prefix: string, suffix: string) => {
      const save = Buffer.from(JSON.stringify([{ s3uuid: 1 }, draft])).toString("base64");
      const upload = Buffer.from(JSON.stringify([{ key: 1, filename: 2 }, `${prefix}/${draft}/${suffix}`, "SECRET-FILENAME.pdf"])).toString("base64");
      await page.evaluate(async ({ save, upload }) => {
        await fetch("/_app/remote/fd8vn1/saveDraft", { method: "POST", body: JSON.stringify({ payload: save }) });
        await fetch("/_app/remote/1wqh9sd/getUploadParameters", { method: "POST", body: JSON.stringify({ payload: upload }) });
      }, { save, upload });
    };
    for (const changed of [false, true]) {
      const capture = startHistoricalPrefixComparison(context, page, "SECRET-HISTORICAL");
      await emit("SECRET-DRAFT-ONE", "SECRET-HISTORICAL", "a".repeat(24));
      await capture.waitForFirst(1000);
      await emit("SECRET-DRAFT-ONE", "SECRET-HISTORICAL", "b".repeat(24));
      await assert.rejects(capture.waitForSecond(30), /timed out/);
      await emit("SECRET-DRAFT-TWO", changed ? "SECRET-OTHER" : "SECRET-HISTORICAL", "c".repeat(24));
      await capture.waitForSecond(1000);
      const result = await capture.stop();
      assert.deepEqual(result, { historicalPrefixMatchesCurrentLivePrefix: true, currentSuffixLength: 24, currentSuffixLowercaseAlphanumeric: true, historicalSuffixAlgorithmCompatible: true, livePrefixStableAcrossTwoDrafts: !changed });
      assert.ok(!JSON.stringify(result).includes("SECRET"));
    }
    const mismatch = startHistoricalPrefixComparison(context, page, "SECRET-OTHER");
    await emit("ONE", "SECRET-HISTORICAL", "UPPER-123"); await mismatch.waitForFirst(1000);
    await emit("TWO", "SECRET-HISTORICAL", "second"); await mismatch.waitForSecond(1000);
    const result = await mismatch.stop();
    assert.equal(result?.historicalPrefixMatchesCurrentLivePrefix, false);
    assert.equal(result?.historicalSuffixAlgorithmCompatible, false);
    assert.equal(result?.currentSuffixLowercaseAlphanumeric, false);
    const incomplete = startHistoricalPrefixComparison(context, page, "SECRET-HISTORICAL");
    assert.equal(await incomplete.stop(), null);
  } finally { await browser.close(); }
});
