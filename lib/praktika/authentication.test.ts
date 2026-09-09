import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import type { BrowserContext } from "playwright";
import { readFile } from "node:fs/promises";
import { derivePraktikaConnection, PRAKTIKA_AUTH_FRESHNESS_MS } from "./authentication";
import { createPraktikaAuthenticationGate, validateGstResponse, probePraktikaAuthentication,
  praktikaPracticeDate, PraktikaAuthenticationUnverified } from "./authentication-probe";
import { PraktikaOwnershipLost, type HelperHealth } from "./helper-lease";

for (const [name, status, expectedUrl, body, verified, phase] of [
  ["empty authenticated array", 200, true, "[]", true, "error"],
  ["non-empty authenticated array", 200, true, '[{"fixture":true}]', true, "error"],
  ["observed logged-out response", 500, true, "", false, "error"],
  ["malformed JSON", 200, true, "{", false, "error"],
  ["HTML login", 200, true, '<input type="password">', false, "waiting_for_credentials"],
  ["MFA", 200, true, '<input autocomplete="one-time-code">', false, "waiting_for_mfa"],
  ["redirect", 302, true, "[]", false, "error"],
  ["unexpected destination", 200, false, "[]", false, "error"],
  ["explicit auth error", 500, true, '{"error":"expired session"}', false, "waiting_for_credentials"],
  ["array auth marker", 200, true, '["not logged in"]', false, "waiting_for_credentials"],
  ["error envelope", 200, true, '[{"success":false}]', false, "error"],
  ["JSON object", 200, true, "{}", false, "error"],
] as const) {
  test(name, () => {
    const result = validateGstResponse(status, expectedUrl, body);
    assert.equal(result.verified, verified);
    assert.equal(result.phase, phase);
    assert.deepEqual(Object.keys(result).sort(), ["httpStatus", "parsedArray", "phase", "verified"]);
  });
}

test("practice date respects midnight in configured local timezone", () => {
  assert.equal(praktikaPracticeDate(new Date("2026-09-08T15:00:00Z"), "Australia/Brisbane"), "2026-09-09");
});

test("probe uses active context, exact configured form, no redirects, and disposes body", async () => {
  let disposed = false;
  const context = { request: { post: async (url: string, options: { data: string; maxRedirects: number; timeout: number }) => {
    assert.equal(url, "https://fixture.invalid/php/json/db_reportingDataWarehouse.php");
    const form = new URLSearchParams(options.data);
    assert.deepEqual([...form.keys()].sort(), ["iPracticeId", "iProviderId", "sFromDate", "sReportName", "sToDate"]);
    assert.equal(form.get("iPracticeId"), "42"); assert.equal(form.get("iProviderId"), "0");
    assert.equal(form.get("sReportName"), "GST"); assert.equal(form.get("sFromDate"), form.get("sToDate"));
    assert.equal(options.maxRedirects, 0); assert.equal(options.timeout, 10000);
    return { url: () => url, ok: () => true, status: () => 200, body: async () => Buffer.from("[]"),
      dispose: async () => { disposed = true; } };
  } } } as unknown as BrowserContext;
  assert.equal((await probePraktikaAuthentication(context, "42", "https://fixture.invalid")).verified, true);
  assert.equal(disposed, true);
});

test("invalid scope, network error and incomplete body fail closed without exposing errors", async () => {
  let requests = 0;
  const context = { request: { post: async () => { requests++; throw new Error("private fixture"); } } } as unknown as BrowserContext;
  assert.equal((await probePraktikaAuthentication(context, "", "https://fixture.invalid")).verified, false);
  assert.equal(requests, 0);
  assert.equal((await probePraktikaAuthentication(context, "42", "https://fixture.invalid")).verified, false);
  const incomplete = { request: { post: async () => ({
    url: () => "https://fixture.invalid/php/json/db_reportingDataWarehouse.php", ok: () => true, status: () => 200,
    body: async () => { throw new Error("private body"); }, dispose: async () => {},
  }) } } as unknown as BrowserContext;
  assert.equal((await probePraktikaAuthentication(incomplete, "42", "https://fixture.invalid")).verified, false);
});

function gateFixture(fresh = false, succeeds = true) {
  let row: HelperHealth = { helper_instance_id: "owner", helper_heartbeat_at: new Date().toISOString(),
    authenticated_at: fresh ? new Date().toISOString() : new Date(Date.now() - PRAKTIKA_AUTH_FRESHNESS_MS - 1).toISOString() };
  let probes = 0; let writes = 0; let failures = 0; let lost = false;
  const ensure = createPraktikaAuthenticationGate({
    assertOwned: async () => { if (lost) throw new PraktikaOwnershipLost(); },
    readOwnedSession: async () => row,
    probe: async () => { probes++; await new Promise(resolve => setImmediate(resolve)); return validateGstResponse(succeeds ? 200 : 500, true, succeeds ? "[]" : ""); },
    recordSuccess: async () => { if (lost) throw new PraktikaOwnershipLost(); writes++; row = { ...row, authenticated_at: new Date().toISOString() }; },
    recordFailure: async () => { failures++; row.authenticated_at = null; },
  });
  return { ensure, stats: () => ({ probes, writes, failures }), lose: () => { lost = true; } };
}

