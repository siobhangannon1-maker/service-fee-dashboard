import { createPraktikaOwnershipRecovery, isPraktikaTransientInfrastructureError } from "../lib/praktika/ownership-recovery";
import { praktikaNoAuthGateEnabled } from "../lib/praktika/authentication";
import { pollPraktikaWorkflowContinuations } from "./praktika-workflow-continuations";
import { createCookieSnapshotStore } from "../lib/praktika/cookie-snapshot";
import { createShutdownCoordinator, type SkipReason } from "../lib/praktika/shutdown-coordinator";
import { requestPlannedRestoration } from "../lib/praktika/planned-restoration";
import {
  writePraktikaHelper, PraktikaOwnershipLost, PraktikaOwnershipUnavailable, PraktikaOwnershipRejected, PRAKTIKA_HELPER_HEARTBEAT_MS,
  PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS,
} from "../lib/praktika/helper-lease";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import {
  processOnePraktikaHelperJob, PraktikaJobQueueUnavailable,
  type PraktikaJobResult,
} from "./praktika-helper-job-processor";

dotenv.config({ path: ".env.local" });
dotenv.config();

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";

const PLAYWRIGHT_STORAGE_DIR =
  process.env.PLAYWRIGHT_STORAGE_DIR ||
  path.join(process.cwd(), "playwright-storage");

const PROFILE_ROOT = path.join(
  PLAYWRIGHT_STORAGE_DIR,
  "praktika-browser-profiles",
);

const HEADLESS =
  String(process.env.PRAKTIKA_HELPER_HEADLESS ?? "false").toLowerCase() !==
  "false";

console.log("PRAKTIKA_HELPER_HEADLESS =", process.env.PRAKTIKA_HELPER_HEADLESS);
console.log("HEADLESS =", HEADLESS);
console.log("PLAYWRIGHT_STORAGE_DIR =", PLAYWRIGHT_STORAGE_DIR);
console.log("PROFILE_ROOT =", PROFILE_ROOT);

const KEEP_BROWSER_OPEN =
  String(process.env.PRAKTIKA_KEEP_BROWSER_OPEN ?? "true").toLowerCase() !==
  "false";

const KEEP_ALIVE_INTERVAL_MS = Number(
  process.env.PRAKTIKA_KEEP_ALIVE_INTERVAL_MS || 30_000,
);

const REAL_ACTIVITY_INTERVAL_MS = Number(
  process.env.PRAKTIKA_REAL_ACTIVITY_INTERVAL_MS || 5 * 60_000,
);

const LOGIN_TIMEOUT_MS = Number(
  process.env.PRAKTIKA_LOGIN_TIMEOUT_MS || 10 * 60 * 1000,
);

const HELPER_JOB_DRAIN_LIMIT = Number(
  process.env.PRAKTIKA_HELPER_JOB_DRAIN_LIMIT || 20,
);

const HELPER_IDLE_POLL_INTERVAL_MS = Number(
  process.env.PRAKTIKA_HELPER_IDLE_POLL_INTERVAL_MS || 2_000,
);

const HELPER_BUSY_PAUSE_MS = Number(
  process.env.PRAKTIKA_HELPER_BUSY_PAUSE_MS || 250,
);

const HELPER_IDLE_SHUTDOWN_MS = Number(
  process.env.PRAKTIKA_HELPER_IDLE_SHUTDOWN_MS || 90 * 60_000,
);

const MEMORY_LOG_INTERVAL_MS = Number(
  process.env.PRAKTIKA_MEMORY_LOG_INTERVAL_MS || 5 * 60_000,
);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SessionRow = import("../lib/praktika/authentication").ExperimentalEvidence & {
  id: string;
  scope: "practice" | "user";
  app_user_id: string | null;
  helper_instance_id: string | null;
  helper_heartbeat_at: string | null;
  authenticated_at: string | null;
  status: string;
  message: string | null;
  cookie: string | null;
  mfa_code: string | null;
  pending_praktika_username: string | null;
  pending_praktika_password: string | null;
  praktika_username: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMb(bytes: number) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function logProcessMemory(label: string) {
  const memory = process.memoryUsage();

  console.log(
    `[memory] ${label} rss=${formatMb(memory.rss)}MB heapUsed=${formatMb(
      memory.heapUsed,
    )}MB heapTotal=${formatMb(memory.heapTotal)}MB external=${formatMb(
      memory.external,
    )}MB`,
  );
}

function decryptTemporaryCredential(value: string | null | undefined) {
  if (!value) return "";
  if (!value.startsWith("v1:")) return value;

  const secret = process.env.PRAKTIKA_TEMP_CREDENTIAL_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Missing PRAKTIKA_TEMP_CREDENTIAL_SECRET.");
  }

  const [, ivBase64, authTagBase64, encryptedBase64] = value.split(":");

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error("Invalid encrypted temporary credential format.");
  }

  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const encrypted = Buffer.from(encryptedBase64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
}

