import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const read = (path: string) => readFile(new URL("../../" + path, import.meta.url), "utf8");
async function declarations(path: string, names: string[]) {
  const source = await read(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return ts.transpileModule(ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && names.includes(node.name?.text || "")
  ).map(node => node.getText(ast).replace(/^export /, "")).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}
async function auth(user: string | null, role = "typist") {
  const code = await declarations("lib/praktika/session-authorization.ts", ["PraktikaSessionAuthorizationError", "authorizePraktikaSession"]);
  const client = {
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) },
    from: (table: string) => {
      assert.equal(table, "user_roles");
      return { select: () => ({ eq: (column: string, value: string) => {
        assert.equal(column, "user_id"); assert.equal(value, user);
        return { maybeSingle: async () => ({ data: { role }, error: null }) };
      } }) };
    },
  };
  return runInNewContext(code + "\n({authorizePraktikaSession, PraktikaSessionAuthorizationError})", {
    createClient: async () => client,
  });
}
test("identity and practice scope come from verified user and database role", async () => {
  const anonymous = await auth(null);
  await assert.rejects(anonymous.authorizePraktikaSession(), { status: 401 });
  const own = await auth("user-a");
  assert.equal((await own.authorizePraktikaSession()).appUserId, "user-a");
  assert.equal((await own.authorizePraktikaSession({ app_user_id: "user-a" })).appUserId, "user-a");
  await assert.rejects(own.authorizePraktikaSession({ app_user_id: "user-b" }), { status: 403 });
  await assert.rejects(own.authorizePraktikaSession({ scope: "practice", role: "super_admin" }), { status: 403 });
  for (const input of [null, [], { scope: "unknown" }, { scope: "" }, { sessionId: "" }, { session_id: "another" }, { appUserId: 12 }]) {
    await assert.rejects(own.authorizePraktikaSession(input), { status: 400 });
  }
  const admin = await auth("admin", "super_admin");
  assert.equal((await admin.authorizePraktikaSession({ scope: "practice" })).scope, "practice");
});
for (const [route, method] of [["status", "GET"], ["refresh", "POST"], ["credentials", "POST"], ["mfa-code", "POST"], ["validate", "POST"]] as const) {
  test(route + ": rejects anonymous before any privileged operation", async () => {
    const helpers = await auth(null);
    const code = await declarations("app/api/praktika/session/" + route + "/route.ts", [method]);
    const handler = runInNewContext(code + "\n" + method, {
      ...helpers, URL, NextResponse: { json: (body: unknown, init: { status: number }) => ({ body, status: init.status }) },
    });
    const request = new Request("https://fixture.invalid/api?scope=practice", method === "POST" ? {
      method, body: JSON.stringify({ scope: "practice", username: "synthetic", password: "synthetic", code: "000000" }),
    } : undefined);
    assert.equal((await handler(request)).status, 401);
  });
}
test("refresh/MFA own and authorized practice modes reach only resolved session", async () => {
  for (const route of ["refresh", "mfa-code"]) {
    for (const scope of ["user", "practice"]) {
      const helpers = await auth("user-a", scope === "practice" ? "super_admin" : "typist");
      let target: { scope: string; appUserId?: string } | undefined;
      const handler = runInNewContext(await declarations("app/api/praktika/session/" + route + "/route.ts", ["POST"]) + "\nPOST", {
        ...helpers,
        NextResponse: { json: (body: unknown) => body },
        getPraktikaSession: async (mode: typeof target) => { target = mode; return { status: "not_started" }; },
        derivePraktikaConnection: () => ({ connected: false }),
        markPraktikaRefreshRequested: async (mode: typeof target) => { target = mode; },
        savePraktikaMfaCode: async ({ mode }: { mode: typeof target }) => { target = mode; },
      });
      await handler(new Request("https://fixture.invalid/api", { method: "POST", body: JSON.stringify({ scope, code: "000000" }) }));
      assert.equal(target?.scope, scope);
      assert.equal(target?.appUserId, scope === "user" ? "user-a" : undefined);
    }
  }
});
test("hydration selectors cannot choose another user's recently updated session", async () => {
  for (const route of ["hydrate-letter-queue", "letter-queue/sync-praktika"]) {
    const calls: unknown[][] = [];
    const query = {
      select: () => query, eq: (...args: unknown[]) => { calls.push(args); return query; },
      in: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: { app_user_id: "user-a" }, error: null }),
    };
    const fn = runInNewContext(await declarations("app/api/report-writing/" + route + "/route.ts", ["getHydrationAppUserId"]) + "\ngetHydrationAppUserId", {
      authorizePraktikaSession: async () => ({ scope: "user", appUserId: "user-a" }),
      supabase: { from: () => query }, clean: (value: unknown) => String(value || ""), console,
    });
    assert.equal(await fn(), "user-a");
    assert.ok(calls.some(([column, value]) => column === "app_user_id" && value === "user-a"));
  }
});
test("every session route rejects cross-user targeting before reaching service-role operations", async () => {
  for (const [route, method] of [["status", "GET"], ["refresh", "POST"], ["credentials", "POST"], ["mfa-code", "POST"], ["validate", "POST"]]) {
    const helpers = await auth("user-a");
    const handler = runInNewContext(await declarations("app/api/praktika/session/" + route + "/route.ts", [method]) + "\n" + method, {
      ...helpers, URL, NextResponse: { json: (body: unknown, init: { status: number }) => ({ body, status: init.status }) },
    });
    const input = { scope: "user", app_user_id: "user-b", username: "synthetic", password: "synthetic", code: "000000" };
    const request = new Request("https://fixture.invalid/api?scope=user&app_user_id=user-b", method === "POST" ? {
      method, body: JSON.stringify(input),
    } : undefined);
    assert.equal((await handler(request)).status, 403);
  }
});
test("credential submission selects and updates only caller-owned row", async () => {
  const helpers = await auth("user-a");
  const filters: unknown[][] = [];
  let updated = false;
  const query = {
    select: () => query, eq: (...args: unknown[]) => { filters.push(args); return query; },
    maybeSingle: async () => ({ data: { id: "owned-session" }, error: null }),
    update: () => { updated = true; return query; },
  };
  const handler = runInNewContext(await declarations("app/api/praktika/session/credentials/route.ts", ["POST"]) + "\nPOST", {
    ...helpers, NextResponse: { json: (body: unknown) => body }, supabaseAdmin: { from: () => query },
  });
  const result = await handler(new Request("https://fixture.invalid/api", {
    method: "POST", body: JSON.stringify({ username: "synthetic", password: "synthetic" }),
  }));
  assert.equal(result.success, true);
  assert.equal(updated, true);
  assert.ok(filters.some(([key, value]) => key === "app_user_id" && value === "user-a"));
  assert.ok(filters.some(([key, value]) => key === "id" && value === "owned-session"));
});
