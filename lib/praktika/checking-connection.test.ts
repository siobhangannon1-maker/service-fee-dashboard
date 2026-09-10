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
  assert.equal(currentStatus(null, now), "loading");
  assert.equal(currentStatus(data, now), "connected");
  assert.equal(currentStatus({ ...data, helperHeartbeatAt: new Date(now+120000).toISOString() }, now+120000), "checking_connection");
  assert.equal(currentStatus(data, now+90000), "not_started");
  assert.equal(currentStatus({ status: "not_started" }, now), "not_started");
});

test("same-origin 307 preserves proof, shows checking after proof expiry, and later 200 recovers; login and MFA remain explicit", async () => {
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
    assert.equal(derived.authenticationVerified, false);
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
  let operations = 0, verified = false, challenged = false;
  const permanent: boolean[] = [];
  const process = runInNewContext(code + "\nprocessOnePraktikaHelperJob", {
    PraktikaAuthenticationUnverified, PraktikaOwnershipLost, console: { log() {}, error() {} },
    claimNextJob: async () => ({ id: "synthetic", job_type: "synthetic", request: {} }),
    failJob: async (_j: unknown, _m: unknown, force: boolean) => { permanent.push(force); },
    runPraktikaRequest: async () => { operations++; return {}; }, completeJob: async () => {}, markSessionConnectedForJob: async () => {},
  });
  const ownership = { assertOwned: async () => {}, ensureAuthenticated: async () => { if (challenged) throw new PraktikaAuthenticationUnverified("waiting_for_credentials"); if (!verified) throw new PraktikaAuthenticationUnverified("error", true); } };
  assert.equal((await process({}, "user", ownership)).outcome, "failed");
  assert.deepEqual(permanent, [false]); assert.equal(operations, 0);
  verified = true;
  assert.equal((await process({}, "user", ownership)).outcome, "completed");
  assert.equal(operations, 1);
  challenged = true;
  assert.equal((await process({}, "user", ownership)).outcome, "needs_reconnect");
  assert.equal(operations, 1);
  assert.deepEqual(permanent, [false, true]);
});

test("credential UI is limited to explicit credentials state", () => {
  const popup = readFileSync("components/report-writing/PraktikaToolsPopup.tsx", "utf8");
  assert.match(popup, /currentStatus === "waiting_for_credentials" \|\|/);
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
  assert.equal(connectionLabel(connectionState("checking_connection", false)), "Checking connection");
  assert.equal(connectionLabel(connectionState("loading", false)), "Loading…");
  assert.equal(connectionLabel(connectionState("connected", false)), "Connected");
  assert.match(source, /\["disconnected", "idle"\]\.includes\(currentConnectionState\) && currentStatus !== "waiting_for_mfa" && !shouldShowCredentialForm/);
  for (const status of ["checking_connection", "loading", "refreshing", "connected"]) {
    assert.equal(["disconnected", "idle"].includes(connectionState(status, false)), false);
  }
 });

for (const failure of ["redirect", "http500", "timeout", "network"] as const) {
  test(`${failure}: stale GST proof shows checking without false Connected; JIT remains blocked`, async () => {
    const now = Date.now();
    const row = { status: "connected", helper_instance_id: "owner", helper_heartbeat_at: new Date(now).toISOString(), authenticated_at: new Date(now - 180000).toISOString() };
    const proof = row.authenticated_at;
    let writes = 0;
    const context = { request: { post: async (url: string) => {
      if (failure === "timeout" || failure === "network") throw new Error(failure === "timeout" ? "Timeout 10000ms exceeded" : "ECONNRESET");
      return { url: () => url, status: () => failure === "redirect" ? 307 : 500, ok: () => false,
        headers: () => ({ location: "/temporary" }), body: async () => Buffer.from(""), dispose: async () => {} };
    } } } as unknown as BrowserContext;
    const gate = createPraktikaAuthenticationGate({ assertOwned: async () => {}, readOwnedSession: async () => row,
      probe: () => probePraktikaAuthentication(context, "42", "https://fixture.invalid"),
      recordSuccess: async () => { writes++; }, recordFailure: async () => { writes++; },
    });
    await assert.rejects(gate.renew(), { transient: true });
    await assert.rejects(gate(), { transient: true });
    assert.equal(writes, 0);
    assert.equal(row.authenticated_at, proof);
    const state = derivePraktikaConnection(row, now);
    assert.equal(state.connected, false);
    assert.equal(state.authenticationVerified, false);
    assert.equal(currentStatus({ ...state, helperHeartbeatAt: row.helper_heartbeat_at, authenticatedAt: proof }, now), "checking_connection");
  });
}