function argValue(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const sessionId = argValue("session-id");

if (!sessionId) {
  throw new Error("Missing --session-id=<praktika_sessions.id>");
}

const helperInstanceId = argValue("helper-instance-id");
if (!helperInstanceId) throw new Error("Missing --helper-instance-id; start through the owning watcher.");
let ownershipLost = false;
let scopedNoAuth = false;
let browserReady = false;
let recoverableExit = false;
let verificationRequested = false;
let ownedContext: BrowserContext | undefined;
let browserLaunch: Promise<BrowserContext> | undefined;
let loginTransition = true;
let shuttingDown = false;
let jobActive = false;
const restoredRemaining = argValue("restore-idle-remaining-ms");
const isWarmRestoration = restoredRemaining !== null;
let usefulWorkDeadline: number | null = isWarmRestoration
  ? performance.now() + Math.max(0, Number(restoredRemaining) || 0) : null;
let cookieSnapshots: ReturnType<typeof createCookieSnapshotStore> | undefined;
let snapshotRestoreAttempted = false;
let operationalThisGeneration = false;
let unresolvedShutdownWork = false;
function remainingUsefulWorkMs() {
  if (scopedNoAuth) return HELPER_IDLE_SHUTDOWN_MS;
  return usefulWorkDeadline === null ? 0 : Math.max(0, usefulWorkDeadline - performance.now());
}
function noteUsefulWork() { usefulWorkDeadline = performance.now() + HELPER_IDLE_SHUTDOWN_MS; }

const shutdownCoordinator = createShutdownCoordinator({
  close: async () => { const context = ownedContext || await browserLaunch; await context?.close(); },
  active: () => jobActive,
  interrupt: () => { unresolvedShutdownWork = true; },
  log: (event, metadata) => console.log("[Praktika lifecycle]", JSON.stringify({ event, generation: helperInstanceId, ...metadata })),
  exit: () => process.exit(75),
});
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownCoordinator.start();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const ownershipRecovery = createPraktikaOwnershipRecovery({ stopping: () => ownershipLost });

async function ownedWrite(action: "check" | "heartbeat" | "update", values: Record<string, unknown> = {}) {
  if (ownershipLost) throw new PraktikaOwnershipLost();
  try {
    await ownershipRecovery.run(() => writePraktikaHelper(supabase, sessionId!, helperInstanceId!, action, values), action === "heartbeat");
    if (ownershipLost) throw new PraktikaOwnershipRejected();
  } catch (error) {
    if (!(error instanceof PraktikaOwnershipLost)) throw error;
    ownershipLost = true;
    await shutdownCoordinator.close();
    throw new PraktikaOwnershipLost();
  }
}
async function assertOwned() { await ownedWrite("check"); }
async function releaseOwnership(failed = false) {
  await writePraktikaHelper(supabase, sessionId!, helperInstanceId!, "release", {
    status: failed ? "error" : "not_started",
  }).catch(() => {});
}

async function checkBrowserAvailability(page: Page) {
  if (shuttingDown || page.isClosed()) { browserReady = false; return false; }
  if (await isBrowserUiLoggedIn(page)) return true;
  browserReady = false;
  const mfa = await pageHasMfaInput(page);
  const credentials = pageIsLoginUrl(page) || pageIsLogoutUrl(page) || await pageHasVisiblePasswordInput(page)
    || looksLikeLoggedOutText(await page.locator("body").innerText().catch(() => ""));
  await updateSession({ status: mfa ? "waiting_for_mfa" : credentials ? "waiting_for_credentials" : "refreshing",
    message: mfa ? "Praktika requires an MFA code." : credentials ? "Please log in to Praktika." : "Praktika browser is connecting.",
    current_url: await safePageUrl(page) });
  return false;
}

// Only this path promotes the current generation to connected. Cookies and
// completed jobs never do so. Browser checks are repeated before resuming work.
async function markBrowserReady(page: Page) {
  browserReady = false;
  if (shuttingDown || page.isClosed() || !await checkBrowserAvailability(page)) return false;
  await assertOwned();
  if (shuttingDown || page.isClosed()) return false;
  await ownedWrite("update", { status: "connected", current_url: await safePageUrl(page),
    message: "Praktika helper browser is connected.", refreshed_at: nowIso() });
  browserReady = true;
  operationalThisGeneration = true;
  loginTransition = false;
  verificationRequested = false;
  return true;
}

// Chromium responsiveness only: no Praktika request and no authentication proof.
function startHeartbeat(context: BrowserContext) {
  let stopped = false;
  let pending: Promise<void> | undefined;
  const tick = async () => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        context.cookies().then(() => undefined),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Browser liveness unavailable")), PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS);
        }),
      ]);
      if (!stopped) await ownedWrite("heartbeat");
    } catch {
      if (shuttingDown) return;
      stopped = true;
      clearInterval(timer);
      ownershipLost = true;
      recoverableExit = true;
      if (await shutdownCoordinator.close()) await releaseOwnership(false);
      else process.exitCode = 75;
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  };
  const timer = setInterval(() => {
    if (!pending && !stopped) pending = tick().finally(() => { pending = undefined; });
  }, PRAKTIKA_HELPER_HEARTBEAT_MS);
  return async () => { stopped = true; clearInterval(timer); await pending; };
}

