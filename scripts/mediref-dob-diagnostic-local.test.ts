import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { installDiagnosticRequestGuard, diagnosticProfilePath, fillDiagnosticName, loadDiagnosticInput, locateComposePage, LocalDiagnosticError } from "./mediref-dob-diagnostic-local";

test("local launcher rejects missing or relative private input before launch", async () => {
  for (const input of [undefined, "", "private.json"]) await assert.rejects(loadDiagnosticInput(input), /absolute private input path/);
});

test("private input errors contain neither values nor filenames", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dob-local-test-"));
  const file = path.join(directory, "PRIVATE-FILENAME.json");
  try {
    const valid = { patient: { firstName: "Fixture", lastName: "Only", dob: "1990-06-09" } };
    for (const contents of ["PRIVATE-BROKEN-JSON", JSON.stringify({ patient: { firstName: "PRIVATE" } }), JSON.stringify({ patient: { ...valid.patient, lastName: "" } }), JSON.stringify({ patient: { ...valid.patient, dob: "1990-02-31" } })]) {
      await writeFile(file, contents);
      await assert.rejects(loadDiagnosticInput(file), { message: "Unable to read valid private diagnostic input." });
    }
    await writeFile(file, JSON.stringify(valid));
    assert.deepEqual(await loadDiagnosticInput(file), valid);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("profile is dedicated and outside repository and worker profile", () => {
  const profile = diagnosticProfilePath("/Users/example", "/Users/example/project");
  assert.equal(profile, "/Users/example/.docudental/mediref-dob-diagnostic-profile");
  assert.ok(!profile.includes("mediref-browser-profiles"));
  assert.throws(() => diagnosticProfilePath("/Users/example", "/Users/example"), /outside the repository/);
});

test("local launcher imports only node, Playwright and the inert observer", async () => {
  const source = await readFile(new URL("./mediref-dob-diagnostic-local.ts", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map(match => match[1]);
  assert.ok(imports.every(name => name.startsWith("node:") || name === "playwright" || name === "./mediref-dob-diagnostic" || name === "./mediref-network-diagnostic"));
  assert.doesNotMatch(source, /createClient|mediref_sessions|refresh-mediref-session|connectOverCDP|remote-debugging|setInputFiles|enterPatientDob/);
  assert.match(source, /headless: false/);
  assert.match(source, /import\.meta\.url === pathToFileURL/);
  const observer = await readFile(new URL("./mediref-dob-diagnostic.ts", import.meta.url), "utf8");
  assert.doesNotMatch(observer, /from ["'](?:@supabase|.*refresh-mediref)/);
});

test("local name fill does not alter DOB or submit the form", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    await page.setContent('<input name="patient" type="hidden"><form><input name="patientName"><input name="dob" value="unchanged"><button>Send</button></form>');
    await fillDiagnosticName(page, { firstName: "Fixture", lastName: "Only" });
    assert.equal(await page.locator('[name="patientName"]').inputValue(), "Fixture Only");
    assert.equal(await page.locator('[name="dob"]').inputValue(), "unchanged");
    assert.equal(page.url(), "about:blank");
  } finally { await browser.close(); }
});


test("Compose discovery selects the form tab without an exact route and supports worker fallbacks", async (t) => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const field of ['<input name="patientName">', '<textarea aria-label="Patient name"></textarea>']) {
      await t.test(field.startsWith("<input") ? "current selector and multiple tabs" : "aria-label textarea fallback", async () => {
        const context = await browser.newContext();
        await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: route.request().url().includes("/draft/") ?
          `${field}<div data-testid="patient-dob-input" role="group">DOB</div>` : '<input name="username">' }));
        try {
          const login = await context.newPage(); await login.goto("https://www.mediref.com.au/login");
          const compose = await context.newPage(); await compose.goto("https://www.mediref.com.au/draft/new?private=SECRET");
          assert.equal(await locateComposePage(context, 500), compose);
          await fillDiagnosticName(compose, { firstName: "Fixture", lastName: "Only" });
          assert.equal(await compose.locator("input, textarea").inputValue(), "Fixture Only");
          assert.equal(new URL(compose.url()).pathname, "/draft/new");
        } finally { await context.close(); }
      });
    }
    await t.test("missing form reports an explicit safe stage", async () => {
      const context = await browser.newContext();
      await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "PRIVATE PAGE CONTENT" }));
      try {
        const page = await context.newPage(); await page.goto("https://www.mediref.com.au/compose?private=SECRET");
        await assert.rejects(locateComposePage(context, 100), error => error instanceof LocalDiagnosticError && error.stage === "locate_compose_name_field" && !error.message.includes("PRIVATE"));
      } finally { await context.close(); }
    });
    await t.test("waits for a delayed form", async () => {
      const context = await browser.newContext();
      await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<main></main>" }));
      try {
        const page = await context.newPage(); await page.goto("https://www.mediref.com.au/another-route");
        await page.evaluate(() => { setTimeout(() => { document.querySelector("main")!.innerHTML = '<input id="patient-name"><div data-date-field-input>DOB</div>'; }, 150); });
        assert.equal(await locateComposePage(context, 1000), page);
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
});

import { loadHistoricalUploadPrefix } from "./mediref-dob-diagnostic-local";

test("historical prefix loader fails with a safe stage without executing test routes", async () => {
  await assert.rejects(loadHistoricalUploadPrefix("/nonexistent/PRIVATE"), (error: unknown) => error instanceof LocalDiagnosticError && error.stage === "historical_prefix_unavailable" && !error.message.includes("PRIVATE"));
  const source = await readFile(new URL("./mediref-dob-diagnostic-local.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /import\([^)]*test-(send|upload2)|from\s+["'][^"']*test-(send|upload2)/);
});

test("local guard blocks dangerous actions and route IDs, closes context, and allows safe traffic", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [routePath, blocked] of [
      ["/_app/remote/changed/sendCorrespondence", true],
      ["/_app/remote/changed/deleteDraft", true],
      ["/_app/remote/r6r93r/changed", true],
      ["/_app/remote/143lgbm/changed", true],
      ["/_app/remote/fd8vn1/saveDraft", false],
      ["/_app/remote/1wqh9sd/getUploadParameters", false],
      ["https://storage.invalid/file", false],
      ["/safe-resource", false],
    ] as const) {
      const context = await browser.newContext({ serviceWorkers: "block" });
      let reachedServer = false; let stopped = false;
      await context.route("**/*", async route => {
        if (route.request().url().endsWith("/fixture")) await route.fulfill({ contentType: "text/html", body: "<main>Fixture</main>" });
        else { reachedServer = true; await route.fulfill({ body: "{}" }); }
      });
      const page = await context.newPage(); await page.goto("https://www.mediref.com.au/fixture");
      await installDiagnosticRequestGuard(context, () => { stopped = true; });
      const closed = blocked ? new Promise<void>(resolve => context.once("close", () => resolve())) : null;
      await page.evaluate(async url => { await fetch(url, { method: url.startsWith("https://storage") ? "PUT" : "POST", body: "PRIVATE" }).catch(() => {}); }, routePath).catch(() => {});
      if (closed) await closed;
      assert.equal(reachedServer, !blocked);
      assert.equal(stopped, blocked);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("diagnostics remain isolated from production workers and databases", async () => {
  const worker = await readFile(new URL("./refresh-mediref-session.ts", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /mediref-(?:dob|network)-diagnostic|observeManualDob|installDiagnosticRequestGuard/);
  for (const file of ["mediref-dob-diagnostic-local.ts", "mediref-dob-diagnostic.ts", "mediref-network-diagnostic.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /@supabase|createClient|refresh-mediref-session|claimNextPending|report_drafts|mediref_helper_jobs/);
  }
  const launcher = await readFile(new URL("./mediref-dob-diagnostic-local.ts", import.meta.url), "utf8");
  assert.match(launcher, /serviceWorkers: "block"/);
  assert.ok(launcher.indexOf("await installDiagnosticRequestGuard(browser") < launcher.indexOf("else await page.goto"));
});
