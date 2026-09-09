import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { BrowserContext } from "playwright";
import { derivePraktikaConnection } from "./authentication";
import { createPraktikaAuthenticationGate, probePraktikaAuthentication, PraktikaAuthenticationUnverified } from "./authentication-probe";
import { currentStatus } from "./use-status-expiry";
import { PraktikaOwnershipLost } from "./helper-lease";

test("unknown, cached fresh proof, proof expiry, and lease expiry have distinct UI states", () => {
  const now = Date.now();
  const data = { status: "connected", connected: true, authenticatedAt: new Date(now).toISOString(), helperHeartbeatAt: new Date(now).toISOString() };
  assert.equal(currentStatus(null, now), "checking_connection");
  assert.equal(currentStatus(data, now), "connected");
  assert.equal(currentStatus({ ...data, helperHeartbeatAt: new Date(now+120000).toISOString() }, now+120000), "checking_connection");
  assert.equal(currentStatus(data, now+90000), "not_started");
  assert.equal(currentStatus({ status: "not_started" }, now), "not_started");
});

test("same-origin 307 preserves proof, expires to Connection issue, and later 200 recovers; login and MFA remain explicit", async () => {
  const now = Date.now();
  const row = { status: "connected", helper_instance_id: "owner", helper_heartbeat_at: new Date(now).toISOString(), authenticated_at: new Date(now).toISOString() as string | null };
  let responseStatus = 307, location = "/temporary", body = "[]", writes = 0;
  const context = { request: { post: async (url: string, options: { maxRedirects: number }) => {
    assert.equal(options.maxRedirects, 0);
    return { url: () => url, status: () => responseStatus, ok: () => responseStatus === 200,
      headers: () => ({ location }), body: async () => Buffer.from(body), dispose: async () => {} };
  } } } as unknown as BrowserContext;
  const gate = createPraktikaAuthenticationGate({ assertOwned: async () => {}, readOwnedSession: async () => row,
    probe: () => probePraktikaAuthentication(context, "42", "https://fixture.invalid"),
    recordSuccess: async () => { writes++; row.authenticated_at = new Date().toISOString(); row.status = "connected"; },
    recordFailure: async phase => { row.authenticated_at = null; row.status = phase; },
  });
  const proof = row.authenticated_at;
  await assert.rejects(gate.renew(), { transient: true });
  assert.equal(row.authenticated_at, proof); assert.equal(writes, 0);
  assert.equal(derivePraktikaConnection(row, now).status, "connected");
  assert.equal(derivePraktikaConnection({ ...row, helper_heartbeat_at: new Date(now+120000).toISOString() }, now+120000).status, "checking_connection");
  for (const age of [180000, 600000, 3600000]) {
    await assert.rejects(gate.renew(), { transient: true });
    assert.equal(row.authenticated_at, proof);
    const derived = derivePraktikaConnection({ ...row, helper_heartbeat_at: new Date(now + age).toISOString() }, now + age);
    assert.equal(derived.status, "checking_connection");
    assert.equal(derived.message, "Connection issue");
    assert.equal(derived.connected, false);
  }
  row.authenticated_at = null;
  await assert.rejects(gate(), { transient: true });
  assert.equal(row.status, "connected");
  responseStatus = 200; await gate(); assert.equal(writes, 1);
  assert.equal(derivePraktikaConnection(row).connected, true);
  responseStatus = 307; location = "/v2/login";
  await assert.rejects(gate.renew(), { phase: "waiting_for_credentials", transient: false });
  assert.equal(row.authenticated_at, null); assert.equal(row.status, "waiting_for_credentials");
  responseStatus = 200; body = '<input autocomplete="one-time-code">';
  await assert.rejects(gate(), { phase: "waiting_for_mfa" });
  assert.equal(row.status, "waiting_for_mfa");
});

test("processor retries transient verification before any external operation; later verified attempt executes", async () => {
  const path = "scripts/praktika-helper-job-processor.ts";
  const source = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "processOnePraktikaHelperJob")!;
  const code = ts.transpileModule(declaration.getText(ast).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let operations = 0, verified = false;
  const permanent: boolean[] = [];
  const process = runInNewContext(code + "\nprocessOnePraktikaHelperJob", {
    PraktikaAuthenticationUnverified, PraktikaOwnershipLost, console: { log() {}, error() {} },
    claimNextJob: async () => ({ id: "synthetic", job_type: "synthetic", request: {} }),
    failJob: async (_j: unknown, _m: unknown, force: boolean) => { permanent.push(force); },
    runPraktikaRequest: async () => { operations++; return {}; }, completeJob: async () => {}, markSessionConnectedForJob: async () => {},
  });
  const ownership = { assertOwned: async () => {}, ensureAuthenticated: async () => { if (!verified) throw new PraktikaAuthenticationUnverified("error", true); } };
  assert.equal((await process({}, "user", ownership)).outcome, "failed");
  assert.deepEqual(permanent, [false]); assert.equal(operations, 0);
  verified = true;
  assert.equal((await process({}, "user", ownership)).outcome, "completed");
  assert.equal(operations, 1);
});

test("credential UI is limited to explicit credentials state", () => {
  const popup = readFileSync("components/report-writing/PraktikaToolsPopup.tsx", "utf8");
  assert.match(popup, /const shouldShowCredentialForm = currentStatus === "waiting_for_credentials";/);
  const panel = readFileSync("components/PraktikaSessionPanel.tsx", "utf8");
  assert.match(panel, /const showCredentials = scope === "user" && state.status === "waiting_for_credentials";/);
  const compact = readFileSync("components/PraktikaCompactSessionPanel.tsx", "utf8");
  assert.match(compact, /function needsLogin\(status: SessionStatus\) \{ return status === "waiting_for_credentials"; \}/);
});

 test("popup distinguishes unknown loading and connection issue, and hides Connect while recoverable", () => {
  const source = readFileSync("components/report-writing/PraktikaToolsPopup.tsx", "utf8");
  const ast = ts.createSourceFile("popup.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ["connectionState", "connectionLabel"].includes(n.name?.text || ""));
  const code = ts.transpileModule(declarations.map(n => n.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const { connectionState, connectionLabel } = runInNewContext(code + "\n({connectionState, connectionLabel})");
  assert.equal(connectionLabel(connectionState("checking_connection", false)), "Connection issue");
  assert.equal(connectionLabel(connectionState("loading", false)), "Loading status…");
  assert.equal(connectionLabel(connectionState("connected", false)), "Connected");
  assert.match(source, /\["disconnected", "idle"\]\.includes\(currentConnectionState\) && currentStatus !== "waiting_for_mfa" && !shouldShowCredentialForm/);
  for (const status of ["checking_connection", "loading", "refreshing", "connected"]) {
    assert.equal(["disconnected", "idle"].includes(connectionState(status, false)), false);
  }
 });