async function getSession() {
  await assertOwned();
  const data = await ownershipRecovery.run(async () => {
    try {
      const result = await supabase.from("praktika_sessions").select("*").eq("id", sessionId)
        .abortSignal(AbortSignal.timeout(5000)).single();
      if (result.error || !result.data) throw new PraktikaOwnershipUnavailable();
      return result.data;
    } catch { throw new PraktikaOwnershipUnavailable(); }
  });

  if (data.helper_instance_id !== helperInstanceId) {
    ownershipLost = true;
    await shutdownCoordinator.close();
    throw new PraktikaOwnershipLost();
  }
  return data as SessionRow;
}

async function updateSession(values: Record<string, unknown>) {
  if (["waiting_for_credentials", "waiting_for_mfa", "error", "expired"].includes(String(values.status || ""))) {
    browserReady = false;
    operationalThisGeneration = false;
    if (isWarmRestoration && values.status === "waiting_for_credentials") console.log("[Praktika lifecycle] restoration_credentials_required");
    if (isWarmRestoration && values.status === "waiting_for_mfa") console.log("[Praktika lifecycle] restoration_mfa_required");
  }
  if (["refreshing", "refresh_requested", "waiting_for_credentials", "waiting_for_mfa", "expired", "error"].includes(String(values.status || ""))) {
    browserReady = false;
    loginTransition = true;
  }
  await ownedWrite("update", values);
  if (["waiting_for_credentials", "waiting_for_mfa"].includes(String(values.status))) cookieSnapshots?.invalidate();
}

async function clearTemporaryPassword(extraValues: Record<string, unknown> = {}) {
  await updateSession({
    pending_praktika_password: null,
    ...extraValues,
  });
}

async function clearTemporaryCredentialsAfterSuccess(
  extraValues: Record<string, unknown> = {},
) {
  await updateSession({
    pending_praktika_username: null,
    pending_praktika_password: null,
    ...extraValues,
  });
}

async function getAndClearMfaCode() {
  const session = await getSession();
  const code = String(session.mfa_code || "").replace(/\D/g, "").trim();

  if (!code) return null;

  await updateSession({ mfa_code: null, mfa_code_updated_at: null });

  return code;
}

async function safePageUrl(page: Page) {
  try {
    return page.url();
  } catch {
    return null;
  }
}

function praktikaPagePath(page: Page): string | null {
  try {
    const url = new URL(page.url());
    return url.origin === PRAKTIKA_BASE_URL ? url.pathname.replace(/\/$/, "") || "/" : null;
  } catch { return null; }
}

function pageIsLogoutUrl(page: Page) {
  return praktikaPagePath(page) === "/v2/logout" || praktikaPagePath(page) === "/logout";
}

function pageIsLoginUrl(page: Page) {
  return praktikaPagePath(page) === "/v2/login";
}

function looksLikeLoggedOutText(text: string) {
  const lower = text.toLowerCase();

  return (
    lower.includes("login failed") ||
    lower.includes("logged-out") ||
    lower.includes("logged out") ||
    lower.includes("not logged in") ||
    lower.includes("dbunauthorisedexception") ||
    lower.includes("fisloggedin") ||
    lower.includes("fisisloggedin") ||
    lower.includes("hijacked or expired session") ||
    lower.includes("expired session")
  );
}

async function buildCookieHeader(context: BrowserContext) {
  const cookies = await context.cookies(PRAKTIKA_BASE_URL);

  return {
    cookies,
    cookieHeader: cookies
      .filter((cookie) => cookie.name && cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; "),
    hasPhpSession: cookies.some((cookie) => cookie.name === "PHPSESSID"),
    hasUat: cookies.some((cookie) => cookie.name === "UAT"),
  };
}

async function pageHasVisiblePasswordInput(page: Page) {
  const inputs = page.locator('input[type="password"]');
  const count = await inputs.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (visible) return true;
  }

  return false;
}

async function pageHasMfaInput(page: Page) {
  const selectors = [
    'input[name*="mfa" i]',
    'input[id*="mfa" i]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
  ];

  for (const selector of selectors) {
    const inputs = page.locator(selector);
    const count = await inputs.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      if (await inputs.nth(i).isVisible().catch(() => false)) return true;
    }
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();

  return (
    lower.includes("verification code") ||
    lower.includes("multi-factor") ||
    lower.includes("multifactor") ||
    lower.includes("authentication code") ||
    lower.includes("one-time code")
  );
}

