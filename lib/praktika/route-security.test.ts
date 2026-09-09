import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

async function declarations(path: string) {
  const source = await readFile(new URL("../../" + path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  return ts.transpileModule(ast.statements.filter(n => ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n))
    .map(n => n.getText(ast).replace(/^export /, "")).join("\n"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
}
async function handler(path: string, method: string, user: string | null, role = "typist", extras: Record<string, unknown> = {}) {
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { assert.equal(key, "user_id"); assert.equal(value, user); return query; },
    maybeSingle: async () => ({ data: { role }, error: null }),
  };
  const context = {
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) }, from: () => query }),
    URL, console, File,
    NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status || 200 }) },
    ...extras,
  };
  return runInNewContext(await declarations("lib/auth.ts") + "\n" + await declarations(path) + "\n" + method, context);
}
const request = (method = "GET", body: unknown = {}, search = "") => {
  const req = new Request("https://fixture.invalid/api" + search, method === "POST" ? { method, body: JSON.stringify(body) } : undefined);
  return Object.assign(req, { nextUrl: new URL(req.url) });
};
const inboxRoutes = [
  "praktika/patient-filing/inbox-item", "ai/bulk-document-filing/list",
  "ai/bulk-document-filing/select-patient", "ai/bulk-document-filing/file-selected",
  "ai/brain/praktika/confirm-match",
];
for (const route of [...inboxRoutes, "praktika/patient-filing/test", "praktika/patient-search", "praktika/sync-patients", "automation/helper-jobs"]) {
  const method = route.endsWith("list") || route.endsWith("search") || route.endsWith("sync-patients") || route.endsWith("helper-jobs") ? "GET" : "POST";
  test(`${route}: anonymous denied before data access or work`, async () => {
    const fn = await handler(`app/api/${route}/route.ts`, method, null);
    assert.equal((await fn(request(method, { inboxItemId: "other-object" }))).status, 401);
  });
}
for (const route of inboxRoutes) {
  const method = route.endsWith("list") ? "GET" : "POST";
  test(`${route}: unrelated authenticated caller cannot elevate with object/user/role claims`, async () => {
    const fn = await handler(`app/api/${route}/route.ts`, method, "user-a");
    assert.equal((await fn(request(method, { inboxItemId: "other-object", app_user_id: "owner", role: "super_admin" }))).status, 403);
  });
}
for (const route of ["patient-search", "sync-patients"]) {
  test(`${route}: authenticated shared cache search works without a role restriction`, async () => {
    const query = { select: () => query, limit: () => query, or: () => query, order: () => query,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }) };
    const fn = await handler(`app/api/praktika/${route}/route.ts`, "GET", "user-a", "typist", { supabaseAdmin: { from: (table: string) => { assert.equal(table, "praktika_patients"); return query; } } });
    const result = await fn(request("GET", {}, "?q=synthetic&role=super_admin&app_user_id=other"));
    assert.equal(result.status, 200);
    assert.equal(result.body.patients.length, 0);
  });
}
test("already-filed shortcut is reached only after global inbox authorization", async () => {
  let calls = 0;
  const extras = { autoFileInboxItemToPraktika: async () => { calls++; return { ok: true, skipped: true, existingResult: { synthetic: true } }; } };
  for (const role of ["typist", "admin", "super_admin"]) {
    const fn = await handler("app/api/praktika/patient-filing/inbox-item/route.ts", "POST", "user-a", role, extras);
    const result = await fn(request("POST", { inboxItemId: "synthetic-inbox" }));
    assert.equal(result.status, role === "super_admin" ? 200 : 403);
  }
  assert.equal(calls, 1);
});
for (const role of ["typist", "admin", "super_admin"]) {
  test(`helper jobs: ${role} receives permitted scope in both systems and no raw errors`, async () => {
    const filters: string[][] = [];
    const selections: string[] = [];
    const admin = { from: (table: string) => {
      const query = {
        select: (columns: string) => { selections.push(columns); return query; },
        eq: (column: string, value: string) => { filters.push([table, column, value]); return query; },
        order: () => query,
        limit: async () => ({ data: [{ id: "synthetic", status: "failed", created_at: "2026-01-01" }], error: null }),
      }; return query;
    } };
    const fn = await handler("app/api/automation/helper-jobs/route.ts", "GET", "user-a", role, { supabaseAdmin: admin });
    const result = await fn(request());
    assert.equal(result.status, 200);
    assert.equal(result.body.scope, role === "typist" ? "user" : "global");
    assert.equal(filters.length, role === "typist" ? 2 : 0);
    for (const [, column, value] of filters) { assert.equal(column, "app_user_id"); assert.equal(value, "user-a"); }
    assert.ok(selections.every(s => !/error|payload|request|response|result/.test(s)));
    assert.equal(result.body.jobs.length, 2);
    assert.ok(result.body.jobs.every((j: { error: string }) => j.error === "Job failed."));
    assert.equal((await fn(request("GET", {}, "?app_user_id=other"))).status, 403);
    if (role === "typist") assert.equal((await fn(request("GET", {}, "?scope=global&role=super_admin"))).status, 403);
  });
}
for (const route of inboxRoutes.filter(r => !r.endsWith("inbox-item"))) {
  test(`${route}: super_admin retains global inbox access before existing filing workflow`, async () => {
    const calls: string[] = [];
    const query = {
      select: () => query, update: () => query, insert: () => query, eq: () => query,
      order: async () => ({ data: [], error: null }),
      single: async () => ({ data: { id: "synthetic-inbox" }, error: null }),
    };
    const fn = await handler(`app/api/${route}/route.ts`, route.endsWith("list") ? "GET" : "POST", "user-a", "super_admin", {
      supabaseAdmin: { from: (table: string) => { calls.push(table); return query; } },
      getCurrentUserPraktikaSessionMode: async () => ({ scope: "user", appUserId: "user-a" }),
      withPraktikaAutoRefresh: async (action: () => Promise<unknown>) => action(),
      autoFileInboxItemToPraktika: async () => { calls.push("file"); return { ok: true }; },
    });
    const method = route.endsWith("list") ? "GET" : "POST";
    const result = await fn(request(method, {
      inboxItemId: "synthetic-inbox", inboxItemIds: ["synthetic-inbox"], patientId: "synthetic-patient", patient: { id: "synthetic-patient" },
    }, "?batchId=synthetic-batch"));
    assert.equal(result.status, 200);
    assert.ok(calls.length > 0);
  });
}
test("missing inbox ID fails safely after authorization", async () => {
  const fn = await handler("app/api/praktika/patient-filing/inbox-item/route.ts", "POST", "user-a", "super_admin");
  assert.equal((await fn(request("POST"))).status, 400);
});
