import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext } from "playwright";
import { classifyPraktikaRedirect, probePraktikaAuthentication, createPraktikaAuthenticationGate, PraktikaAuthenticationUnverified } from "./authentication-probe";

const expected = "https://fixture.invalid/php/json/db_reportingDataWarehouse.php";
for (const [location, category, sameOrigin] of [
  ["/v2/login?token=PRIVATE#PRIVATE", "login_redirect", true],
  ["https://PRIVATE:PRIVATE@fixture.invalid/v2/login?secret=PRIVATE", "login_redirect", true],
  ["/v2/scheduler?secret=PRIVATE", "same_origin_other_redirect", true],
  ["/v2/login/other", "same_origin_other_redirect", true],
  ["https://external.invalid/v2/login", "external_redirect", false],
  ["http://fixture.invalid/v2/login", "external_redirect", false],
  [undefined, "redirect_destination_unavailable", null],
  ["", "redirect_destination_unavailable", null],
  ["https://[", "redirect_destination_unavailable", null],
  ["javascript:PRIVATE", "redirect_destination_unavailable", null],
] as const) {
  test(`redirect classification ${category}: ${String(sameOrigin)} (${location?.length ?? -1})`, () => {
    const result = classifyPraktikaRedirect(location, expected);
    assert.deepEqual(result, { redirect_category: category, same_origin: sameOrigin });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|token|secret|https?:/);
  });
}

test("307 diagnostics preserve background proof and strict job failure behavior, without following or reading body", async () => {
  let calls = 0, disposed = 0, successWrites = 0, failureWrites = 0;
  let location = "/other?PRIVATE#PRIVATE";
  const context = { request: { post: async (url: string, options: { maxRedirects: number }) => {
    calls++; assert.equal(options.maxRedirects, 0);
    return { url: () => url, ok: () => false, status: () => 307,
      headers: () => ({ location }),
      body: () => { throw new Error("Must not read body"); }, dispose: async () => { disposed++; } };
  } } } as unknown as BrowserContext;
  const row = { helper_instance_id: "owner", helper_heartbeat_at: new Date().toISOString(), authenticated_at: new Date().toISOString() as string | null };
  const proof = row.authenticated_at;
  const gate = createPraktikaAuthenticationGate({ assertOwned: async () => {}, readOwnedSession: async () => row,
    probe: () => probePraktikaAuthentication(context, "42", "https://fixture.invalid"),
    recordSuccess: async () => { successWrites++; }, recordFailure: async () => { failureWrites++; row.authenticated_at = null; },
  });
  const logs: unknown[][] = [];
  const original = console.log;
  console.log = (...args) => { logs.push(args); };
  try {
    await assert.rejects(gate.renew(), PraktikaAuthenticationUnverified);
    location = "/other?PRIVATE";
    await assert.rejects(gate.renew(), PraktikaAuthenticationUnverified);
    assert.equal(row.authenticated_at, proof);
    assert.equal(failureWrites, 0); assert.equal(successWrites, 0);
    row.authenticated_at = null;
    await assert.rejects(gate(), PraktikaAuthenticationUnverified);
    assert.equal(failureWrites, 0); assert.equal(calls, 3); assert.equal(disposed, 3);
  } finally { console.log = original; }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|fixture.invalid|\/v2\/login/);
  const fields = logs.find(([event]) => event === "[Praktika auth] renewal_transient_failure")?.[1] as Record<string, unknown>;
  assert.equal(fields.httpStatus, 307); assert.equal(fields.redirect_category, "same_origin_other_redirect");
  assert.equal(fields.phase, "error"); assert.equal(fields.responseReceived, true);
  assert.equal(typeof fields.elapsed_ms, "number"); assert.equal(typeof fields.proof_age_ms, "number");
});