test("fresh proof skips probe; stale proof shares one in-flight probe then reuses it", async () => {
  const fresh = gateFixture(true); await fresh.ensure();
  assert.deepEqual(fresh.stats(), { probes: 0, writes: 0, failures: 0 });
  const stale = gateFixture();
  await Promise.all([stale.ensure(), stale.ensure(), stale.ensure()]);
  await stale.ensure();
  assert.deepEqual(stale.stats(), { probes: 1, writes: 1, failures: 0 });
});

test("failed concurrent probe shares failure and cannot create proof", async () => {
  const fixture = gateFixture(false, false);
  const results = await Promise.allSettled([fixture.ensure(), fixture.ensure()]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason instanceof PraktikaAuthenticationUnverified));
  assert.deepEqual(fixture.stats(), { probes: 1, writes: 0, failures: 0 });
});

test("ownership lost in flight prevents authentication write", async () => {
  const fixture = gateFixture();
  const pending = fixture.ensure();
  await Promise.resolve(); await Promise.resolve();
  fixture.lose();
  await assert.rejects(pending, PraktikaOwnershipLost);
  assert.equal(fixture.stats().writes, 0);
});

test("effective connection requires fresh lease and proof; stale history and idle fail closed", () => {
  const now = Date.now();
  const row = { status: "connected", cookie: "fixture", helper_instance_id: "owner",
    helper_heartbeat_at: new Date(now).toISOString(), authenticated_at: new Date(now).toISOString() };
  assert.equal(derivePraktikaConnection(row, now).connected, true);
  for (const change of [
    { authenticated_at: null },
    { authenticated_at: new Date(now - PRAKTIKA_AUTH_FRESHNESS_MS).toISOString() },
    { helper_heartbeat_at: new Date(now - 90_000).toISOString() },
    { helper_instance_id: null },
  ]) assert.equal(derivePraktikaConnection({ ...row, ...change }, now).connected, false);
  assert.equal(derivePraktikaConnection({ status: "connected", cookie: "fixture" }).status, "idle");
  for (const status of ["waiting_for_credentials", "waiting_for_mfa", "error"]) {
    assert.equal(derivePraktikaConnection({ ...row, status }, now).status, status);
    assert.equal(derivePraktikaConnection({ ...row, status }, now).connected, false);
  }
});

test("RPC proof actions are behind owner/lease fence and only authenticate sets DB proof time", async () => {
  const sql = await readFile(new URL("../../supabase/migrations/202609090001_praktika_helper_lease.sql", import.meta.url), "utf8");
  assert.ok(sql.indexOf("helper_instance_id is distinct from p_instance_id") < sql.indexOf("if p_action = 'authenticate'"));
  assert.match(sql, /authenticated_at = clock_timestamp\(\)/);
  assert.equal((sql.match(/authenticated_at = clock_timestamp\(\)/g) || []).length, 1);
  assert.match(sql, /helper_heartbeat_at = clock_timestamp\(\), authenticated_at = null/);
});

test("status route exposes derived truth without probing or persisting proof", async () => {
  const source = await readFile(new URL("../../app/api/praktika/session/status/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "GET")!;
  const compiled = ts.transpileModule(fn.getText(ast).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let row = { status: "connected", cookie: "fixture", helper_instance_id: "owner",
    helper_heartbeat_at: new Date().toISOString(), authenticated_at: new Date().toISOString() as string | null };
  const get = runInNewContext(compiled + "\nGET", { URL, derivePraktikaConnection,
    authorizePraktikaSession: async () => ({ scope: "user" }),
    PraktikaSessionAuthorizationError: class extends Error {},
    getPraktikaSession: async () => row,
    NextResponse: { json: (value: unknown) => value }, console,
  });
  assert.equal((await get(new Request("https://fixture.invalid/api"))).connected, true);
  row = { ...row, authenticated_at: null };
  const unverified = await get(new Request("https://fixture.invalid/api"));
  assert.equal(unverified.connected, false); assert.equal(unverified.status, "checking_connection");
  assert.equal(unverified.storedStatus, "connected");
  row = { ...row, helper_heartbeat_at: new Date(0).toISOString() };
  const idle = await get(new Request("https://fixture.invalid/api"));
  assert.equal(idle.connected, false); assert.equal(idle.status, "idle");
});