// Exercise the production function with the shared definition, not a particular
// spelling of its predicate. Both legacy and explicit-proof callers must fail closed.
for (const scenario of ["fresh", "missing-proof", "stale-proof", "stale-lease", "missing-owner", "credentials", "mfa", "error", "login-url", "old-refresh"] as const) {
  test(`legacy recovery uses shared authentication truth: ${scenario}`, async () => {
    const path = "lib/praktika/hybrid-seamless-request.ts";
    const source = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "waitForPraktikaConnected")!;
    const code = ts.transpileModule(fn.getText(ast).replace(/^export /, ""), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const now = Date.now(); let elapsed = 0; let reads = 0;
    const row = { status: "connected", cookie: "synthetic-cookie", helper_instance_id: "generation" as string | null,
      helper_heartbeat_at: new Date(now).toISOString(), authenticated_at: new Date(now).toISOString() as string | null,
      refreshed_at: new Date(now).toISOString(), current_url: "https://praktika.praktika.net.au/v2/scheduler" };
    if (scenario === "missing-proof") row.authenticated_at = null;
    if (scenario === "stale-proof") row.authenticated_at = new Date(0).toISOString();
    if (scenario === "stale-lease") row.helper_heartbeat_at = new Date(now - 90000).toISOString();
    if (scenario === "missing-owner") row.helper_instance_id = null;
    if (scenario === "credentials") row.status = "waiting_for_credentials";
    if (scenario === "mfa") row.status = "waiting_for_mfa";
    if (scenario === "error") row.status = "error";
    if (scenario === "login-url") row.current_url = "https://praktika.praktika.net.au/v2/login";
    if (scenario === "old-refresh") row.refreshed_at = new Date(0).toISOString();
    const before = JSON.stringify(row);
    class CredentialsRequired extends Error {}
    class MfaRequired extends Error {}
    class RefreshTimeout extends Error {}
    const mode = { scope: "user", appUserId: "synthetic-user" };
    const wait = runInNewContext(code + "\nwaitForPraktikaConnected", {
      Date: { now: () => now + elapsed },
      derivePraktikaConnection: (session: typeof row) => derivePraktikaConnection(session, now + elapsed),
      timeValue: (value: string) => Date.parse(value) || 0,
      getPraktikaSession: async (selectedMode: unknown) => { assert.equal(selectedMode, mode); reads++; return row; },
      sleep: async (ms: number) => { elapsed += ms; },
      PraktikaNeedsCredentialsError: CredentialsRequired,
      PraktikaNeedsMfaError: MfaRequired, PraktikaRefreshTimeoutError: RefreshTimeout,
    });
    const pending = wait(mode, { timeoutMs: 20, intervalMs: 10 }, new Date(now).toISOString());
    if (scenario === "fresh") assert.equal(await pending, "synthetic-cookie");
    else if (scenario === "credentials") await assert.rejects(pending, CredentialsRequired);
    else if (scenario === "mfa") await assert.rejects(pending, MfaRequired);
    else if (scenario === "error") await assert.rejects(pending, /Praktika refresh failed/);
    else await assert.rejects(pending, RefreshTimeout);
    assert.equal(JSON.stringify(row), before, "waiting must not manufacture proof or modify the session");
    assert.equal(reads, ["fresh", "credentials", "mfa", "error"].includes(scenario) ? 1 : 2);
  });
}

test("Checking budget is independent of continually renewed heartbeat and stale proof", async () => {
  const { createCheckingWindow, CHECKING_WINDOW_MS } = await import("./use-status-expiry");
  const window = createCheckingWindow(); const start = Date.now();
  for (let elapsed = 0; elapsed <= 90000; elapsed += 5000) {
    const status = currentStatus({ status: "checking_connection", helperAlive: true, helperHeartbeatAt: new Date(start + elapsed).toISOString() }, start + elapsed);
    assert.equal(window(status, start + elapsed).status, elapsed < CHECKING_WINDOW_MS ? "checking_connection" : "not_started");
  }
  assert.equal(window("connected", start + 90001).status, "connected");
  assert.equal(window("checking_connection", start + 90002).status, "checking_connection");
});

test("popup bounds live unverified checking, exposes Connect, and preserves login/MFA controls", async () => {
  const { chromium } = await import("playwright"); const { build } = await import("esbuild");
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Popup from './components/report-writing/PraktikaToolsPopup'; createRoot(document.getElementById('root')).render(<Popup open={true}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.clock.install();
    let status = "checking_connection";
    await page.route("**/*", async route => {
      if (new URL(route.request().url()).pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      assert.equal(new URL(route.request().url()).search, "?scope=user");
      const now = await page.evaluate(() => Date.now());
      return route.fulfill({ json: { status, connected: status === "connected", helperAlive: true, helperHeartbeatAt: new Date(now).toISOString(), authenticatedAt: status === "connected" ? new Date(now).toISOString() : null } });
    });
    await page.goto("http://praktika-ui.test/"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("Praktika: Checking connection", { exact: true }).waitFor();
    for (let n = 0; n < 7; n++) { await page.clock.runFor(5000); await page.waitForTimeout(20); }
    await page.getByText("Praktika: Not connected", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).isVisible(), true);
    for (const state of ["not_started", "error", "waiting_for_credentials", "waiting_for_mfa", "connected"]) {
      status = state; await page.clock.runFor(5000); await page.waitForTimeout(20);
      if (state === "connected") await page.getByText("Praktika: Connected", { exact: true }).waitFor();
      else if (state === "waiting_for_credentials") assert.equal(await page.locator('input[type="password"]').isVisible(), true);
      else if (state === "waiting_for_mfa") await page.getByText("Praktika: MFA required", { exact: true }).waitFor();
      else assert.equal(await page.getByRole("button", { name: "Connect", exact: true }).isVisible(), true);
    }
  } finally { await browser.close(); }
});
