import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserContext } from "playwright";
import { classifyPraktikaPhpFamily, praktikaPhpTargetFingerprint, classifyPraktikaPhpTarget, classifyPraktikaRedirectDestination, classifyPraktikaPage, classifyPraktikaRedirect, probePraktikaAuthentication, createPraktikaAuthenticationGate, PraktikaAuthenticationUnverified } from "./authentication-probe";

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
  let location = "/php/PRIVATE?PRIVATE#PRIVATE";
  const context = { request: { post: async (url: string, options: { maxRedirects: number }) => {
    calls++; assert.equal(options.maxRedirects, 0);
    return { url: () => url, ok: () => false, status: () => 307,
      headers: () => ({ location }),
      body: () => { throw new Error("Must not read body"); }, dispose: async () => { disposed++; } };
  } } } as unknown as BrowserContext;
  const row = { helper_instance_id: "owner", helper_heartbeat_at: new Date().toISOString(), authenticated_at: new Date().toISOString() as string | null };
  const proof = row.authenticated_at;
  const gate = createPraktikaAuthenticationGate({ helperToken: "0123456789abcdef", assertOwned: async () => {}, readOwnedSession: async () => row,
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
  assert.equal(fields.phpTargetFingerprint, undefined);
  assert.equal(fields.phase, "error"); assert.equal(fields.responseReceived, true);
  assert.equal(typeof fields.elapsed_ms, "number"); assert.equal(fields.proof_age_ms, undefined);
  const safe = logs.find(([event]) => event === "[Praktika auth] renewal_redirect")?.[1] as Record<string, unknown>;
  const redirects = logs.filter(([event]) => event === "[Praktika auth] renewal_redirect");
  assert.equal((redirects[1][1] as Record<string, unknown>).phpTargetFingerprint, undefined);
  assert.equal((redirects[1][1] as Record<string, unknown>).phpTargetFamily, undefined);
  assert.deepEqual(safe, { httpStatus: 307, helperToken: "0123456789abcdef", destinationCategory: "php_endpoint", phpTargetCategory: "unrecognized_php_target", phpTargetFamily: "php_other", phpTargetFingerprint: praktikaPhpTargetFingerprint("/php/PRIVATE", expected), currentPageCategory: "unknown", helperAlive: true, proofStillFresh: true, proofAgeBucket: "<1m" });
});

for (const [path, category] of [
  ["/v2/login", "login"], ["/v2/scheduler", "scheduler"],
  ["/v2/reports/upcoming-appointments", "reports"],
  ["/php/json/db_reportingDataWarehouse.php", "same_requested_path"],
  ["/v2/unrecognized", "other_application_path"],
  ["/v2/mfa", "other_application_path"], // No verified MFA URL in repository.
  ["https://outside.invalid/secret", "external"], [undefined, "location_missing"],
  ["https://[", "location_malformed"],
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

for (const [location, category] of [
  ["   ", "location_missing"], ["/bad\npath", "location_malformed"],
  ["javascript:PRIVATE", "location_unsupported_scheme"], ["/", "same_origin_root"],
  ["/php/json/PRIVATE.php?PRIVATE", "php_endpoint"], ["/login", "other_same_origin"],
] as const) test(`refined destination ${category}`, () => {
  assert.equal(classifyPraktikaRedirectDestination(location, expected), category);
});

for (const [path, label] of [
  ["/php/json/db_reportingDataWarehouse.php", "reporting_data_warehouse"],
  ["/php/json/db_gridPatientList.php", "patient_list"],
  ["/php/json/db_getCustomerReferringParties.php", "referring_parties"],
  ["/php/forms/db_getFormData.php", "form_get"],
  ["/php/forms/db_commitFormData.php", "form_commit"],
  ["/php/forms/db_updateFormData.php", "form_update"],
  ["/php/onlineBookingV2/db_search.php", "online_booking_search"],
  ["/php/onlineBookingV2/db_register.php", "online_booking_register"],
  ["/php/onlineBookingV2/db_getCustomerDetails.php", "online_booking_customer_details"],
  ["/php/PRIVATE", "unrecognized_php_target"],
  ["/php/forms/db_getFormData.php/extra", "unrecognized_php_target"],
] as const) test(`exact PHP label ${label}`, () => {
  for (const suffix of ["", "?credential=PRIVATE#PRIVATE"]) {
    assert.equal(classifyPraktikaPhpTarget(path + suffix, "https://fixture.invalid/another-request"), label);
  }
});
test('PHP detail is omitted for exact GST request and non-PHP destinations', () => {
  for (const location of [expected, expected + "?PRIVATE", "/v2/scheduler", "https://outside.invalid/php/forms/db_getFormData.php", undefined, "https://["]) {
    assert.equal(classifyPraktikaPhpTarget(location, expected), undefined);
  }
  assert.equal(classifyPraktikaRedirectDestination(expected + "?PRIVATE", expected), "same_requested_path");
});

test('pathname fingerprint excludes query, fragment and origin, preserves case and URL normalization', () => {
  const value = praktikaPhpTargetFingerprint('/php/PRIVATE?secret=ONE#ONE', expected);
  assert.match(value!, /^[0-9a-f]{16}$/);
  for (const path of ['/php/PRIVATE', '/php/PRIVATE?secret=TWO#TWO', '/php/./PRIVATE']) {
    assert.equal(praktikaPhpTargetFingerprint(path, expected), value);
  }
  assert.equal(praktikaPhpTargetFingerprint('/php/PRIVATE', 'https://another.invalid/request'), value);
  assert.notEqual(praktikaPhpTargetFingerprint('/php/OTHER', expected), value);
  assert.notEqual(praktikaPhpTargetFingerprint('/php/private', expected), value);
});
test('fingerprint is absent outside unrecognized same-origin PHP destinations', () => {
  for (const path of ['/php/forms/db_getFormData.php', expected, '/v2/scheduler', '/',
    'https://outside.invalid/php/PRIVATE', undefined, 'https://[']) {
    assert.equal(praktikaPhpTargetFingerprint(path, expected), undefined);
  }
});

for (const [pathname, family] of [
  ["/php/json/unknown.php", "php_json"],
  ["/php/forms/unknown.php", "php_forms"],
  ["/php/onlineBookingV2/unknown.php", "php_online_booking"],
  ["/php/other/unknown.php", "php_other"],
  ["/php/jsonish/unknown.php", "php_other"],
  ["/php/JSON/unknown.php", "php_other"],
] as const) test(`unknown PHP family ${family}`, () => {
  const fingerprint = praktikaPhpTargetFingerprint(pathname, expected);
  assert.equal(classifyPraktikaPhpFamily(pathname + "?PRIVATE#PRIVATE", expected), family);
  assert.equal(praktikaPhpTargetFingerprint(pathname + "?PRIVATE#PRIVATE", expected), fingerprint);
});
test('family omitted for known PHP endpoints and non-PHP redirects', () => {
  for (const pathname of [expected, "/php/forms/db_getFormData.php", "/v2/scheduler", "/",
    "https://external.invalid/php/json/unknown.php", undefined, "https://["]) {
    assert.equal(classifyPraktikaPhpFamily(pathname, expected), undefined);
  }
  assert.equal(classifyPraktikaPhpTarget('/php/forms/db_getFormData.php', expected), 'form_get');
});
