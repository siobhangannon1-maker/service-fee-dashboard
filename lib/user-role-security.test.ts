import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const read = (path: string) => readFile(new URL("../" + path, import.meta.url), "utf8");
const own = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
async function invoke(user: string | null, role: string, body: unknown, writeError = false, roleError = false) {
  const source = await read("app/api/admin/update-user-role/route.ts");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const code = ts.transpileModule(ast.statements.filter(ts.isFunctionDeclaration)
    .map(node => node.getText(ast).replace(/^export /, "")).join("\n"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
  const writes: unknown[] = [];
  let privilegedClientCreated = false;
  const handler = runInNewContext(code + "\nPOST", {
    process: { env: {} },
    NextResponse: { json: (body: unknown, init?: { status: number }) => ({ body, status: init?.status ?? 200 }) },
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) },
      from: (table: string) => {
        assert.equal(table, "user_roles");
        return { select: () => ({ eq: (key: string, value: string) => {
          assert.equal(key, "user_id"); assert.equal(value, user);
          return { single: async () => ({ data: { role }, error: roleError }) };
        } }) };
      },
    }),
    createAdminClient: () => {
      privilegedClientCreated = true;
      return { from: (table: string) => {
        assert.equal(table, "user_roles");
        return { upsert: async (value: unknown) => { writes.push(value); return { error: writeError }; } };
      } };
    },
  });
  const result = await handler(new Request("https://fixture.invalid", {
    method: "POST", body: JSON.stringify(body),
  }));
  return { result, writes, privilegedClientCreated };
}
test("anonymous role mutation rejected before privileged client", async () => {
  const r = await invoke(null, "super_admin", { user_id: own, role: "super_admin" });
  assert.equal(r.result.status, 401); assert.equal(r.privilegedClientCreated, false);
});
test("ordinary users cannot promote themselves or another user, including forged actor role", async () => {
  for (const role of ["staff", "typist", "practice_manager", "billing_staff", "provider_readonly"]) {
    for (const target of [own, other]) {
      const r = await invoke(own, role, { user_id: target, role: "super_admin", actorRole: "super_admin" });
      assert.equal(r.result.status, 403); assert.equal(r.privilegedClientCreated, false);
    }
  }
});
test("trusted admin and super_admin assignment uses privileged client", async () => {
  for (const role of ["admin", "super_admin"]) {
    const r = await invoke(own, role, { user_id: other, role: "staff" });
    assert.equal(r.result.status, 200);
    assert.equal(JSON.stringify(r.writes), JSON.stringify([{ user_id: other, role: "staff" }]));
  }
});
test("invalid targets/roles and failed role lookup fail closed", async () => {
  for (const body of [null, {}, { user_id: "invalid", role: "staff" }, { user_id: other, role: "owner" }]) {
    const r = await invoke(own, "super_admin", body);
    assert.equal(r.result.status, 400); assert.equal(r.privilegedClientCreated, false);
  }
  assert.equal((await invoke(own, "super_admin", { user_id: other, role: "staff" }, false, true)).result.status, 403);
  assert.equal((await invoke(own, "super_admin", { user_id: other, role: "staff" }, true)).result.status, 500);
});
test("migration contract removes client table/column writes, preserves SELECT and server writes (static only)", async () => {
  const sql = await read("supabase/migrations/202609090002_user_roles_server_only.sql");
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger\s+on table public.user_roles from public, anon, authenticated/i);
  assert.match(sql, /revoke insert \(%s\), update \(%s\), references \(%s\)/i);
  assert.match(sql, /has_column_privilege\('authenticated'/);
  assert.match(sql, /raise exception/);
  for (const name of ["insert", "update"]) assert.ok(sql.includes(`drop policy if exists "authenticated users can ${name} roles"`));
  assert.match(sql, /grant select, insert, update, delete on table public.user_roles to service_role/i);
  assert.doesNotMatch(sql, /revoke\s+(all|select)|drop policy.*read roles/i);
});
test("admin UI role mutation uses authorized route while role SELECT remains", async () => {
  const source = await read("app/(protected)/admin/users/UsersClient.tsx");
  const section = source.slice(source.indexOf("async function updateRole"), source.indexOf("async function updateName"));
  assert.ok(section.includes('/api/admin/update-user-role'));
  assert.doesNotMatch(section, /\.upsert\(/);
  assert.ok(source.includes('.select("user_id, role")'));
});