async function dismissBlockingDialogs(page: Page) {
  const dialogButtons = page.locator(
    '.v-dialog__content--active button:has-text("OK"), .v-dialog__content--active button:has-text("Ok"), .v-dialog__content--active button:has-text("Close"), .v-dialog__content--active button:has-text("Continue"), button:has-text("OK"), button:has-text("Ok")',
  );

  const count = await dialogButtons.count().catch(() => 0);

  for (let i = 0; i < Math.min(count, 3); i++) {
    const button = dialogButtons.nth(i);
    const visible = await button.isVisible().catch(() => false);

    if (visible) {
      await button.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

async function isBrowserUiLoggedIn(page: Page) {
  await dismissBlockingDialogs(page);

  const pathname = praktikaPagePath(page);
  if (!pathname || pageIsLoginUrl(page) || pageIsLogoutUrl(page)) return false;
  if (await pageHasVisiblePasswordInput(page) || await pageHasMfaInput(page)) return false;
  const bodyText = await page.locator("body").innerText().catch(() => null);
  if (!bodyText?.trim() || looksLikeLoggedOutText(bodyText)) return false;
  // Browser readiness is independent of operation-specific response validation.
  return pathname === "/v2" || pathname.startsWith("/v2/");
}

async function hasExistingBrowserSession(page: Page) {
  await page.goto(`${PRAKTIKA_BASE_URL}/v2/`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForTimeout(3000);
  await dismissBlockingDialogs(page);

  if (await isBrowserUiLoggedIn(page)) return true;

  await page.goto(`${PRAKTIKA_BASE_URL}/`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForTimeout(3000);
  await dismissBlockingDialogs(page);

  return await isBrowserUiLoggedIn(page);
}

async function fillLoginIfCredentialsAvailable(page: Page) {
  const session = await getSession();

  let username = session.pending_praktika_username || "";
  let password = decryptTemporaryCredential(session.pending_praktika_password);

  if (session.scope === "practice" && (!username || !password)) {
    username = process.env.PRAKTIKA_USERNAME || "";
    password = process.env.PRAKTIKA_PASSWORD || "";
  }

  const usernameField = page
    .locator(
      'input[type="email"]:visible, input[name="email"]:visible, input[name="username"]:visible, input[name="login"]:visible, input[type="text"]:visible',
    )
    .first();

  const passwordField = page.locator('input[type="password"]:visible').first();

  if ((await usernameField.count()) === 0 || (await passwordField.count()) === 0) {
    if (pageIsLoginUrl(page) || await pageHasVisiblePasswordInput(page)) {
      await updateSession({ status: "waiting_for_credentials", message: "Praktika login requires attention.", refresh_requested_at: null });
    }
    return false;
  }

  if (!username || !password) {
    await updateSession({
      status: "waiting_for_credentials",
      message:
        session.scope === "user"
          ? "Enter your Praktika username and password in DocuDental."
          : "Practice credentials are missing. Enter credentials or configure environment variables.",
      current_url: await safePageUrl(page),
      refresh_requested_at: null,
    });

    return false;
  }

  loginTransition = true;
  browserReady = false;
  verificationRequested = true;
  console.log("Submitting Praktika credentials from saved pending credentials.");

  await usernameField.fill(username);
  await passwordField.fill(password);

  await page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Continue")',
    )
    .first()
    .click({ force: true });

  await page.waitForTimeout(4000);
  await dismissBlockingDialogs(page);

  if (session.scope === "user") {
    await clearTemporaryPassword({
      status: "refreshing",
      message:
        "Praktika credentials were submitted. Checking whether MFA is required.",
      current_url: await safePageUrl(page),
    });
  }

  return true;
}

async function submitMfaCodeIfAvailable(page: Page) {
  if (!(await pageHasMfaInput(page))) return false;
  loginTransition = true;
  browserReady = false;

  const code = await getAndClearMfaCode();

  if (!code) {
    await updateSession({
      status: "waiting_for_mfa",
      message: "Praktika requires an MFA code. Enter it in DocuDental.",
      current_url: await safePageUrl(page),
    });

    return false;
  }

  await dismissBlockingDialogs(page);

  const codeInput = page
    .locator(
      'input[inputmode="numeric"]:visible, input[name*="code" i]:visible, input[id*="code" i]:visible, input[name*="mfa" i]:visible, input[id*="mfa" i]:visible, input[name*="otp" i]:visible, input[id*="otp" i]:visible, input[type="tel"]:visible, input[type="text"]:visible',
    )
    .first();

  await codeInput.waitFor({ timeout: 15000 });
  await codeInput.fill(code);

  await dismissBlockingDialogs(page);

  await page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit"), button:has-text("Login")',
    )
    .first()
    .click({ force: true });

  verificationRequested = true;
  await updateSession({
    status: "refreshing",
    message: "MFA code submitted. Waiting for Praktika to finish signing in.",
    current_url: await safePageUrl(page),
  });

  await page.waitForTimeout(5000);
  await dismissBlockingDialogs(page);

  return true;
}

async function saveCookies(context: BrowserContext, page: Page, message?: string, markConnected = true) {
  const { cookieHeader, hasPhpSession, hasUat } = await buildCookieHeader(context);

  if (!cookieHeader) {
    throw new Error("No Praktika cookies found in the helper browser.");
  }

  if (!hasPhpSession || !hasUat) {
    throw new Error("Could not find required Praktika PHPSESSID and UAT cookies.");
  }

  const session = await getSession();

  const usernameToDisplay =
    session.pending_praktika_username ||
    session.praktika_username ||
    (session.scope === "practice" ? process.env.PRAKTIKA_USERNAME || null : null);

  const now = nowIso();

  await clearTemporaryCredentialsAfterSuccess({
    cookie: cookieHeader,
    message:
      (["error", "waiting_for_credentials", "waiting_for_mfa"].includes(session.status) ? session.message : null) || message ||
      (KEEP_BROWSER_OPEN
        ? "Praktika helper browser is connected."
        : "Praktika session refreshed successfully."),
    current_url: await safePageUrl(page),
    praktika_username: usernameToDisplay,
    mfa_code: null,
    mfa_code_updated_at: null,
    refresh_requested_at: null,
    refreshed_at: now,
    last_used_at: now,
  });

  // Capture reusable cookies only for a browser-ready generation. Capture itself
  // neither changes readiness nor supplies authentication proof.
  if (browserReady && markConnected && cookieSnapshots && !shuttingDown) {
    const cookies = await context.cookies(PRAKTIKA_BASE_URL);
    await assertOwned();
    if (browserReady && !shuttingDown) cookieSnapshots.capture(cookies, helperInstanceId!);
  }
  return true;
}

async function performRealBrowserActivity(page: Page) {
  if (page.isClosed()) {
    throw new Error("Praktika browser page is closed.");
  }

  const currentUrl = page.url();

  if (
    !currentUrl.toLowerCase().startsWith(PRAKTIKA_BASE_URL.toLowerCase()) ||
    currentUrl.includes("/login") ||
    currentUrl.includes("/v2/login") ||
    currentUrl.includes("/logout") ||
    (await pageHasVisiblePasswordInput(page))
  ) {
    return;
  }

  /*
   * IMPORTANT:
   * Do not use page.reload() here. On the Render-hosted Chromium helper,
   * a full Praktika reload can crash the renderer and leave the otherwise
   * valid session unusable.
   *
   * Instead, make a same-origin background request to Praktika. This gives
   * the server genuine authenticated activity without navigating or
   * rebuilding the visible Praktika application.
   */
  const probe = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
      });

      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        finalUrl: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, `${PRAKTIKA_BASE_URL}/v2/`);

  if (!probe.ok) {
    console.warn(
      `Praktika lightweight keep-alive returned ${probe.status || "no status"}${
        "error" in probe && probe.error ? `: ${probe.error}` : ""
      }.`,
    );
  }

  const finalUrl = String(probe.finalUrl || "").toLowerCase();

  if (
    finalUrl.includes("/login") ||
    finalUrl.includes("/v2/login") ||
    finalUrl.includes("/logout")
  ) {
    console.warn(
      "Praktika lightweight keep-alive was redirected to a login/logout page.",
    );
  }

  await dismissBlockingDialogs(page);
}

