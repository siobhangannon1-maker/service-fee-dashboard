import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config({ path: ".env.local" });

const ENV_PATH = path.join(process.cwd(), ".env.local");
const USER_DATA_DIR = path.join(process.cwd(), "praktika-browser-profile");
const SESSION_DIR = path.join(process.cwd(), ".praktika-session");
const STATE_PATH = path.join(SESSION_DIR, "state.json");
const MFA_CODE_PATH = path.join(SESSION_DIR, "mfa-code.txt");

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function writeState(state: Record<string, unknown>) {
  ensureSessionDir();
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

function updateEnvValue(key: string, value: string) {
  let envText = "";

  if (fs.existsSync(ENV_PATH)) {
    envText = fs.readFileSync(ENV_PATH, "utf8");
  }

  const escapedValue = value.replace(/"/g, '\\"');
  const line = `${key}="${escapedValue}"`;
  const regex = new RegExp(`^${key}=.*$`, "m");

  if (regex.test(envText)) {
    envText = envText.replace(regex, line);
  } else {
    envText = `${envText.trim()}\n${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, envText.trim() + "\n");
}

async function isLoggedIn(page: any) {
  const url = page.url();
  return url.includes("praktika.praktika.net.au/v2/") && !url.includes("/v2/login");
}

async function fillLoginIfVisible(page: any, username: string, password: string) {
  const usernameField = page
    .locator(
      'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[type="text"]'
    )
    .first();

  const passwordField = page.locator('input[type="password"]').first();

  if ((await usernameField.count()) > 0 && (await passwordField.count()) > 0) {
    await usernameField.fill(username);
    await passwordField.fill(password);

    await page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in"), button:has-text("Continue")'
      )
      .first()
      .click();

    await page.waitForTimeout(3000);
  }
}

async function submitMfaCodeIfProvided(page: any) {
  if (!fs.existsSync(MFA_CODE_PATH)) return false;

  const code = fs.readFileSync(MFA_CODE_PATH, "utf8").replace(/\D/g, "").trim();

  if (!code) return false;

  fs.rmSync(MFA_CODE_PATH, { force: true });

  const codeInput = page
    .locator(
      'input[inputmode="numeric"], input[name*="code" i], input[id*="code" i], input[type="text"], input[type="tel"]'
    )
    .first();

  await codeInput.waitFor({ timeout: 15000 });
  await codeInput.fill(code);

  await page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Verify"), button:has-text("Continue"), button:has-text("Submit"), button:has-text("Login")'
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
  updateEnvValue("PRAKTIKA_COOKIE", cookieHeader);
}

async function main() {
  ensureSessionDir();
  fs.rmSync(MFA_CODE_PATH, { force: true });

  writeState({
    status: "running",
    message: "Opening Praktika session refresh browser...",
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

        writeState({
          status: "success",
          message: "Praktika session refreshed successfully.",
          currentUrl: page.url(),
        });

        await context.close();
        return;
      }

      writeState({
        status: "mfa_required",
        message:
          "MFA may be required. Approve it manually in the browser, or enter the email code in DocuDental.",
        currentUrl: page.url(),
      });

      await submitMfaCodeIfProvided(page).catch((error) => {
        writeState({
          status: "mfa_required",
          message: `Could not submit MFA code automatically: ${error.message}`,
          currentUrl: page.url(),
        });
      });

      await page.waitForTimeout(2000);
    }

    throw new Error("Timed out waiting for Praktika login/MFA completion.");
  } catch (error: any) {
    writeState({
      status: "error",
      message: error?.message || "Praktika session refresh failed.",
      currentUrl: page.url(),
    });

    await context.close();
    throw error;
  }
}

main().catch((error) => {
  console.error("Failed to refresh Praktika cookie:");
  console.error(error);
  process.exit(1);
});