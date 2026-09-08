import assert from "node:assert/strict";
import { test } from "node:test";
import { safeToolsStatus } from "./tools-status";

test("status projection excludes secrets, patient data, URLs and raw errors", () => {
  const privateValue = "private-patient-marker";
  const data = safeToolsStatus({ status: "connected", message: privateValue, cookie: privateValue, current_url: privateValue, mediref_email: privateValue },
    { status: "failed", job_type: "send_mediref_letter", error: privateValue, payload: privateValue, result: privateValue });
  assert.ok(!JSON.stringify(data).includes(privateValue));
  assert.deepEqual(Object.keys(data.session).sort(), ["status", "message", "refreshedAt", "lastUsedAt", "updatedAt"].sort());
  assert.deepEqual(Object.keys(data.latestJob!).sort(), ["status", "jobType", "error", "createdAt", "updatedAt"].sort());
  assert.equal(data.failureStage, null);
});
test("only fixed DOB error is preserved and missing status is unknown", () => {
  const error = "Unable to enter patient DOB in MediRef date control";
  assert.equal(safeToolsStatus(null, { status: "failed", error }).latestJob?.error, error);
  assert.equal(safeToolsStatus(null, null).session.status, "unknown");
});

test("Tools modal loads, refreshes and reconnects through the existing practice API", async () => {
  const { chromium } = await import("playwright");
  const { build } = await import("esbuild");
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MedirefToolsButton} from './app/(protected)/report-writing/history/MedirefToolsButton'; createRoot(document.getElementById('root')).render(<MedirefToolsButton/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let reads = 0; const reconnectBodies: unknown[] = [];
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (path === "/api/report-writing/mediref-tools/status") {
        reads++;
        return route.fulfill({ json: safeToolsStatus({ status: "connected" }, null) });
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
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
  } finally { await browser.close(); }
});