async function drainAvailableHelperJobs(
  context: BrowserContext,
  appUserId: string | null,
  page: Page,
): Promise<{ completedCount: number; failedCount: number; needsReconnect: boolean }> {
  if (!browserReady) return { completedCount: 0, failedCount: 0, needsReconnect: false };
  await pollPraktikaWorkflowContinuations(supabase, appUserId, { assertOwned, isShuttingDown: () => shuttingDown });
  let completedCount = 0;
  let failedCount = 0;
  let needsReconnect = false;

  while (!shuttingDown && remainingUsefulWorkMs() > 0 && completedCount + failedCount < HELPER_JOB_DRAIN_LIMIT) {
    jobActive = true;
    let result: PraktikaJobResult;
    try {
      result = await processOnePraktikaHelperJob(
        context,
        appUserId,
        { assertOwned, updateSession, isBrowserReady: async () => browserReady && await checkBrowserAvailability(page), isShuttingDown: () => shuttingDown },
      );
    } catch (error) {
      if (shuttingDown) unresolvedShutdownWork = true;
      throw error;
    } finally { jobActive = false; }
    if (result.outcome === "none") break;
    if (result.outcome === "completed") {
      completedCount += 1;
    } else if (result.outcome === "failed") {
      failedCount += 1;
    } else if (result.outcome === "needs_reconnect") {
      needsReconnect = true;
      break;
    }

    await sleep(HELPER_BUSY_PAUSE_MS);
  }

  return { completedCount, failedCount, needsReconnect };
}

