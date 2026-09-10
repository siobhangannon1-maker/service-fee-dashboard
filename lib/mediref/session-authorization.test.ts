import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function load(file: string, mocks: Record<string, unknown>) {
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  new Function("require", "exports", js)((name: string) => {
    if (!(name in mocks)) throw new Error("Unexpected dependency");
    return mocks[name];
  }, exports);
  return exports;
}
const next = { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
function guard(identity: string | null, active: boolean) {
  return load("lib/mediref/session-authorization.ts", {
    "server-only": {}, "next/server": next,
    "@/lib/report-writing/audit": { getAuditActor: async () => ({ actorUserId: identity }) },
    "@/lib/getUserStatus": { getUserStatus: async (_: string, options: unknown) => {
      assert.deepEqual(options, { failClosed: true }); return active;
    } },
  });
}
for (const route of ["status", "refresh", "credentials", "mfa-code"]) {
  for (const scenario of ["authorized", "anonymous", "inactive", "user", "invalid_scope", "database_error"]) {
    test(`${route}: ${scenario}`, async () => {
      const calls: any[] = [];
      const record = async (...args: any[]) => {
        calls.push(args);
        if (scenario === "database_error") throw new Error("PRIVATE_COOKIE_PASSWORD_DATABASE_DETAIL");
        return { scope: "practice", status: "not_started", cookie: "PRIVATE_COOKIE_PASSWORD_DATABASE_DETAIL" };
      };
      const mod = load(`app/api/mediref/session/${route}/route.ts`, {
        "next/server": next,
        "@/lib/mediref/session-authorization": guard(scenario === "anonymous" ? null : "self", scenario !== "inactive"),
        "@/lib/mediref/hybrid-session-store": {
          getMedirefSession: record, updateMedirefSession: record,
          markMedirefRefreshRequested: record, saveMedirefMfaCode: record,
        },
        "@/lib/mediref/tools-status": {
          hasRecentMedirefAuthentication: () => false,
          safeToolsStatus: () => ({ session: { status: "not_started", message: "Not connected", validForMs: 0, helperAlive: false } }),
        },
      });
      const scope = scenario === "user" ? "user" : scenario === "invalid_scope" ? "other" : "practice";
      const request = new Request(`https://example.invalid/?scope=${scope}&app_user_id=other`, route === "status" ? {} : {
        method: "POST", body: JSON.stringify({ scope, app_user_id: "other", sessionId: "other", email: "fixture@example.invalid", password: "synthetic", code: "123456",
          helper_instance_id: "attacker", helper_heartbeat_at: "attacker", helper_expires_at: "attacker", helper_stopping_at: "attacker", authenticated_instance_id: "attacker", authenticated_at: "attacker" }),
      });
      const response: Response = await (mod.GET || mod.POST)(request);
      assert.equal(response.status, scenario === "anonymous" ? 401 : scenario === "inactive" ? 403 : scenario === "invalid_scope" ? 400 : scenario === "database_error" && route !== "status" ? 500 : 200);
      assert.doesNotMatch(await response.text(), /PRIVATE_COOKIE_PASSWORD_DATABASE_DETAIL|attacker|synthetic/);
      if (["anonymous", "inactive", "invalid_scope"].includes(scenario)) assert.equal(calls.length, 0);
      else {
        assert.ok(calls.length > 0);
        assert.doesNotMatch(JSON.stringify(calls), /attacker|"other"/);
        if (scenario === "user") assert.match(JSON.stringify(calls), /"appUserId":"self"/);
      }
    });
  }
}
for (const key of ["helper_instance_id", "helper_heartbeat_at", "helper_expires_at", "helper_stopping_at", "authenticated_instance_id", "authenticated_at", "id", "app_user_id"]) {
  test(`generic store rejects ${key} before database access`, async () => {
    const store = load("lib/mediref/hybrid-session-store.ts", {
      "server-only": {}, "next/headers": {}, "@supabase/ssr": {},
      "@/lib/supabase/admin": { supabaseAdmin: { from: () => { throw new Error("Database must not be called"); } } },
    });
    await assert.rejects(store.updateMedirefSession({ scope: "practice" }, { [key]: "secret" }), /^Error: Invalid MediRef session update field\.$/);
  });
}
test("account-status errors fail closed without raw logging when requested", async () => {
  const mod = load("lib/getUserStatus.ts", { "@supabase/supabase-js": { createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ error: { message: "PRIVATE" } }) }) }) }) }) } });
  assert.equal(await mod.getUserStatus("self", { failClosed: true }), false);
});
test("generic store preserves legitimate updates and enforces session ownership filters", async () => {
  const writes: unknown[] = []; const filters: unknown[] = [];
  const chain = {
    select: () => chain,
    eq: (...args: unknown[]) => { filters.push(args); return chain; },
    is: (...args: unknown[]) => { filters.push(args); return chain; },
    maybeSingle: async () => ({ data: { id: "fixture", scope: "user", app_user_id: "self" } }),
    update: (values: unknown) => { writes.push(values); return chain; },
  };
  const store = load("lib/mediref/hybrid-session-store.ts", {
    "server-only": {}, "next/headers": {}, "@supabase/ssr": {},
    "@/lib/supabase/admin": { supabaseAdmin: { from: () => chain } },
  });
  const values = { status: "refresh_requested", message: "fixture", pending_mediref_email: "fixture@example.invalid", pending_mediref_password: "fixture", credentials_updated_at: null, mfa_code: "123456", mfa_code_updated_at: null, refresh_requested_at: null, current_url: null, cookie: "fixture", refreshed_at: null, last_used_at: null };
  await store.updateMedirefSession({ scope: "user", appUserId: "self" }, values);
  assert.equal(writes.length, 1);
  const { updated_at, ...written } = writes[0] as typeof values & { updated_at: string };
  assert.deepEqual(written, values); assert.ok(Number.isFinite(Date.parse(updated_at)));
  assert.ok(filters.some(value => JSON.stringify(value) === '["app_user_id","self"]'));
});
