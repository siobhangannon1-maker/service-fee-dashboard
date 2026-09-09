import { readFile, mkdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { chromium, type Page, type BrowserContext } from "playwright";
import { startHistoricalPrefixComparison, startUploadKeyDiagnostic, startInitializationDiagnostic, startNetworkDiagnostic } from "./mediref-network-diagnostic";
import { parseDobDiagnosticInput, startDobObservation } from "./mediref-dob-diagnostic";

const prefix = "[MediRef diagnostic]";
const inside = (parent: string, child: string) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

export function diagnosticProfilePath(home: string, repository: string) {
  const profile = path.resolve(home, ".docudental", "mediref-dob-diagnostic-profile");
  if (inside(repository, profile)) throw new Error("Diagnostic profile must be outside the repository.");
  return profile;
}

export async function loadDiagnosticInput(inputFile: string | undefined) {
  if (!inputFile || !path.isAbsolute(inputFile)) throw new Error("Set MEDIREF_DOB_DIAGNOSTIC_INPUT_FILE to an absolute private input path.");
  try {
    return parseDobDiagnosticInput(JSON.parse(await readFile(inputFile, "utf8")));
  } catch {
    // Never print parsing errors or filesystem errors: either can contain private data.
    throw new Error("Unable to read valid private diagnostic input.");
  }
}

export class LocalDiagnosticError extends Error {
  constructor(public readonly stage: string, public readonly reason = "unavailable") { super("Local diagnostic stopped."); }
}

const dobSelector = '[data-testid="patient-dob-input"], [data-date-field-input], #dob[role="group"]';
async function nameField(page: Page) {
  const primary = ["patient", "name"].flatMap(hint => ["name", "id", "placeholder"].map(attribute => `input[${attribute}*="${hint}" i]`));
  const fallback = ["patient", "name"].flatMap(hint => ["input", "textarea"].flatMap(tag =>
    ["name", "id", "placeholder", "aria-label"].map(attribute => `${tag}[${attribute}*="${hint}" i]`)));
  for (const selector of [primary.join(", "), fallback.join(", ")]) {
    for (const field of await page.locator(selector).all()) {
      if (await field.isVisible() && await field.isEditable({ timeout: 250 })) return field;
    }
  }
  return null;
}

export async function locateComposePage(context: BrowserContext, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let foundName = false;
  let foundDob = false;
  let trustedPage = false;
  do {
    const candidates: Page[] = [];
    for (const page of context.pages()) {
      try {
        // Restrict patient entry to MediRef, but never require a particular route.
        const url = new URL(page.url());
        if (url.protocol !== "https:" || !["www.mediref.com.au", "mediref.com.au"].includes(url.hostname)) continue;
        trustedPage = true;
        const name = await nameField(page);
        const dob = await page.locator(dobSelector).all();
        let visibleDob = false;
        for (const group of dob) visibleDob ||= await group.isVisible();
        foundName ||= Boolean(name); foundDob ||= visibleDob;
        if (name && visibleDob) candidates.push(page);
      } catch { /* A closing/navigating tab is retried within the bounded window. */ }
    }
    if (candidates.length) {
      const focused: Page[] = [];
      for (const candidate of candidates) if (await candidate.evaluate(() => document.hasFocus()).catch(() => false)) focused.push(candidate);
      const selected = candidates.length === 1 ? candidates[0] : focused.length === 1 ? focused[0] : null;
      console.log(`${prefix} pages detected:`, context.pages().length);
      console.log(`${prefix} active page candidate found:`, Boolean(selected));
      console.log(`${prefix} compose name field found:`, true);
      console.log(`${prefix} compose DOB group found:`, true);
      if (!selected) throw new LocalDiagnosticError("locate_active_page", "ambiguous");
      return selected;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  console.log(`${prefix} pages detected:`, context.pages().length);
  console.log(`${prefix} active page candidate found:`, false);
  console.log(`${prefix} compose name field found:`, foundName);
  console.log(`${prefix} compose DOB group found:`, foundDob);
  throw new LocalDiagnosticError(!trustedPage ? "locate_active_page" : !foundName ? "locate_compose_name_field" : "locate_compose_dob_group");
}

export async function fillDiagnosticName(page: Page, patient: { firstName: string; lastName: string }) {
  const field = await nameField(page);
  if (!field) throw new LocalDiagnosticError("locate_compose_name_field");
  try {
    await field.fill(`${patient.firstName.trim()} ${patient.lastName.trim()}`, { timeout: 3000 });
  } catch { throw new LocalDiagnosticError("fill_patient_name"); }
}

export async function loadHistoricalUploadPrefix(repository: string) {
  try {
    const values = await Promise.all(["test-upload2", "test-send"].map(async route => {
      const source = await readFile(path.join(repository, "app/api/mediref", route, "route.ts"), "utf8");
      return source.match(/const\s+PRACTICE_ID\s*=\s*["']([a-zA-Z0-9_-]+)["']/)?.[1];
    }));
    if (!values[0] || values[0] !== values[1]) throw new Error();
    return values[0];
  } catch { throw new LocalDiagnosticError("historical_prefix_unavailable"); }
}

// Installed only in this dedicated local browser, before any navigation.
export async function installDiagnosticRequestGuard(context: BrowserContext, stopInput: () => void = () => {}) {
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    let pathname = url.pathname;
    try { pathname = decodeURIComponent(pathname); } catch { /* Match the original path if malformed. */ }
    const remote = pathname.match(/^\/_app\/remote\/([^/]+)\/([^/]+)\/?$/);
    const mediref = ["www.mediref.com.au", "mediref.com.au"].includes(url.hostname);
    const action = mediref && remote ?
      (remote[2] === "sendCorrespondence" || remote[1] === "r6r93r" ? "sendCorrespondence" :
        remote[2] === "deleteDraft" || remote[1] === "143lgbm" ? "deleteDraft" : null) : null;
    if (!action) { await route.fallback(); return; }
    await route.abort("blockedbyclient");
    console.log("[MediRef diagnostic] Blocked prohibited action", { action });
    stopInput();
    await context.close(); // Stop observation and all tabs after the blocked attempt.
  });
}

export async function runLocalDobDiagnostic() {
  // Validate before opening a browser. No dotenv, shared session or credential loading.
  const prefixComparisonMode = process.env.MEDIREF_PREFIX_COMPARISON_DIAGNOSTIC === "true";
  const runtimeSourceMode = process.env.MEDIREF_UPLOAD_SOURCE_DIAGNOSTIC === "true";
  const uploadKeyMode = runtimeSourceMode || process.env.MEDIREF_UPLOAD_KEY_DIAGNOSTIC === "true";
  const initializationMode = process.env.MEDIREF_INITIALIZATION_DIAGNOSTIC === "true";
  const networkMode = prefixComparisonMode || uploadKeyMode || initializationMode || process.env.MEDIREF_NETWORK_DIAGNOSTIC === "true";
  const input = networkMode ? null : await loadDiagnosticInput(process.env.MEDIREF_DOB_DIAGNOSTIC_INPUT_FILE);
  if (networkMode && !initializationMode && process.env.MEDIREF_DIAGNOSTIC_TEST_PDF) {
    const file = process.env.MEDIREF_DIAGNOSTIC_TEST_PDF;
    if (!path.isAbsolute(file) || !file.toLowerCase().endsWith(".pdf") || !(await stat(file).catch(() => null))?.isFile()) throw new LocalDiagnosticError("validate_test_pdf");
  }
  if (!process.stdin.isTTY) throw new Error("Run this diagnostic in an interactive terminal.");
  const repository = await realpath(path.resolve(import.meta.dirname, ".."));
  const profile = diagnosticProfilePath(homedir(), repository);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  if (inside(repository, await realpath(profile))) throw new Error("Diagnostic profile must be outside the repository.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const browser = await chromium.launchPersistentContext(profile, { headless: false, serviceWorkers: "block", viewport: { width: 1280, height: 900 } }).catch(() => {
    terminal.close();
    throw new Error("Unable to open the isolated diagnostic browser.");
  });
  let stage = "locate_active_page";
  try {
    await installDiagnosticRequestGuard(browser, () => terminal.close());
    let page = browser.pages()[0] ?? await browser.newPage();
    const existing = await locateComposePage(browser, 0).catch(error => { if (error instanceof LocalDiagnosticError && error.reason === "ambiguous") throw error; return null; });
    if (existing) page = existing;
    else await page.goto("https://www.mediref.com.au", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await terminal.question(`${prefix} Sign in and complete MFA manually in the browser, or use its existing local login. Press Enter here when ready.\n`);
    const compose = await locateComposePage(browser, 1000).catch(error => { if (error instanceof LocalDiagnosticError && error.reason === "ambiguous") throw error; return null; });
    if (compose) page = compose;
    else await page.goto("https://www.mediref.com.au/compose", { waitUntil: "domcontentloaded", timeout: 90_000 });
    await terminal.question(`${prefix} Confirm Compose is ready in the browser. Do not enter DOB yet. Press Enter here to begin.\n`);
    page = await locateComposePage(browser);
    await page.bringToFront();
    if (prefixComparisonMode) {
      stage = "historical_prefix_comparison";
      const capture = startHistoricalPrefixComparison(browser, page, await loadHistoricalUploadPrefix(repository));
      try {
        console.log(`${prefix} Capture started. In a fresh Compose draft, manually enter test name/DOB, move focus away, and attach one safe PDF. Do not click Send.`);
        await capture.waitForFirst();
        await terminal.question(`${prefix} First key captured. Wait until the manual upload finishes. Press Enter when ready for the second draft. Do not click Send.\n`);
        console.log(`${prefix} Open a SECOND fresh Compose draft in the SAME tab. Enter test name/DOB, move focus away, then attach a safe PDF. Do not click Send.`);
        await capture.waitForSecond();
        const result = await capture.stop();
        if (!result) throw new LocalDiagnosticError("prefix_comparison_incomplete");
        console.log(JSON.stringify(result));
        await terminal.question(`${prefix} Comparison complete. Wait for any manual attachment to finish; do not click Send. Press Enter to close.\n`);
      } finally { await capture.stop(); }
      return;
    }
    if (uploadKeyMode) {
      stage = "upload_key_capture";
      await terminal.question(`${prefix} Confirm a FRESH blank Compose draft. Press Enter to start capture before entering patient fields.\n`);
      const capture = startUploadKeyDiagnostic(browser, page);
      try {
        console.log(`${prefix} Capture started. Reload the blank Compose page to observe earlier JSON responses. Manually enter test patient name/DOB, move focus away, then attach ONE safe test PDF. Do not click Send. Capture stops at the first save after the signed PUT (three-minute limit).`);
        await capture.waitForUploadSave();
      } finally {
        const result = await capture.stop(runtimeSourceMode);
        if (runtimeSourceMode) console.log(`${prefix} Runtime upload source`, JSON.stringify(result.runtimeSource));
        console.log(`${prefix} Sanitized upload key analysis`, JSON.stringify(result.analysis));
        console.log(`${prefix} Sanitized saved file metadata structure`, JSON.stringify(result.fileMetadata));
      }
      if (runtimeSourceMode) {
        try {
          const answer = await terminal.question(`${prefix} Type VERIFY to check prefix reuse with a SECOND fresh Compose draft, or press Enter to skip. This makes one upload-parameters request only; no PDF upload or Send.\n`);
          if (answer.trim() === "VERIFY") {
            console.log(`${prefix} Open a SECOND fresh Compose draft in the SAME tab now, then enter test name manually to trigger saveDraft. Do not attach a PDF or click Send. Waiting up to two minutes.`);
            console.log(`${prefix} Local prefix reuse check`, JSON.stringify(await capture.verifyFreshDraft()));
          }
        } finally { capture.discardReuse(); }
      }
      await terminal.question(`${prefix} Capture finished. Do not click Send. Press Enter to close the local browser.\n`);
      return;
    }
    if (initializationMode) {
      stage = "initialization_capture";
      await terminal.question(`${prefix} Confirm this is a FRESH BLANK Compose draft. Press Enter to start capture; then reload this blank page manually so its Compose data request can be observed. Do not attach a PDF or click Send.\n`);
      const capture = startInitializationDiagnostic(browser, page);
      try {
        console.log(`${prefix} Capture started. Reload the blank Compose page now, then manually enter name and DOB and move focus away. Capture stops at the first saveDraft request (two-minute limit).`);
        await capture.waitForFirstSave();
      } finally {
        const result = await capture.stop();
        console.log(`${prefix} Sanitized Compose __data structure`, JSON.stringify(result.compose));
        console.log(`${prefix} Sanitized first saveDraft payload structure`, JSON.stringify(result.saveDraft));
        console.log(`${prefix} Draft initialization comparison`, JSON.stringify(result.comparison));
      }
      await terminal.question(`${prefix} Capture finished. Do not attach PDF or click Send. Press Enter to close the local browser.\n`);
      return;
    }
    if (networkMode) {
      stage = "network_capture";
      const capture = startNetworkDiagnostic(browser, new URL(page.url()).origin);
      try {
        console.log(`${prefix} Network capture started. Manually enter patient name and DOB, move focus away, and attach ONE approved test PDF. Wait until the attachment is visible. Do not click Send.`);
        await terminal.question(`${prefix} Press Enter here to stop network capture.\n`);
      } finally {
        console.log(`${prefix} Sanitized chronological network summary`, JSON.stringify(await capture.stop()));
      }
      await terminal.question(`${prefix} Capture finished. Do not click Send. Press Enter to close the local browser.\n`);
      return;
    }
    if (!input) throw new LocalDiagnosticError("local_setup");
    stage = "fill_patient_name";
    await fillDiagnosticName(page, input.patient);
    stage = "capture_before_snapshot";
    const observation = await startDobObservation(page, input.patient.dob);
    try {
      const before = await observation.evaluate(o => o.snapshot());
      console.log(`${prefix} DOB state before manual entry`, JSON.stringify(before));
      console.log(`${prefix} Please enter DOB manually and move focus away.`);
      await terminal.question(`${prefix} Press Enter here when manual DOB entry is finished.\n`);
      stage = "capture_after_snapshot";
      const after = await observation.evaluate(o => o.snapshot());
      const records = await observation.evaluate(o => o.drain());
      console.log(`${prefix} DOB state after manual entry`, JSON.stringify(after));
      console.log(`${prefix} Observations`, JSON.stringify(records));
      const newlyMatchingInput = after.candidates.some(candidate => candidate.matchesExpectedDob &&
        !before.candidates.find(previous => previous.candidateId === candidate.candidateId)?.matchesExpectedDob);
      const newlyMatchingSerialized = after.serializedFields.some(field => field.matchesExpectedDob &&
        !before.serializedFields.find(previous => previous.attributeName === field.attributeName)?.matchesExpectedDob);
      console.log(`${prefix} Comparison summary`, JSON.stringify({
        hiddenDobInputAppeared: !before.hasHiddenDobInput && after.hasHiddenDobInput,
        serializedFieldAppeared: !before.hasSerializedDobField && after.hasSerializedDobField,
        candidateInputBecameNonEmpty: after.candidates.some(candidate => !candidate.valueEmpty && before.candidates.find(previous => previous.candidateId === candidate.candidateId)?.valueEmpty === true),
        candidateInputNewlyMatchedExpectedDob: newlyMatchingInput,
        serializedFieldNewlyMatchedExpectedDob: newlyMatchingSerialized,
        ariaStateChanged: after.ariaNowChanged,
        yearAriaStateChanged: after.yearAriaNowChangedAfterCommit,
        validationStateChanged: before.dobGroupAriaInvalid !== after.dobGroupAriaInvalid || before.dataInvalidPresent !== after.dataInvalidPresent || before.validationMessagePresent !== after.validationMessagePresent,
        inputObserved: after.observedEventTypes.includes("input"),
        changeObserved: after.observedEventTypes.includes("change"),
        focusoutObserved: after.focusoutObserved,
        structuralMutationsObserved: records.mutations.some(record => record.mutationType === "childList"),
        possibleCommittedStateSignal: newlyMatchingInput || newlyMatchingSerialized,
        applicationCommitProven: false,
        droppedRecords: after.droppedRecords,
      }));
      console.log(`${prefix} Candidate signals require review; this diagnostic does not report DOB success.`);
    } finally {
      await observation.evaluate(o => o.stop()).catch(() => undefined);
      await observation.dispose();
    }
    await terminal.question(`${prefix} Observation finished. No PDF or Send action was performed. Press Enter to close this local browser.\n`);
  } catch (error) {
    throw error instanceof LocalDiagnosticError ? error : new LocalDiagnosticError(stage);
  } finally {
    terminal.close();
    await browser.close();
  }
}

// Importing this module in a test does not launch a browser or execute a worker.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLocalDobDiagnostic().catch((error) => {
    console.error(`${prefix} Local diagnostic stopped. No workflow was processed.`, { stage: error instanceof LocalDiagnosticError ? error.stage : "local_setup" });
    process.exitCode = 1;
  });
}
