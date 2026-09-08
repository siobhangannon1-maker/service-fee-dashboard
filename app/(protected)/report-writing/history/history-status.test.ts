import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("History refreshes background MediRef failure, shows Retry, and retains Praktika success", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import History from './app/(protected)/report-writing/history/page'; createRoot(document.getElementById('root')).render(<History/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    let failed = false; let unavailable = false; let reads = 0;
    const methods: string[] = [];
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      methods.push(route.request().method());
      if (path === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (path.endsWith("/get-providers")) return route.fulfill({ json: { success: true, providers: [] } });
      if (path.endsWith("/get-drafts")) {
        reads++;
        if (unavailable) return route.fulfill({ status: 500, json: { success: false } });
        return route.fulfill({ json: { success: true, drafts: [{
          id: "00000000-0000-0000-0000-000000000001", patient_name: "Fixture Patient", patient_dob: "1990-06-09",
          status: "approved", report_type: "consultation_report", created_at: "2026-09-01T00:00:00Z",
          workflow_status: failed ? "failed" : "running", workflow_mediref_status: failed ? "failed" : "pending",
          workflow_error: failed ? "Unable to enter patient DOB in MediRef date control" : null,
          workflow_praktika_upload_status: "completed", uploaded_to_praktika: true,
          uploaded_to_praktika_at: "2026-09-01T00:00:00Z", praktika_letter_icon_updated_at: "2026-09-01T00:00:00Z",
        }] } });
      }
      if (path.endsWith("/retry-mediref")) return route.fulfill({ json: { eligible: true, warning: "Fixture confirmation" } });
      return route.abort();
    });
    await page.goto("http://history-status.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("MediRef: Queued", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Retry MediRef", exact: true }).count(), 0);
    failed = true;
    await page.clock.runFor(10000);
    await page.getByText("MediRef: Failed", { exact: true }).waitFor();
    await page.getByText("MediRef send failed", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Retry MediRef", exact: true }).waitFor();
    assert.ok(reads >= 2);
    assert.equal(await page.getByText(/Uploaded:/).count(), 1);
    assert.equal(await page.getByText(/Icon updated:/).count(), 1);
    // Returning to the tab also obtains fresh state without waiting for the next interval.
    const beforeFocus = reads;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForResponse((response) => response.url().endsWith("/get-drafts"));
    assert.ok(reads > beforeFocus);
    unavailable = true;
    await page.clock.runFor(10000);
    await page.getByText("Unable to refresh History. Displayed workflow statuses may be out of date.", { exact: true }).waitFor();
    assert.equal(await page.getByText("MediRef: Failed", { exact: true }).count(), 1);
    assert.ok(methods.every((method) => method === "GET"));
  } finally { await browser.close(); }
});
