import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config({ path: ".env.local" });

const ENV_PATH = path.join(process.cwd(), ".env.local");

// 🔐 Persistent browser profile folder
const USER_DATA_DIR = path.join(process.cwd(), "praktika-browser-profile");

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

async function main() {
  const username = process.env.PRAKTIKA_USERNAME;
  const password = process.env.PRAKTIKA_PASSWORD;

  if (!username || !password) {
    throw new Error("Missing PRAKTIKA_USERNAME or PRAKTIKA_PASSWORD in .env.local");
  }

  // 🔥 Use persistent context instead of newContext()
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
  });

  const page = await context.newPage();

  await page.goto("https://praktika.praktika.net.au/v2/login", {
    waitUntil: "domcontentloaded",
  });

  // If already logged in, skip login
  if (!page.url().includes("/login")) {
    console.log("Already logged in — refreshing cookies...");
  } else {
    await page
      .locator(
        'input[type="email"], input[name="email"], input[name="username"], input[name="login"], input[type="text"]'
      )
      .first()
      .fill(username);

    await page.locator('input[type="password"]').first().fill(password);

    await page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")'
      )
      .first()
      .click();
  }

  // Wait for login/app load
  await page.waitForLoadState("networkidle").catch(() => {});

  await page
    .waitForURL(/praktika\.praktika\.net\.au\/v2\/(?!login)/, {
      timeout: 60000,
    })
    .catch(() => {});

  await page.waitForTimeout(5000);

  console.log("Current URL:", page.url());

  // If MFA appears → pause for manual completion
  if (page.url().includes("/login")) {
    console.log("MFA likely required.");
    console.log("Complete login in the browser, then press Enter here.");

    await new Promise<void>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", () => resolve());
    });

    await page.waitForTimeout(5000);
  }

  const cookies = await context.cookies("https://praktika.praktika.net.au");

  const phpSession = cookies.find((c) => c.name === "PHPSESSID");
  const uat = cookies.find((c) => c.name === "UAT");

  if (!phpSession || !uat) {
    throw new Error("Could not find Praktika cookies — login likely failed.");
  }

  const cookieHeader = `PHPSESSID=${phpSession.value}; UAT=${uat.value}`;

  updateEnvValue("PRAKTIKA_COOKIE", cookieHeader);

  console.log("✅ Praktika cookie refreshed");
  console.log("Restart your dev server: npm run dev");

  await context.close();
}

main().catch((err) => {
  console.error("Failed to refresh Praktika cookie:");
  console.error(err);
  process.exit(1);
});