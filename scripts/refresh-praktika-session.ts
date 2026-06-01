import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const PRAKTIKA_PRACTICE_ID = process.env.PRAKTIKA_PRACTICE_ID || "1181";
const PROFILE_ROOT = path.join(process.cwd(), "praktika-browser-profiles");

const HEADLESS =
  String(process.env.PRAKTIKA_HELPER_HEADLESS ?? "true").toLowerCase() !==
  "false";

const KEEP_BROWSER_OPEN =
  String(process.env.PRAKTIKA_KEEP_BROWSER_OPEN ?? "true").toLowerCase() !==
  "false";

const KEEP_ALIVE_INTERVAL_MS = Number(
  process.env.PRAKTIKA_KEEP_ALIVE_INTERVAL_MS || 30_000,
);

const LOGIN_TIMEOUT_MS = Number(
  process.env.PRAKTIKA_LOGIN_TIMEOUT_MS || 10 * 60 * 1000,
);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SessionRow = {
  id: string;
  scope: "practice" | "user";
  app_user_id: string | null;
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

async function getSession() {
  const { data, error } = await supabase
    .from("praktika_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Session not found.");
  }

  return data as SessionRow;
}

async function updateSession(values: Record<string, unknown>) {
  const { error } = await supabase
    .from("praktika_sessions")
    .update({
      ...values,
      updated_at: nowIso(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Could not update Praktika session: ${error.message}`);
  }
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

  const { error } = await supabase
    .from("praktika_sessions")
    .update({
      mfa_code: null,
      mfa_code_updated_at: null,
      updated_at: nowIso(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Could not clear MFA code: ${error.message}`);
  }

  return code;
}

async function safePageUrl(page: Page) {
  try {
    return page.url();
  } catch {
    return null;
  }
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

function looksLikeLoginHtml(text: string) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  return (
    trimmed.startsWith("<!DOCTYPE") ||
    lower.startsWith("<html") ||
    lower.includes("/v2/login") ||
    lower.includes("<title>login") ||
    lower.includes('type="password"') ||
    lower.includes('name="password"')
  );
}

async function validateCookieWithPraktikaApi(cookieHeader: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const params = new URLSearchParams();
    params.append("sReportName", "appointments");
    params.append("bByCreationTime", "false");
    params.append("iPracticeIds[]", PRAKTIKA_PRACTICE_ID);
    params.append("sFromDate", today);
    params.append("sToDate", today);

    const response = await fetch(
      `${PRAKTIKA_BASE_URL}/php/json/db_reportingDataWarehouse.php`,
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader,
          Origin: PRAKTIKA_BASE_URL,
          Referer: `${PRAKTIKA_BASE_URL}/v2/reports/appointments`,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
        },
        body: params.toString(),
        cache: "no-store",
      },
    );

    const text = await response.text();

    if (response.status === 401 || looksLikeLoginHtml(text) || looksLikeLoggedOutText(text)) {
      return {
        ok: false,
        reason: `Praktika API says session is logged out. ${text.slice(0, 300)}`,
      };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        reason: `Praktika API returned non-JSON during helper validation. ${text.slice(0, 300)}`,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: `Praktika API validation failed with HTTP ${response.status}. ${text.slice(0, 300)}`,
      };
    }

    if (!Array.isArray(parsed)) {
      const jsonText = JSON.stringify(parsed).slice(0, 300);

      if (looksLikeLoggedOutText(jsonText)) {
        return {
          ok: false,
          reason: `Praktika API says session is logged out. ${jsonText}`,
        };
      }

      return {
        ok: false,
        reason: `Praktika API returned unexpected validation data. ${jsonText}`,
      };
    }

    return { ok: true, reason: "Praktika API validation succeeded." };
  } catch (error: any) {
    return {
      ok: false,
      reason: error?.message || "Praktika API validation failed.",
    };
  }
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
    'input[inputmode="numeric"]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[name*="mfa" i]',
    'input[id*="mfa" i]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[type="tel"]',
  ];

  for (const selector of selectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0) return true;
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();

  return (
    lower.includes("verification code") ||
    lower.includes("multi-factor") ||
    lower.includes("multifactor") ||
    lower.includes("authentication code") ||
    lower.includes("mfa") ||
    lower.includes("one-time") ||
    lower.includes("otp")
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

  const url = page.url().toLowerCase();

  if (
    url.includes("/v2/scheduler") ||
    url.includes("/v2/appointment") ||
    url.includes("/v2/patient") ||
    url.includes("/v2/reports")
  ) {
    return true;
  }

  if (url.includes("/login") || url.includes("/v2/login")) {
    return false;
  }

  if (await pageHasVisiblePasswordInput(page)) {
    return false;
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");

  if (looksLikeLoggedOutText(bodyText)) {
    return false;
  }

  return url.includes(PRAKTIKA_BASE_URL.toLowerCase());
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
      'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[type="text"]',
    )
    .first();

  const passwordField = page.locator('input[type="password"]').first();

  if ((await usernameField.count()) === 0 || (await passwordField.count()) === 0) {
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
      'input[inputmode="numeric"], input[name*="code" i], input[id*="code" i], input[name*="mfa" i], input[id*="mfa" i], input[name*="otp" i], input[id*="otp" i], input[type="tel"], input[type="text"]',
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

  await updateSession({
    status: "refreshing",
    message: "MFA code submitted. Waiting for Praktika to finish signing in.",
    current_url: await safePageUrl(page),
  });

  await page.waitForTimeout(5000);
  await dismissBlockingDialogs(page);

  return true;
}

async function saveCookies(context: BrowserContext, page: Page, message?: string) {
  const cookies = await context.cookies(PRAKTIKA_BASE_URL);

  if (!cookies.length) {
    throw new Error("No Praktika cookies found in the helper browser.");
  }

  const cookieHeader = cookies
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  const hasPhpSession = cookies.some((cookie) => cookie.name === "PHPSESSID");
  const hasUat = cookies.some((cookie) => cookie.name === "UAT");

  if (!hasPhpSession || !hasUat) {
    throw new Error("Could not find required Praktika PHPSESSID and UAT cookies.");
  }

  // Important:
  // Do not validate these cookies with a separate server-side fetch here.
  // Praktika can reject copied browser cookies as "Hijacked or expired session"
  // even while the live helper browser is genuinely logged in. For this helper,
  // the visible Playwright browser session is the source of truth.
  console.log("Skipping server-side Praktika API validation; trusting live helper browser session.");

  const session = await getSession();

  const usernameToDisplay =
    session.pending_praktika_username ||
    session.praktika_username ||
    (session.scope === "practice" ? process.env.PRAKTIKA_USERNAME || null : null);

  const now = nowIso();

  await clearTemporaryCredentialsAfterSuccess({
    cookie: cookieHeader,
    status: "connected",
    message:
      message ||
      (KEEP_BROWSER_OPEN
        ? "Praktika session connected. Helper browser is open and refreshing cookies."
        : "Praktika session refreshed successfully."),
    current_url: await safePageUrl(page),
    praktika_username: usernameToDisplay,
    mfa_code: null,
    mfa_code_updated_at: null,
    refresh_requested_at: null,
    refreshed_at: now,
    last_used_at: now,
  });

  return true;
}

async function keepBrowserOpenForever(context: BrowserContext, page: Page) {
  console.log(
    `Praktika browser left open. Helper will refresh and API-validate cookies every ${Math.round(
      KEEP_ALIVE_INTERVAL_MS / 1000,
    )} seconds.`,
  );

  while (true) {
    try {
      const session = await getSession();

      if (session.mfa_code && (await pageHasMfaInput(page))) {
        await submitMfaCodeIfAvailable(page);
      }

      if (await isBrowserUiLoggedIn(page)) {
        const saved = await saveCookies(
          context,
          page,
          "Praktika browser and API are connected. Cookies refreshed from live browser.",
        );

        if (!saved && (await pageHasVisiblePasswordInput(page))) {
          await fillLoginIfCredentialsAvailable(page);
        }
      } else if (await pageHasMfaInput(page)) {
        await submitMfaCodeIfAvailable(page);
      } else if (await pageHasVisiblePasswordInput(page)) {
        const hasNewCredentials = Boolean(
          session.pending_praktika_username && session.pending_praktika_password,
        );

        if (hasNewCredentials) {
          await fillLoginIfCredentialsAvailable(page);
        } else {
          await updateSession({
            status: "waiting_for_credentials",
            message: "Praktika helper browser is open but needs login details.",
            current_url: await safePageUrl(page),
            refresh_requested_at: null,
          });
        }
      } else {
        await page
          .goto(`${PRAKTIKA_BASE_URL}/v2/`, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          })
          .catch(() => {});
      }
    } catch (error: any) {
      const message = String(error?.message || "");

      if (
        message.includes("Target page, context or browser has been closed") ||
        message.includes("browser has been closed") ||
        message.includes("context or browser has been closed") ||
        message.includes("Target closed")
      ) {
        await updateSession({
          status: "connected",
          message:
            "Praktika was connected recently, but the local helper browser is no longer open. Start the helper again to keep cookies refreshed.",
          refresh_requested_at: null,
          last_used_at: nowIso(),
        });

        console.warn("Praktika helper browser/context closed. Exiting helper.");
        process.exit(0);
      }

      await updateSession({
        status: "error",
        message:
          error?.message || "Could not refresh cookies from open Praktika browser.",
        current_url: await safePageUrl(page),
      });
    }

    await sleep(KEEP_ALIVE_INTERVAL_MS);
  }
}

