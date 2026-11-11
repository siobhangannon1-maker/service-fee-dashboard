import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { calculateStatementCharges } from "../service-fees/statement-charge-totals";

const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function helper(rpc: (name: string, args: unknown) => unknown) {
  const exports: Record<string, any> = {};
  runInNewContext(compile(readFileSync("lib/billing/rollout-maintenance.ts", "utf8")), {
    exports, require: (name: string) => name === "server-only" ? {} : { supabaseAdmin: { rpc } },
  });
  return exports;
}
test("export guard fails closed on absent controls, maintenance and database failure", async () => {
  for (const code of ["P0001", "P0002", "42P01", "57014"]) {
    const module = helper(async () => ({ error: { code }, data: null }));
    await assert.rejects(module.beginBillingExport("synthetic"), (error: any) => error.status === 503);
  }
});
test("maintenance administration rejects unauthenticated, inactive and non-admin users", async () => {
  class ApiAuthorizationError extends Error { constructor(public status: number) { super("Denied"); } }
  for (const status of [401, 403]) {
    const exports: Record<string, any> = {};
    runInNewContext(compile(readFileSync("app/api/billing/maintenance/route.ts", "utf8")), {
      exports,
      require: (name: string) => {
        if (name === "next/server") return { NextResponse: { json: Response.json } };
        if (name === "@/lib/auth") return { ApiAuthorizationError, requireActiveApiUser: async (roles: string[]) => { assert.equal(roles.join(","), "admin,super_admin"); throw new ApiAuthorizationError(status); } };
        return { supabaseAdmin: { rpc: () => { throw new Error("Database should not be called"); } } };
      },
    });
    assert.equal((await exports.GET()).status, status);
    assert.equal((await exports.POST({ json: () => { throw new Error("Body should not be read"); } })).status, status);
  }
});
test("July hold has an explicit non-replacement error and cannot be bypassed by retry", async () => {
  const module = helper(async () => ({ error: { code: "P0002", message: "July 2026 exports are held" } }));
  for (let i = 0; i < 2; i++) await assert.rejects(module.beginBillingExport("july"), (e: any) => e.status === 409 && e.message.includes("INV-0507") && e.message.includes("INV-0505"));
});
test("successful export registration and finish retain the same request ID", async () => {
  const calls: string[] = [];
  const module = helper(async (name, args) => { calls.push(name + JSON.stringify(args)); return { data: name === "begin_billing_export" ? "request-id" : null }; });
  const id = await module.beginBillingExport("period-id");
  await module.finishBillingExport(id);
  assert.equal(id, "request-id");
  assert.ok(calls[1].includes('"p_request":"request-id"'));
});
test("failed completion cannot silently certify maintenance drain", async () => {
  const module = helper(async () => ({ error: { code: "57014" } }));
  await assert.rejects(module.finishBillingExport("request-id"), /administrator review/);
});
test("billing handler rejects maintenance and July before touching Xero or invoice runs", async () => {
  const source = ts.createSourceFile("route.ts", readFileSync("app/api/xero/create-service-fee-invoices/route.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const handler = source.statements.filter(ts.isFunctionDeclaration).find(n => n.name?.text === "POST")!.getText(source).replace(/^export /, "");
  class BillingRolloutError extends Error { constructor(public status: number) { super("Held"); } }
  for (const status of [503, 409]) {
    let registrations = 0;
    const POST = runInNewContext(compile(handler) + "\nPOST", {
      calculateStatementCharges,
      sensitiveApiAccess: async () => null, NextResponse: { json: Response.json }, BillingRolloutError,
      beginBillingExport: async () => { registrations++; throw new BillingRolloutError(status); },
      supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: "period", year: 2026, month: 7 } }) }) }) }) },
    });
    const response = await POST({ json: async () => ({ billingPeriodId: "period", providers: [{ providerId: "provider" }] }) });
    assert.equal(response.status, status);
    assert.equal(registrations, 1);
    // No Xero/PDF/run helpers supplied: any accidental use would fail this test.
  }
});