async function keepBrowserOpenForever(context: BrowserContext, page: Page) {
  console.log(
    `Praktika browser left open. Helper will refresh cookies every ${Math.round(
      KEEP_ALIVE_INTERVAL_MS / 1000,
    )} seconds, check for jobs every ${Math.round(
      HELPER_IDLE_POLL_INTERVAL_MS / 1000,
    )} seconds, perform browser activity every ${Math.round(
      REAL_ACTIVITY_INTERVAL_MS / 1000,
    )} seconds, and shut down after ${Math.round(
      HELPER_IDLE_SHUTDOWN_MS / 60_000,
    )} minutes without processing a helper job.`,
  );

  let lastRealActivityAt = 0;
  let lastCookieRefreshAt = 0;
  if (usefulWorkDeadline === null) noteUsefulWork();
  let lastMemoryLogAt = 0;

  while (!shuttingDown && remainingUsefulWorkMs() > 0) {
    let sleepAfterCycleMs = HELPER_IDLE_POLL_INTERVAL_MS;

    try {
      const session = await getSession();
      const now = Date.now();

      if (now - lastMemoryLogAt >= MEMORY_LOG_INTERVAL_MS) {
        logProcessMemory(`session=${session.id}`);
        lastMemoryLogAt = now;
      }

      if (session.mfa_code && (await pageHasMfaInput(page))) {
        await submitMfaCodeIfAvailable(page);
        noteUsefulWork();
      }

      if (now - lastRealActivityAt >= REAL_ACTIVITY_INTERVAL_MS) {
        await performRealBrowserActivity(page);
        lastRealActivityAt = now;
      }

      if (await isBrowserUiLoggedIn(page)) {
        if (!browserReady || verificationRequested || session.status === "refresh_requested") {
          await updateSession({ status: "refreshing", refresh_requested_at: null });
          await markBrowserReady(page);
        }
        if (now - lastCookieRefreshAt >= KEEP_ALIVE_INTERVAL_MS) {
          await saveCookies(
            context,
            page,
            "Praktika helper browser is connected. Helper jobs can run for this user.",
          );
          lastCookieRefreshAt = now;
        }

        const jobSummary = await drainAvailableHelperJobs(
          context,
          session.app_user_id,
          page,
        );

        if (jobSummary.completedCount > 0) {
          noteUsefulWork();
          console.log(
            `Completed ${jobSummary.completedCount} Praktika helper job${
              jobSummary.completedCount === 1 ? "" : "s"
            } for session ${session.id}.`,
          );
          sleepAfterCycleMs = HELPER_BUSY_PAUSE_MS;
        }

        if (jobSummary.failedCount > 0) {
          console.log(
            `Failed ${jobSummary.failedCount} Praktika helper job attempt${
              jobSummary.failedCount === 1 ? "" : "s"
            } for session ${session.id}.`,
          );
        }

        if (jobSummary.needsReconnect) {
          console.log(
            `Praktika session requires reconnect. Stopping job drain for session ${session.id}.`,
          );
          sleepAfterCycleMs = HELPER_IDLE_POLL_INTERVAL_MS;
        } else if (remainingUsefulWorkMs() <= 0) {
          await saveCookies(
            context,
            page,
            `Praktika helper is sleeping after ${Math.round(
              HELPER_IDLE_SHUTDOWN_MS / 60_000,
            )} minutes without helper jobs. It will restart automatically when new work arrives.`,
            false, // Save reusable cookies without promoting the closing browser.
          ).catch((error) => {
            console.warn(
              "Could not save cookies immediately before idle shutdown:",
              error,
            );
          });

          console.log(
            `Session ${session.id} reached the ${Math.round(
              HELPER_IDLE_SHUTDOWN_MS / 60_000,
            )}-minute idle limit. Closing Chromium to release memory.`,
          );

          return;
        }
      } else if (await pageHasMfaInput(page)) {
        browserReady = false;
        await submitMfaCodeIfAvailable(page);
        noteUsefulWork();
      } else if (await pageHasVisiblePasswordInput(page)) {
        browserReady = false;
        const hasNewCredentials = Boolean(
          session.pending_praktika_username && session.pending_praktika_password,
        );

        if (hasNewCredentials) {
          await fillLoginIfCredentialsAvailable(page);
          noteUsefulWork();
        } else {
          await updateSession({
            status: "waiting_for_credentials",
            message: "Praktika helper browser is open but needs login details.",
            current_url: await safePageUrl(page),
            refresh_requested_at: null,
          });
        }
      } else {
        await checkBrowserAvailability(page);
        if (pageIsLogoutUrl(page)) {
          await updateSession({
            status: "waiting_for_credentials",
            message:
              "Praktika has logged out. Enter your Praktika username and password to reconnect.",
            current_url: await safePageUrl(page),
            refresh_requested_at: null,
          });

          await page.goto(`${PRAKTIKA_BASE_URL}/v2/login`, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          });

          await page.waitForTimeout(2500);
          noteUsefulWork();
          continue;
        }

        console.log(
          "Praktika helper could not confirm logged-in UI. Rechecking without changing session status.",
        );

        await performRealBrowserActivity(page);
      }
    } catch (error: any) {
      if (shuttingDown) return;
    if (ownershipLost || error instanceof PraktikaOwnershipLost) throw new PraktikaOwnershipLost();
      if (error instanceof PraktikaJobQueueUnavailable || (scopedNoAuth && isPraktikaTransientInfrastructureError(error))) { await sleep(HELPER_IDLE_POLL_INTERVAL_MS); continue; }
      const message = String(error?.message || "");

      if (
        page.isClosed() ||
        message.includes("Target page, context or browser has been closed") ||
        message.includes("browser has been closed") ||
        message.includes("context or browser has been closed") ||
        message.includes("Target closed")
      ) {
        browserReady = false;
        recoverableExit = true;

        console.warn("Praktika helper browser/context closed. Exiting helper.");
        return;
      }

      await updateSession({
        status: "error",
        message:
          error?.message || "Could not refresh cookies from Praktika cloud browser.",
        current_url: await safePageUrl(page),
      });
    }

    await sleep(sleepAfterCycleMs);
  }
}