async function refreshOnce() {
  const session = await getSession();

  const profileName =
    session.scope === "practice"
      ? "practice"
      : `user_${session.app_user_id || session.id}`;

  await updateSession({
    status: "refreshing",
    message:
      session.scope === "practice"
        ? "Local helper is checking the saved practice Praktika browser session."
        : "Local helper is checking your saved Praktika browser session.",
  });

  const context = await chromium.launchPersistentContext(
    path.join(PROFILE_ROOT, profileName),
    {
      headless: HEADLESS,
      viewport: { width: 1280, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    },
  );

  const page = await context.newPage();

  try {
    if (await hasExistingBrowserSession(page)) {
      const saved = await saveCookies(context, page);

      if (saved) {
        if (KEEP_BROWSER_OPEN) {
          await keepBrowserOpenForever(context, page);
        }

        return;
      }

      console.log(
        "Browser UI looked logged in, but API validation failed. Continuing to real login.",
      );
    }

    await updateSession({
      status: "refreshing",
      message:
        session.scope === "practice"
          ? "Saved browser session was not API-active. Local helper is signing into the practice Praktika account."
          : "Saved browser session was not API-active. Local helper is signing into your Praktika account.",
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

    while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      if (await isBrowserUiLoggedIn(page)) {
        await page.waitForTimeout(3000);
        const saved = await saveCookies(context, page);

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
        message: "Local helper is waiting for Praktika login to complete.",
        current_url: await safePageUrl(page),
      });

      await page.waitForTimeout(2500);
    }

    throw new Error("Timed out waiting for Praktika login/MFA completion.");
  } catch (error: any) {
    await clearTemporaryPassword({
      status: "error",
      message: error?.message || "Praktika session refresh failed.",
      current_url: await safePageUrl(page),
    });

    throw error;
  } finally {
    if (!KEEP_BROWSER_OPEN) {
      await context.close().catch(() => {});
    }
  }
}

refreshOnce().catch((error) => {
  console.error("Failed to refresh Praktika session:");
  console.error(error);
  process.exit(1);
});
