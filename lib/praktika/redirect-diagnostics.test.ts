import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext } from "playwright";
import { classifyPraktikaRedirectDestination, classifyPraktikaPage, classifyPraktikaRedirect, probePraktikaAuthentication, createPraktikaAuthenticationGate, PraktikaAuthenticationUnverified } from "./authentication-probe";

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
  assert.equal(typeof fields.elapsed_ms, "number"); assert.equal(fields.proof_age_ms, undefined);
  const safe = logs.find(([event]) => event === "[Praktika auth] renewal_redirect")?.[1] as Record<string, unknown>;
  assert.deepEqual(safe, { httpStatus: 307, destinationCategory: "unknown", currentPageCategory: "unknown", helperAlive: true, proofStillFresh: true, proofAgeBucket: "<1m" });
});

for (const [path, category] of [
  ["/v2/login", "login"], ["/v2/scheduler", "scheduler"],
  ["/v2/reports/upcoming-appointments", "reports"],
  ["/php/json/db_reportingDataWarehouse.php", "same_requested_path"],
  ["/v2/unrecognized", "other_application_path"],
  ["/v2/mfa", "other_application_path"], // No verified MFA URL in repository.
  ["https://outside.invalid/secret", "external"], [undefined, "unknown"],
  ["https://[", "unknown"],
] as const) test(`safe destination category ${category}`, () => {
  assert.equal(classifyPraktikaRedirectDestination(path && path + "?credential=PRIVATE#PRIVATE", expected), category);
});
for (const [path, category] of [["/v2/login", "login"], ["/v2/scheduler", "scheduler"],
  ["/v2/reports/production", "reports"], ["/v2/patient-directory/patient-search", "patient_directory"],
  ["/v2/PRIVATE", "other_application"], ["/unknown", "unknown"]] as const) {
  test(`safe current page ${category}`, () => {
    assert.equal(classifyPraktikaPage("https://fixture.invalid" + path + "?cookie=PRIVATE", expected), category);
  });
}

test("repeated redirects expire proof independently; later GST restores only its own helper", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 2000000 });
  const { derivePraktikaConnection } = await import("./authentication");
  const { validateGstResponse } = await import("./authentication-probe");
  const make = () => {
    const row = { status: "connected", helper_instance_id: "owner", helper_heartbeat_at: new Date().toISOString(), authenticated_at: new Date().toISOString() };
    let ok = false;
    const gate = createPraktikaAuthenticationGate({ assertOwned: async () => {}, readOwnedSession: async () => row,
      probe: async () => validateGstResponse(ok ? 200 : 307, true, "[]"),
      recordSuccess: async () => { row.authenticated_at = new Date().toISOString(); },
      recordFailure: async () => { assert.fail("Transient redirect must not clear proof"); } });
    return { row, gate, recover: () => { ok = true; } };
  };
  const a = make(), b = make(); const original = a.row.authenticated_at;
  for (let i = 0; i < 6; i++) {
    await assert.rejects(a.gate.renew());
    assert.equal(a.row.authenticated_at, original);
    t.mock.timers.tick(60000); a.row.helper_heartbeat_at = new Date().toISOString();
  }
  assert.equal(derivePraktikaConnection(a.row).connected, false);
  a.recover(); await a.gate.renew();
  assert.equal(derivePraktikaConnection(a.row).connected, true);
  assert.equal(b.row.authenticated_at, original);
});