async function refreshOnce() {
  const session = await getSession();
  scopedNoAuth = praktikaNoAuthGateEnabled(session);

  const profileName =
    session.scope === "practice"
      ? "practice"
      : `user_${session.app_user_id || session.id}`;

  cookieSnapshots = createCookieSnapshotStore(PLAYWRIGHT_STORAGE_DIR, {
    sessionId: session.id, appUserId: session.app_user_id, scope: session.scope,
    profile: path.resolve(PROFILE_ROOT, profileName), origin: new URL(PRAKTIKA_BASE_URL).origin,
  });

  await updateSession({
    status: "refreshing",
    message:
      session.scope === "practice"
        ? "Cloud helper is checking the saved practice Praktika browser session."
        : "Cloud helper is checking your saved Praktika browser session.",
  });

  if (shuttingDown) {
    shutdownCoordinator.emit("restoration_skipped", "no_operational_history");
    await releaseOwnership();
    shutdownCoordinator.finish();
    return;
  }
  browserLaunch = chromium.launchPersistentContext(
    path.join(PROFILE_ROOT, profileName),
    {
      handleSIGTERM: false,
      handleSIGINT: false,
      headless: HEADLESS,
      viewport: { width: 1280, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    },
  );

  const context = await browserLaunch;
  ownedContext = context;
  const stopHeartbeat = startHeartbeat(context);

  let page: Page | undefined;
  try {
    if (shuttingDown || (isWarmRestoration && remainingUsefulWorkMs() <= 0)) return;
    await assertOwned();
    page = await context.newPage();
    context.once("close", () => { browserReady = false; operationalThisGeneration = false; });
    page.once("close", () => { browserReady = false; operationalThisGeneration = false; });
    if (await hasExistingBrowserSession(page)) {
      const saved = await markBrowserReady(page) && await saveCookies(context, page);

      if (saved) {
        if (KEEP_BROWSER_OPEN) {
          await keepBrowserOpenForever(context, page);
        }

        return;
      }
    }

    if (isWarmRestoration && !snapshotRestoreAttempted && !await pageHasMfaInput(page) &&
      (pageIsLoginUrl(page) || await pageHasVisiblePasswordInput(page))) {
      snapshotRestoreAttempted = true;
      const currentCookies = await context.cookies(PRAKTIKA_BASE_URL);
      if (!["PHPSESSID", "UAT"].every(name => currentCookies.some(cookie => cookie.name === name))) {
        await assertOwned();
        // The spent durable intent binds this new owner to the outgoing snapshot generation.
        const { data: intent, error } = await supabase.from("praktika_helper_restorations")
          .select("source_instance_id").eq("session_id", session.id)
          .eq("consumed_instance_id", helperInstanceId!).abortSignal(AbortSignal.timeout(1_000)).maybeSingle();
        const snapshot = !error && intent ? cookieSnapshots.load(intent.source_instance_id) : null;
        console.log("[Praktika snapshot]", JSON.stringify({ snapshot_present: Boolean(snapshot?.cookies), snapshot_bound: Boolean(snapshot?.cookies), ...(snapshot?.reason ? { reason: snapshot.reason } : {}) }));
        if (snapshot?.cookies) {
          await assertOwned();
          if (shuttingDown) return;
          try {
            await context.addCookies(snapshot.cookies);
          } catch {
            console.log("[Praktika snapshot]", JSON.stringify({ snapshot_restore_failed: true, reason: "injection_failed" }));
            // Do not expose Playwright errors, which may contain cookie arguments.
            if (KEEP_BROWSER_OPEN) await keepBrowserOpenForever(context, page);
            return;
          }
          console.log("[Praktika snapshot]", JSON.stringify({ snapshot_injected: true }));
          await page.goto(`${PRAKTIKA_BASE_URL}/v2/`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
          const ready = await markBrowserReady(page);
          if (ready) await saveCookies(context, page);
          console.log("[Praktika snapshot]", JSON.stringify({ snapshot_restore_succeeded: ready }));
          // Continue the existing recovery/challenge loop, never reinject in that loop.
          if (KEEP_BROWSER_OPEN) await keepBrowserOpenForever(context, page);
          return;
        }
      }
    }

    await updateSession({
      status: "refreshing",
      message:
        session.scope === "practice"
          ? "Saved browser session was not active. Cloud helper is signing into the practice Praktika account."
          : "Saved browser session was not active. Cloud helper is signing into your Praktika account.",
      current_url: await safePageUrl(page),
    });

    await page.goto(`${PRAKTIKA_BASE_URL}/v2/login`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    await page.waitForTimeout(2500);
    await dismissBlockingDialogs(page);

    const startedAt = Date.now();
    let attemptedCredentials = false;

    while (!shuttingDown && (!isWarmRestoration || remainingUsefulWorkMs() > 0) && Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      if (await isBrowserUiLoggedIn(page)) {
        await page.waitForTimeout(3000);
        const saved = await markBrowserReady(page) && await saveCookies(context, page);

        if (saved) {
          if (KEEP_BROWSER_OPEN) {
            await keepBrowserOpenForever(context, page);
          }

          return;
        }
      }

      if (await pageHasMfaInput(page)) {
        await submitMfaCodeIfAvailable(page);
        await page.waitForTimeout(2500);
        continue;
      }

      if (!attemptedCredentials) {
        attemptedCredentials = await fillLoginIfCredentialsAvailable(page);
        await page.waitForTimeout(2500);
        continue;
      }

      if (await pageHasVisiblePasswordInput(page)) {
        await fillLoginIfCredentialsAvailable(page);
        await page.waitForTimeout(2500);
        continue;
      }

      await updateSession({
        status: "refreshing",
        message: "Cloud helper is waiting for Praktika login to complete.",
        current_url: await safePageUrl(page),
      });

      await page.waitForTimeout(2500);
    }

    if (isWarmRestoration && remainingUsefulWorkMs() <= 0) return;
    const finalSession = await getSession();
    if (["waiting_for_credentials", "waiting_for_mfa"].includes(finalSession.status)) return;
    throw new Error("Timed out waiting for Praktika login/MFA completion.");
  } catch (error: any) {
    if (shuttingDown) return;
    if (ownershipLost || error instanceof PraktikaOwnershipLost) throw new PraktikaOwnershipLost();
    if (page?.isClosed() || (scopedNoAuth && isPraktikaTransientInfrastructureError(error))) { recoverableExit = true; return; }
    await clearTemporaryPassword({
      status: "error",
      message: error?.message || "Praktika session refresh failed.",
      current_url: page ? await safePageUrl(page) : null,
    });

    throw error;
  } finally {
    shutdownCoordinator.drained();
    // Stop heartbeat and close together so a pending heartbeat cannot spend the close budget twice.
    // A timed-out close never permits release.
    const [closed] = await Promise.all([shutdownCoordinator.close(), stopHeartbeat()]);
    shutdownCoordinator.decision();
    let reason: SkipReason | undefined = !closed ? "browser_close_failed"
      : ownershipLost ? "ownership_lost"
      : !shuttingDown ? "not_planned"
      : !operationalThisGeneration ? "no_operational_history"
      : unresolvedShutdownWork ? "unresolved_shutdown_work"
      : !Number.isFinite(remainingUsefulWorkMs()) || remainingUsefulWorkMs() <= 0 ? "idle_deadline_expired" : undefined;
    if (!reason) {
      // Diagnostic preflight only; the RPC still makes the atomic authoritative decision.
      try {
        const { data, error } = await supabase.from("praktika_sessions")
          .select("status,helper_instance_id,helper_heartbeat_at,app_user_id").eq("id", sessionId!)
          .abortSignal(AbortSignal.timeout(1_000)).single();
        if (error || !data) throw new Error("Preflight unavailable");
        if (data.helper_instance_id !== helperInstanceId) reason = "ownership_lost";
        else if (data.status !== "connected") reason = "session_status_ineligible";
        else {
          let query = supabase.from("praktika_helper_jobs").select("id", { count: "exact", head: true }).eq("status", "processing");
          query = data.app_user_id === null ? query.is("app_user_id", null) : query.eq("app_user_id", data.app_user_id);
          const result = await query.abortSignal(AbortSignal.timeout(1_000));
          if (result.error) throw new Error("Preflight unavailable");
          if (result.count) reason = "processing_job_present";
        }
        if (!reason) {
          const requested = await requestPlannedRestoration(supabase, sessionId!, helperInstanceId!, remainingUsefulWorkMs());
          if (requested) shutdownCoordinator.emit("restoration_requested");
          else reason = "rpc_rejected";
        }
      } catch {
        reason = "rpc_transport_failure";
        shutdownCoordinator.emit("restoration_request_failed");
      }
    }
    if (reason) {
      shutdownCoordinator.emit("restoration_skipped", reason);
      if (!closed || reason === "rpc_transport_failure" || reason === "ownership_lost" || unresolvedShutdownWork) {
        process.exitCode = 75; // Leave ambiguous/failed cleanup to lease expiry.
      } else await releaseOwnership();
    }
    if (!closed) {
      // Chromium may still be alive. Keep the planned hard deadline armed.
      if (!shuttingDown) process.exit(75);
      return;
    }
    if (recoverableExit) process.exitCode = 75;
    shutdownCoordinator.finish();
    logProcessMemory(`session=${session.id} after-context-close`);
  }
}

refreshOnce().catch((error) => {
  if (shuttingDown) {
    shutdownCoordinator.emit("restoration_skipped", ownershipLost ? "ownership_lost" : "unresolved_shutdown_work");
    shutdownCoordinator.finish();
    process.exit(75);
  }
  console.error("Failed to refresh Praktika session:");
  console.error(error);
  process.exit(ownershipLost || recoverableExit || error instanceof PraktikaOwnershipLost ? 75 : 1);
});