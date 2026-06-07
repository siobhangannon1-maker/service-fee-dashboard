import path from "node:path";
import dotenv from "dotenv";
import { chromium, type BrowserContext, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const MEDIREF_BASE_URL = "https://www.mediref.com.au";
const PROFILE_ROOT = path.join(process.cwd(), "mediref-browser-profiles");

const HEADLESS =
  String(process.env.MEDIREF_HELPER_HEADLESS ?? "false").toLowerCase() !==
  "false";

const KEEP_BROWSER_OPEN =
  String(process.env.MEDIREF_KEEP_BROWSER_OPEN ?? "true").toLowerCase() !==
  "false";

const KEEP_ALIVE_INTERVAL_MS = Number(
  process.env.MEDIREF_KEEP_ALIVE_INTERVAL_MS || 30_000,
);

const LOGIN_TIMEOUT_MS = Number(
  process.env.MEDIREF_LOGIN_TIMEOUT_MS || 10 * 60 * 1000,
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
  pending_mediref_email: string | null;
  pending_mediref_password: string | null;
  mediref_email: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function argValue(name: string) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const sessionId = argValue("session-id");

if (!sessionId) {
  throw new Error("Missing --session-id=<mediref_sessions.id>");
}

async function getSession() {
  const { data, error } = await supabase
    .from("mediref_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "MediRef session not found.");
  }

  return data as SessionRow;
}

async function updateSession(values: Record<string, unknown>) {
  const { error } = await supabase
    .from("mediref_sessions")
    .update({ ...values, updated_at: nowIso() })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Could not update MediRef session: ${error.message}`);
  }
}

async function clearTemporaryPassword(extraValues: Record<string, unknown> = {}) {
  await updateSession({ pending_mediref_password: null, ...extraValues });
}

async function clearTemporaryCredentialsAfterSuccess(
  extraValues: Record<string, unknown> = {},
) {
  await updateSession({
    pending_mediref_email: null,
    pending_mediref_password: null,
    ...extraValues,
  });
}

async function getAndClearMfaCode() {
  const session = await getSession();
  const code = String(session.mfa_code || "").replace(/\D/g, "").trim();

  if (!code) return null;

  const { error } = await supabase
    .from("mediref_sessions")
    .update({
      mfa_code: null,
      mfa_code_updated_at: null,
      updated_at: nowIso(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Could not clear MediRef MFA code: ${error.message}`);
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

async function pageHasVisiblePasswordInput(page: Page) {
  const inputs = page.locator('input[type="password"]');
  const count = await inputs.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
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

function looksLoggedInFromUrl(url: string) {
  const lower = url.toLowerCase();
  return (
    lower.startsWith(MEDIREF_BASE_URL) &&
    !lower.includes("/login") &&
    !lower.includes("/signin") &&
    !lower.includes("/sign-in")
  );
}

async function isBrowserUiLoggedIn(page: Page) {
  const url = page.url();

  if (!looksLoggedInFromUrl(url)) return false;
  if (await pageHasVisiblePasswordInput(page)) return false;

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();

  if (
    lower.includes("log in") &&
    lower.includes("password") &&
    lower.includes("email")
  ) {
    return false;
  }

  return true;
}

async function buildCookieHeader(context: BrowserContext) {
  const cookies = await context.cookies(MEDIREF_BASE_URL);

  return {
    cookies,
    cookieHeader: cookies
      .filter((cookie) => cookie.name && cookie.value)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; "),
    hasSession: cookies.some((cookie) => cookie.name === "session"),
  };
}

async function validateSessionCookie(context: BrowserContext) {
  const { cookieHeader, hasSession } = await buildCookieHeader(context);

  if (!cookieHeader || !hasSession) return false;

  const response = await fetch(
    `${MEDIREF_BASE_URL}/search/__data.json?x-sveltekit-invalidated=010`,
    {
      method: "GET",
      headers: {
        accept: "*/*",
        cookie: cookieHeader,
        "cache-control": "no-cache",
      },
    },
  );

  const text = await response.text().catch(() => "");

  return response.ok && !text.includes("/login") && !text.includes('"type":"redirect"');
}

async function hasExistingBrowserSession(page: Page, context: BrowserContext) {
  await page.goto(`${MEDIREF_BASE_URL}/inbox`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForTimeout(2500);

  if ((await isBrowserUiLoggedIn(page)) && (await validateSessionCookie(context))) {
    return true;
  }

  await page.goto(`${MEDIREF_BASE_URL}/search`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForTimeout(2500);

  return (await isBrowserUiLoggedIn(page)) && (await validateSessionCookie(context));
}

async function switchToPasswordLoginIfNeeded(page: Page) {
 const inputDebug = await page
  .locator("input")
  .evaluateAll((inputs) =>
    inputs.map((input) => {
      const element = input as HTMLInputElement;

      return {
        type: element.getAttribute("type"),
        name: element.getAttribute("name"),
        id: element.getAttribute("id"),
        placeholder: element.getAttribute("placeholder"),
        autocomplete: element.getAttribute("autocomplete"),
        ariaLabel: element.getAttribute("aria-label"),
        valueLength: element.value?.length || 0,
        visible: Boolean(
          element.offsetWidth ||
            element.offsetHeight ||
            element.getClientRects().length,
        ),
      };
    }),
  )
  .catch((error) => [{ error: String(error) }]);

console.log("MediRef login input debug:", JSON.stringify(inputDebug, null, 2));

  if (await pageHasVisiblePasswordInput(page)) return;

  const loginWithPassword = page
    .locator(
      [
        'button:has-text("login with password")',
        'button:has-text("Login with password")',
        'a:has-text("login with password")',
        'a:has-text("Login with password")',
        'text=login with password',
        'text=Login with password',
      ].join(", "),
    )
    .first();

  if ((await loginWithPassword.count().catch(() => 0)) === 0) return;

  console.log("MediRef is showing code-login screen. Switching to password login.");

  await loginWithPassword.click({ force: true });
  await page.waitForTimeout(2000);
}

async function fillLoginIfCredentialsAvailable(page: Page) {
  const session = await getSession();

  await switchToPasswordLoginIfNeeded(page);

  let email = session.pending_mediref_email || "";
  let password = session.pending_mediref_password || "";

  if (session.scope === "practice" && (!email || !password)) {
    email = process.env.MEDIREF_EMAIL || "";
    password = process.env.MEDIREF_PASSWORD || "";
  }

  const emailField = page
  .locator(
    [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[placeholder*="email" i]',
      'input[autocomplete="email"]',
      'input[name*="username" i]',
      'input[id*="username" i]',
      'input[placeholder*="username" i]',
      'input[type="text"]',
    ].join(", "),
  )
  .filter({ hasNotText: "" })
  .first();

const passwordField = page
  .locator(
    [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]',
      'input[placeholder*="password" i]',
      'input[autocomplete="current-password"]',
    ].join(", "),
  )
  .first();

  if ((await emailField.count()) === 0 || (await passwordField.count()) === 0) {
    return false;
  }

  if (!email || !password) {
    await updateSession({
      status: "waiting_for_credentials",
      message:
        session.scope === "user"
          ? "Enter your MediRef email and password in DocuDental."
          : "Practice MediRef credentials are missing. Enter credentials or configure environment variables.",
      current_url: await safePageUrl(page),
      refresh_requested_at: null,
    });

    return false;
  }

  console.log("Submitting MediRef credentials from saved pending credentials.");

  await emailField.fill(email);
  await passwordField.fill(password);

  await page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Continue")',
    )
    .first()
    .click({ force: true });

  await page.waitForTimeout(4000);

  if (session.scope === "user") {
    await clearTemporaryPassword({
      status: "refreshing",
      message:
        "MediRef credentials were submitted. Checking whether MFA is required.",
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
      message: "MediRef requires an MFA code. Enter it in DocuDental.",
      current_url: await safePageUrl(page),
    });

    return false;
  }

  const codeInput = page
    .locator(
      'input[inputmode="numeric"], input[name*="code" i], input[id*="code" i], input[name*="mfa" i], input[id*="mfa" i], input[name*="otp" i], input[id*="otp" i], input[type="tel"], input[type="text"]',
    )
    .first();

  await codeInput.waitFor({ timeout: 15000 });
  await codeInput.fill(code);

  await page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit"), button:has-text("Login")',
    )
    .first()
    .click({ force: true });

  await updateSession({
    status: "refreshing",
    message: "MFA code submitted. Waiting for MediRef to finish signing in.",
    current_url: await safePageUrl(page),
  });

  await page.waitForTimeout(5000);

  return true;
}

async function saveCookies(context: BrowserContext, page: Page, message?: string) {
  const { cookieHeader, hasSession } = await buildCookieHeader(context);

  if (!cookieHeader) {
    throw new Error("No MediRef cookies found in the helper browser.");
  }

  if (!hasSession) {
    throw new Error("Could not find required MediRef session cookie.");
  }

  const session = await getSession();

  const emailToDisplay =
    session.pending_mediref_email ||
    session.mediref_email ||
    (session.scope === "practice" ? process.env.MEDIREF_EMAIL || null : null);

  const now = nowIso();

  await clearTemporaryCredentialsAfterSuccess({
    cookie: cookieHeader,
    status: "connected",
    message:
      message ||
      (KEEP_BROWSER_OPEN
        ? "MediRef helper browser is connected."
        : "MediRef session refreshed successfully."),
    current_url: await safePageUrl(page),
    mediref_email: emailToDisplay,
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
    `MediRef browser left open. Helper will refresh cookies every ${Math.round(
      KEEP_ALIVE_INTERVAL_MS / 1000,
    )} seconds.`,
  );

  while (true) {
    try {
      const session = await getSession();

      if (session.mfa_code && (await pageHasMfaInput(page))) {
        await submitMfaCodeIfAvailable(page);
      }

      if ((await isBrowserUiLoggedIn(page)) && (await validateSessionCookie(context))) {
        await saveCookies(
          context,
          page,
          "MediRef helper browser is connected. Helper jobs can run for this user.",
        );
      } else if (await pageHasMfaInput(page)) {
        await submitMfaCodeIfAvailable(page);
      } else if (await pageHasVisiblePasswordInput(page)) {
        const hasNewCredentials = Boolean(
          session.pending_mediref_email && session.pending_mediref_password,
        );

        if (hasNewCredentials) {
          await fillLoginIfCredentialsAvailable(page);
        } else {
          await updateSession({
            status: "waiting_for_credentials",
            message: "MediRef helper browser is open but needs login details.",
            current_url: await safePageUrl(page),
            refresh_requested_at: null,
          });
        }
      } else {
        await updateSession({
          status: "refreshing",
          message: "MediRef helper is checking whether the browser is still logged in.",
          current_url: await safePageUrl(page),
        });

        await page.goto(`${MEDIREF_BASE_URL}/inbox`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
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
          status: "error",
          message:
            "The local MediRef helper browser was closed. Start the helper again to reconnect.",
          refresh_requested_at: null,
          last_used_at: nowIso(),
        });

        console.warn("MediRef helper browser/context closed. Exiting helper.");
        process.exit(0);
      }

      await updateSession({
        status: "error",
        message: error?.message || "Could not refresh cookies from open MediRef browser.",
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
        ? "Local helper is checking the saved practice MediRef browser session."
        : "Local helper is checking your saved MediRef browser session.",
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
    if (await hasExistingBrowserSession(page, context)) {
      const saved = await saveCookies(context, page);

      if (saved) {
        if (KEEP_BROWSER_OPEN) {
          await keepBrowserOpenForever(context, page);
        }

        return;
      }
    }

    await updateSession({
      status: "refreshing",
      message:
        session.scope === "practice"
          ? "Saved browser session was not active. Local helper is signing into the practice MediRef account."
          : "Saved browser session was not active. Local helper is signing into your MediRef account.",
      current_url: await safePageUrl(page),
    });

    await page.goto(`${MEDIREF_BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    await page.waitForTimeout(2500);

    const startedAt = Date.now();
    let attemptedCredentials = false;

    while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      if ((await isBrowserUiLoggedIn(page)) && (await validateSessionCookie(context))) {
        await page.waitForTimeout(2000);
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
        message: "Local helper is waiting for MediRef login to complete.",
        current_url: await safePageUrl(page),
      });

      await page.waitForTimeout(2500);
    }

    throw new Error("Timed out waiting for MediRef login/MFA completion.");
  } catch (error: any) {
    await clearTemporaryPassword({
      status: "error",
      message: error?.message || "MediRef session refresh failed.",
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
  console.error("Failed to refresh MediRef session:");
  console.error(error);
  process.exit(1);
});
