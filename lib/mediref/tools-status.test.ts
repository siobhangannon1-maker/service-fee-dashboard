import assert from "node:assert/strict";
import { test } from "node:test";
import { hasRecentMedirefAuthentication, safeToolsStatus } from "./tools-status";

test("status projection excludes secrets, patient data, URLs and raw errors", () => {
  const privateValue = "private-patient-marker";
  const data = safeToolsStatus({ status: "connected", message: privateValue, cookie: privateValue, current_url: privateValue, mediref_email: privateValue },
    { status: "failed", job_type: "send_mediref_letter", error: privateValue, payload: privateValue, result: privateValue });
  assert.ok(!JSON.stringify(data).includes(privateValue));
  assert.deepEqual(Object.keys(data.session).sort(), ["status", "message", "refreshedAt", "lastUsedAt", "updatedAt", "validForMs", "helperAlive"].sort());
  assert.deepEqual(Object.keys(data.latestJob!).sort(), ["status", "jobType", "error", "createdAt", "updatedAt"].sort());
  assert.equal(data.failureStage, null);
});
test("only fixed DOB error is preserved and missing status is unknown", () => {
  const error = "Unable to enter patient DOB in MediRef date control";
  assert.equal(safeToolsStatus(null, { status: "failed", error }).latestJob?.error, error);
  assert.equal(safeToolsStatus(null, null).session.status, "unknown");
});

test("connection status requires recent authentication, not cookies, credentials or generic activity", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  const evidence = { helper_instance_id: "owner", authenticated_instance_id: "owner", helper_heartbeat_at: "2026-09-08T12:00:00Z", helper_expires_at: "2026-09-08T12:02:00Z", authenticated_at: "2026-09-08T11:59:30Z" };
  for (const refreshed_at of [null, "invalid", "2026-09-08T11:55:00Z", "2026-09-08T12:01:00Z"]) {
    const session = { status: "connected", refreshed_at, cookie: "private", pending_mediref_password: "private", last_used_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
    assert.equal(hasRecentMedirefAuthentication(session, now), false);
    assert.equal(safeToolsStatus(session, null, now).session.status, "ready");
  }
  assert.equal(safeToolsStatus({ ...evidence, status: "connected", refreshed_at: "2026-09-08T11:59:30Z" }, null, now).session.status, "connected");
  for (const status of ["ready", "refreshing", "refresh_requested", "error", "expired", "waiting_for_credentials"]) {
    const session = { status, refreshed_at: "2026-09-08T11:59:30Z", cookie: "private" };
    assert.equal(hasRecentMedirefAuthentication(session, now), false);
    assert.equal(safeToolsStatus(session, null, now).session.status, status === "ready" ? "sleeping" : status === "refreshing" ? "not_started" : status);
  }
});

test("Tools modal loads, refreshes and reconnects through the existing practice API", async () => {
  const { chromium } = await import("playwright");
  const { build } = await import("esbuild");
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MedirefToolsButton} from './app/(protected)/report-writing/history/MedirefToolsButton'; createRoot(document.getElementById('root')).render(<MedirefToolsButton/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let sessionStatus = "connected";
    let reads = 0; const reconnectBodies: unknown[] = [];
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (path === "/api/report-writing/mediref-tools/status") {
        reads++;
        return route.fulfill({ json: safeToolsStatus({ status: sessionStatus, refreshed_at: new Date().toISOString(), helper_instance_id: "owner", authenticated_instance_id: "owner", helper_heartbeat_at: new Date().toISOString(), helper_expires_at: new Date(Date.now()+120000).toISOString(), authenticated_at: new Date().toISOString() }, null) });
      }
      if (path === "/api/mediref/session/refresh") {
        reconnectBodies.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      return route.abort();
    });
    await page.goto("http://mediref-tools.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("button", { name: "MediRef Tools", exact: true }).click();
    await page.getByText("Connection: Connected", { exact: true }).waitFor();
    assert.equal(reads, 1);
    await page.getByRole("button", { name: "Refresh Status" }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    assert.equal(reads, 2);
    await page.getByRole("button", { name: "Reconnect MediRef" }).click();
    await page.getByText("MediRef reconnect requested.", { exact: true }).waitFor();
    assert.deepEqual(reconnectBodies, [{ scope: "practice" }]);
    assert.equal(reads, 3);
    for (const [stored, label] of [["ready", "Sleeping"], ["refreshing", "Reconnecting"], ["error", "Error"], ["expired", "Needs reconnect"]]) {
      sessionStatus = stored;
      await page.getByRole("button", { name: "Refresh Status" }).click();
      await page.getByText(`Connection: ${label}`, { exact: true }).waitFor();
    }
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
  } finally { await browser.close(); }
});
