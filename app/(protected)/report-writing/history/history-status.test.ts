import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

test("History refreshes only on focus (after a gap) or on request, shows Retry, and retains Praktika success", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import History from './app/(protected)/report-writing/history/page'; createRoot(document.getElementById('root')).render(<History/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    let failed = false; let unavailable = false; let reads = 0; let retryChecks = 0;
    let hold: Promise<void> | null = null;
    const methods: string[] = [];
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      methods.push(route.request().method());
      if (path === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (path.endsWith("/get-providers")) return route.fulfill({ json: { success: true, providers: [] } });
      if (path.endsWith("/get-drafts")) {
        reads++;
        if (hold) await hold;
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
      if (path.endsWith("/retry-mediref")) { retryChecks++; return route.fulfill({ json: { eligible: true, warning: "Fixture confirmation" } }); }
      return route.abort();
    });
    await page.goto("http://history-status.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const settle = () => page.waitForTimeout(300);
    await page.getByText("MediRef: Queued", { exact: true }).waitFor();
    assert.equal(reads, 1);
    assert.equal(await page.getByRole("button", { name: "Retry MediRef", exact: true }).count(), 0);
    failed = true;
    // No timed polling: ten minutes on an open, visible tab must not reload the list.
    await page.clock.runFor(10 * 60_000);
    await settle();
    assert.equal(reads, 1);
    assert.equal(await page.getByText("MediRef: Queued", { exact: true }).count(), 1);
    // Returning to the tab after the minimum gap reloads once.
    await focus();
    await page.getByText("MediRef: Failed", { exact: true }).waitFor();
    assert.equal(reads, 2);
    await page.getByText("MediRef send failed", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Retry MediRef", exact: true }).waitFor();
    // Rendering the button must not contact the server; only a click checks eligibility.
    assert.equal(retryChecks, 0);
    let confirmation = "";
    page.once("dialog", (dialog) => { confirmation = dialog.message(); void dialog.dismiss(); });
    await page.getByRole("button", { name: "Retry MediRef", exact: true }).click();
    await page.getByRole("button", { name: "Retry MediRef", exact: true }).waitFor();
    assert.equal(retryChecks, 1);
    assert.equal(confirmation, "Fixture confirmation");
    assert.equal(await page.getByText(/Uploaded:/).count(), 1);
    assert.equal(await page.getByText(/Icon updated:/).count(), 1);
    // Focus again within the gap: no reload.
    await page.clock.runFor(60_000);
    await focus();
    await settle();
    assert.equal(reads, 2);
    // The Refresh button always reloads, even within the gap.
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/get-drafts"));
    assert.equal(reads, 3);
    // Never start a reload while one is still running: hold the next response open.
    let release = () => {};
    hold = new Promise<void>((resolve) => { release = resolve; });
    await page.clock.runFor(4 * 60_000);
    await focus();
    await settle();
    assert.equal(reads, 4);
    await focus();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await settle();
    assert.equal(reads, 4);
    hold = null;
    release();
    await settle();
    // After the gap, a failed reload keeps the displayed rows and explains why.
    unavailable = true;
    await page.clock.runFor(4 * 60_000);
    await focus();
    await page.getByText("Unable to refresh History. Displayed workflow statuses may be out of date.", { exact: true }).waitFor();
    assert.equal(reads, 5);
    assert.equal(await page.getByText("MediRef: Failed", { exact: true }).count(), 1);
    assert.ok(methods.every((method) => method === "GET"));
  } finally { await browser.close(); }
});

test("History loads page 1, appends on Load more, and restarts from page 1 on search", async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import History from './app/(protected)/report-writing/history/page'; createRoot(document.getElementById('root')).render(<History/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    const requests: URLSearchParams[] = [];
    const letter = (n: number) => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, patient_name: `Fixture Patient ${n}`,
      patient_dob: "1990-06-09", status: "draft", report_type: "consultation_report", created_at: `2026-11-${String(30 - n).padStart(2, "0")}T00:00:00Z` });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      if (url.pathname.endsWith("/get-providers")) return route.fulfill({ json: { success: true, providers: [] } });
      if (url.pathname.endsWith("/get-drafts")) {
        requests.push(url.searchParams);
        if (url.searchParams.get("q")) return route.fulfill({ json: { success: true, drafts: [letter(9)], nextCursor: null, counts: { activeQueueItems: 1, awaiting: 0 } } });
        if (url.searchParams.get("cursor")) return route.fulfill({ json: { success: true, drafts: [letter(2), letter(3)], nextCursor: null, counts: null } });
        return route.fulfill({ json: { success: true, drafts: [letter(1), letter(2)], nextCursor: "2026-11-28T00:00:00Z|x", counts: { activeQueueItems: 57, awaiting: 4 } } });
      }
      return route.abort();
    });
    await page.goto("http://history-pages.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("Fixture Patient 1", { exact: true }).waitFor();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].get("limit"), "100");
    assert.equal(requests[0].get("providerId"), "all");
    assert.equal(requests[0].get("cursor"), null);
    // Exact all-letter counts come from the server, not the loaded page.
    await page.getByText("57", { exact: true }).waitFor();
    // Load more appends the next page without duplicating rows.
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    await page.getByText("Fixture Patient 3", { exact: true }).waitFor();
    assert.equal(requests[1].get("cursor"), "2026-11-28T00:00:00Z|x");
    assert.equal(await page.getByText("Fixture Patient 2", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Load more", exact: true }).count(), 0);
    // Searching waits for typing to pause, then starts again from page 1 on the server.
    await page.getByRole("textbox").first().fill("Patient 9");
    await page.clock.runFor(500);
    await page.getByText("Fixture Patient 9", { exact: true }).waitFor();
    const searched = requests[requests.length - 1];
    assert.equal(searched.get("q"), "Patient 9");
    assert.equal(searched.get("cursor"), null);
    assert.equal(await page.getByText("Fixture Patient 1", { exact: true }).count(), 0);
    // The two workflow-based cards say plainly that they cover loaded letters only.
    assert.equal(await page.getByText("Loaded letters only", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Loaded letters only. Click to search all letters for issues.", { exact: true }).count(), 1);
    // The Issues card asks the server to search all letters, from page 1.
    const beforeIssues = requests.length;
    await page.getByRole("button", { name: /Workflow issues/ }).click();
    await page.waitForResponse((response) => new URL(response.url()).searchParams.get("status") === "issues");
    const issues = requests[requests.length - 1];
    assert.ok(requests.length > beforeIssues);
    assert.equal(issues.get("status"), "issues");
    assert.equal(issues.get("cursor"), null);
    assert.equal(issues.get("q"), "Patient 9");
  } finally { await browser.close(); }
});
