import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const PROFILE_ROOT = path.join(process.cwd(), "praktika-browser-profiles");

const HEADLESS =
  String(process.env.PRAKTIKA_HELPER_HEADLESS ?? "true").toLowerCase() !==
  "false";

const KEEP_BROWSER_OPEN =
  String(process.env.PRAKTIKA_KEEP_BROWSER_OPEN ?? "false").toLowerCase() ===
  "true";

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
  mfa_code: string | null;
  pending_praktika_username: string | null;
  pending_praktika_password: string | null;
  praktika_username: string | null;
};

function nowIso() {
  return new Date().toISOString();
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

async function safePageUrl(page: any) {
  try {
    return page.url();
  } catch {
    return null;
  }
}

async function pageHasPasswordInput(page: any) {
  const inputs = page.locator('input[type="password"]');
  const count = await inputs.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const visible = await input.isVisible().catch(() => false);
    if (visible) return true;
  }

  return false;
}

async function pageHasMfaInput(page: any) {
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

async function isLoggedIn(page: any) {
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

  if (await pageHasPasswordInput(page)) {
    return false;
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lowerBody = bodyText.toLowerCase();

  if (
    lowerBody.includes("login failed") ||
    lowerBody.includes("user session is logged-out") ||
    lowerBody.includes("user session is logged out")
  ) {
    return false;
  }

  return url.includes(PRAKTIKA_BASE_URL.toLowerCase());
}

async function hasExistingBrowserSession(page: any) {
  await page.goto(`${PRAKTIKA_BASE_URL}/v2/`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(3000);

  if (await isLoggedIn(page)) return true;

  await page.goto(`${PRAKTIKA_BASE_URL}/`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(3000);

  return await isLoggedIn(page);
}

async function fillLoginIfCredentialsAvailable(page: any) {
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
    .click();

  await page.waitForTimeout(4000);

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

async function submitMfaCodeIfAvailable(page: any) {
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
    .click();

  await updateSession({
    status: "refreshing",
    message: "MFA code submitted. Waiting for Praktika to finish signing in.",
    current_url: await safePageUrl(page),
  });

  await page.waitForTimeout(5000);

  return true;
}

async function saveCookies(context: any, page: any) {
  const cookies = await context.cookies(PRAKTIKA_BASE_URL);

  if (!cookies.length) {
    throw new Error("No Praktika cookies found in the helper browser.");
  }

  const cookieHeader = cookies
    .filter((cookie: any) => cookie.name && cookie.value)
    .map((cookie: any) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  const hasPhpSession = cookies.some((cookie: any) => cookie.name === "PHPSESSID");
  const hasUat = cookies.some((cookie: any) => cookie.name === "UAT");

  if (!hasPhpSession || !hasUat) {
    throw new Error("Could not find required Praktika PHPSESSID and UAT cookies.");
  }

  const session = await getSession();

  const usernameToDisplay =
    session.pending_praktika_username ||
    session.praktika_username ||
    (session.scope === "practice" ? process.env.PRAKTIKA_USERNAME || null : null);

  await clearTemporaryCredentialsAfterSuccess({
    cookie: cookieHeader,
    status: "connected",
    message: KEEP_BROWSER_OPEN
      ? "Praktika session connected. Full browser cookies saved from open helper browser."
      : "Praktika session refreshed successfully.",
    current_url: await safePageUrl(page),
    praktika_username: usernameToDisplay,
    mfa_code: null,
    mfa_code_updated_at: null,
    refresh_requested_at: null,
    refreshed_at: nowIso(),
    last_used_at: nowIso(),
  });
}

async function keepBrowserOpenForever(context: any, page: any) {
  console.log(
    "Praktika browser left open. Helper will keep saving fresh cookies every 60 seconds.",
  );

  while (true) {
    try {
      if (await isLoggedIn(page)) {
        await saveCookies(context, page);

        await updateSession({
          status: "connected",
          message:
            "Praktika browser is still open and connected. Cookies refreshed from live browser.",
          current_url: await safePageUrl(page),
          refresh_requested_at: null,
          last_used_at: nowIso(),
        });
      } else {
        await updateSession({
          status: "expired",
          message: "Praktika helper browser is open but no longer logged in.",
          current_url: await safePageUrl(page),
        });
      }
    } catch (error: any) {
      await updateSession({
        status: "error",
        message:
          error?.message || "Could not refresh cookies from open Praktika browser.",
        current_url: await safePageUrl(page),
      });
    }

    await page.waitForTimeout(60_000);
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
      await saveCookies(context, page);

      if (KEEP_BROWSER_OPEN) {
        await keepBrowserOpenForever(context, page);
      }

      return;
    }

    await updateSession({
      status: "refreshing",
      message:
        session.scope === "practice"
          ? "Saved browser session was not active. Local helper is signing into the practice Praktika account."
          : "Saved browser session was not active. Local helper is signing into your Praktika account.",
      current_url: await safePageUrl(page),
    });

    await page.goto(`${PRAKTIKA_BASE_URL}/login/`, {
      waitUntil: "domcontentloaded",
    });

    await page.waitForTimeout(2500);

    const startedAt = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    let attemptedCredentials = false;

    while (Date.now() - startedAt < timeoutMs) {
      if (await isLoggedIn(page)) {
        await page.waitForTimeout(3000);
        await saveCookies(context, page);

        if (KEEP_BROWSER_OPEN) {
          await keepBrowserOpenForever(context, page);
        }

        return;
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

      if (await pageHasPasswordInput(page)) {
        await updateSession({
          status: "waiting_for_credentials",
          message: "Enter your Praktika username and password in DocuDental.",
          current_url: await safePageUrl(page),
        });

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