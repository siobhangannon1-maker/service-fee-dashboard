import path from "node:path";
import dotenv from "dotenv";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const USER_DATA_DIR = path.join(process.cwd(), "praktika-browser-profile");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!serviceRoleKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const SESSION_ID = "main";

async function updateSession(values: Record<string, unknown>) {
  const { error } = await supabase.from("praktika_session").upsert({
    id: SESSION_ID,
    ...values,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Could not update Praktika session: ${error.message}`);
  }
}

async function getSession() {
  const { data, error } = await supabase
    .from("praktika_session")
    .select("*")
    .eq("id", SESSION_ID)
    .single();

  if (error) {
    throw new Error(`Could not load Praktika session: ${error.message}`);
  }

  return data;
}

async function getAndClearMfaCode() {
  const session = await getSession();
  const code = String(session?.mfa_code || "").replace(/\D/g, "").trim();

  if (!code) return null;

  const { error } = await supabase
    .from("praktika_session")
    .update({
      mfa_code: null,
      mfa_code_updated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", SESSION_ID);

  if (error) {
    throw new Error(`Could not clear MFA code: ${error.message}`);
  }

  return code;
}

async function isLoggedIn(page: any) {
  const url = page.url();

  return (
    url.includes("praktika.praktika.net.au/v2/") && !url.includes("/v2/login")
  );
}

async function fillLoginIfVisible(page: any, username: string, password: string) {
  const usernameField = page
    .locator(
      'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[type="text"]',
    )
    .first();

  const passwordField = page.locator('input[type="password"]').first();

  if ((await usernameField.count()) > 0 && (await passwordField.count()) > 0) {
    await usernameField.fill(username);
    await passwordField.fill(password);

    await page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Continue")',
      )
      .first()
      .click();

    await page.waitForTimeout(3000);
  }
}

async function submitMfaCodeIfAvailable(page: any) {
  const code = await getAndClearMfaCode();

  if (!code) return false;

  const codeInput = page
    .locator(
      'input[inputmode="numeric"], input[name*="code" i], input[id*="code" i], input[type="text"], input[type="tel"]',
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

  await page.waitForTimeout(5000);

  return true;
}

async function saveCookies(context: any) {
  const cookies = await context.cookies("https://praktika.praktika.net.au");

  const phpSession = cookies.find((cookie: any) => cookie.name === "PHPSESSID");
  const uat = cookies.find((cookie: any) => cookie.name === "UAT");

  if (!phpSession || !uat) {
    throw new Error("Could not find PHPSESSID and UAT cookies.");
  }

  const cookieHeader = `PHPSESSID=${phpSession.value}; UAT=${uat.value}`;

  await updateSession({
    cookie: cookieHeader,
    status: "connected",
    message: "Praktika session refreshed successfully.",
    current_url: null,
    mfa_code: null,
    mfa_code_updated_at: null,
  });
}

async function refreshOnce() {
  await updateSession({
    status: "refreshing",
    message: "Local helper is opening Praktika session refresh browser...",
  });

  const username = process.env.PRAKTIKA_USERNAME;
  const password = process.env.PRAKTIKA_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing PRAKTIKA_USERNAME or PRAKTIKA_PASSWORD in .env.local");
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
  });

  const page = await context.newPage();

  try {
    await page.goto("https://praktika.praktika.net.au/v2/login", {
      waitUntil: "domcontentloaded",
    });

    await page.waitForTimeout(2000);

    if (!(await isLoggedIn(page))) {
      await fillLoginIfVisible(page, username, password);
    }

    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    while (Date.now() - start < timeoutMs) {
      if (await isLoggedIn(page)) {
        await page.waitForTimeout(5000);
        await saveCookies(context);
        await context.close();
        return;
      }

      await updateSession({
        status: "waiting_for_mfa",
        message:
          "MFA required. Enter the email code in the deployed DocuDental Praktika Session panel.",
        current_url: page.url(),
      });

      await submitMfaCodeIfAvailable(page).catch(async (error) => {
        await updateSession({
          status: "waiting_for_mfa",
          message: `Could not submit MFA code automatically: ${error.message}`,
          current_url: page.url(),
        });
      });

      await page.waitForTimeout(2000);
    }

    throw new Error("Timed out waiting for Praktika login/MFA completion.");
  } catch (error: any) {
    await updateSession({
      status: "error",
      message: error?.message || "Praktika session refresh failed.",
      current_url: page.url(),
    });

    await context.close();
    throw error;
  }
}

async function main() {
  await refreshOnce();
}

main().catch((error) => {
  console.error("Failed to refresh Praktika cookie:");
  console.error(error);
  process.exit(1);
});