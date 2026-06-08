import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
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

const AUTO_SEND =
  String(process.env.MEDIREF_AUTO_SEND ?? "false").toLowerCase() === "true";

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

type MedirefHelperJob = {
  id: string;
  app_user_id: string | null;
  job_type: string;
  status: string;
  priority: number;
  payload: any;
  result: any;
  error: string | null;
  attempts: number | null;
  locked_at: string | null;
  locked_by: string | null;
  available_at: string;
  created_at: string;
  updated_at: string;
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

  return (
    response.ok &&
    !text.includes("/login") &&
    !text.includes('"type":"redirect"')
  );
}

async function hasExistingBrowserSession(page: Page, context: BrowserContext) {
  await page.goto(`${MEDIREF_BASE_URL}/inbox`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForTimeout(2500);

  if (
    (await isBrowserUiLoggedIn(page)) &&
    (await validateSessionCookie(context))
  ) {
    return true;
  }

  await page.goto(`${MEDIREF_BASE_URL}/search`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForTimeout(2500);

  return (
    (await isBrowserUiLoggedIn(page)) &&
    (await validateSessionCookie(context))
  );
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);

    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      const visible = await item.isVisible().catch(() => false);

      if (visible) {
        await item.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

async function getVisibleEmailField(page: Page) {
  const locator = page.locator(
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
  );

  const count = await locator.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const field = locator.nth(i);
    const visible = await field.isVisible().catch(() => false);
    if (visible) return field;
  }

  return null;
}

async function getVisiblePasswordField(page: Page) {
  const locator = page.locator(
    [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]',
      'input[placeholder*="password" i]',
      'input[autocomplete="current-password"]',
    ].join(", "),
  );

  const count = await locator.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const field = locator.nth(i);
    const visible = await field.isVisible().catch(() => false);
    if (visible) return field;
  }

  return null;
}

async function fillPracticeLoginIfCredentialsAvailable(page: Page) {
  const session = await getSession();

  if (session.scope !== "practice") {
    await updateSession({
      status: "expired",
      message: "MediRef uses the shared practice session only.",
      refresh_requested_at: null,
      current_url: await safePageUrl(page),
    });

    return false;
  }

  const email =
    session.pending_mediref_email ||
    process.env.MEDIREF_EMAIL ||
    session.mediref_email ||
    "";

  const password =
    session.pending_mediref_password || process.env.MEDIREF_PASSWORD || "";

  if (!email || !password) {
    await updateSession({
      status: "waiting_for_credentials",
      message:
        "Practice MediRef credentials are missing. Enter credentials in MediRef tools or configure MEDIREF_EMAIL and MEDIREF_PASSWORD on the Mac Mini.",
      current_url: await safePageUrl(page),
      refresh_requested_at: null,
    });

    return false;
  }

  const passwordFieldBeforeEmail = await getVisiblePasswordField(page);

  if (passwordFieldBeforeEmail) {
    console.log("MediRef password field is visible. Entering password.");

    await passwordFieldBeforeEmail.fill(password);

    await clickFirstVisible(page, [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'button:has-text("Sign in")',
      'button:has-text("Continue")',
    ]);

    await updateSession({
      status: "refreshing",
      message:
        "Practice MediRef password was submitted. Checking whether verification is required.",
      current_url: await safePageUrl(page),
    });

    await page.waitForTimeout(4000);
    return true;
  }

  const emailField = await getVisibleEmailField(page);

  if (emailField) {
    const currentValue = await emailField.inputValue().catch(() => "");

    if (!currentValue.trim()) {
      console.log("Entering MediRef practice email.");
      await emailField.fill(email);
      await page.waitForTimeout(800);
    }

    console.log("Clicking MediRef Continue after email.");

    await clickFirstVisible(page, [
      'button:has-text("Continue")',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Next")',
    ]);

    await updateSession({
      status: "refreshing",
      message:
        "Practice MediRef email was submitted. Waiting for password option.",
      current_url: await safePageUrl(page),
    });

    await page.waitForTimeout(2500);
  }

  const clickedUsePassword = await clickFirstVisible(page, [
    'button:has-text("Use password")',
    'button:has-text("use password")',
    'a:has-text("Use password")',
    'a:has-text("use password")',
    'button:has-text("Login with password")',
    'button:has-text("login with password")',
    'a:has-text("Login with password")',
    'a:has-text("login with password")',
  ]);

  if (clickedUsePassword) {
    console.log("Clicked MediRef Use password.");
    await page.waitForTimeout(2000);
  }

  const passwordField = await getVisiblePasswordField(page);

  if (!passwordField) {
    await updateSession({
      status: "refreshing",
      message:
        "Practice MediRef email was entered. Waiting for the password field to appear.",
      current_url: await safePageUrl(page),
    });

    return true;
  }

  console.log("Entering MediRef practice password.");

  await passwordField.fill(password);

  await clickFirstVisible(page, [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Continue")',
  ]);

  await updateSession({
    status: "refreshing",
    message:
      "Practice MediRef password was submitted. Checking whether verification is required.",
    current_url: await safePageUrl(page),
  });

  await page.waitForTimeout(4000);
  return true;
}

async function submitMfaCodeIfAvailable(page: Page) {
  if (!(await pageHasMfaInput(page))) return false;

  const code = await getAndClearMfaCode();

  if (!code) {
    await updateSession({
      status: "waiting_for_mfa",
      message: "MediRef requires a verification code. Enter it in DocuDental.",
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
    message:
      "Verification code submitted. Waiting for MediRef to finish signing in.",
    current_url: await safePageUrl(page),
  });

  await page.waitForTimeout(5000);

  return true;
}

async function saveCookies(
  context: BrowserContext,
  page: Page,
  message?: string,
) {
  const { cookieHeader, hasSession } = await buildCookieHeader(context);

  if (!cookieHeader) {
    throw new Error("No MediRef cookies found in the helper browser.");
  }

  if (!hasSession) {
    throw new Error("Could not find required MediRef session cookie.");
  }

  const session = await getSession();

  if (session.scope !== "practice") {
    throw new Error("MediRef helper only supports the practice session.");
  }

  const emailToDisplay =
    session.pending_mediref_email ||
    session.mediref_email ||
    process.env.MEDIREF_EMAIL ||
    null;

  const now = nowIso();

  await clearTemporaryCredentialsAfterSuccess({
    cookie: cookieHeader,
    status: "connected",
    message:
      message ||
      (KEEP_BROWSER_OPEN
        ? "MediRef practice helper browser is connected."
        : "MediRef practice session refreshed successfully."),
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

function workerId() {
  return `mediref-session-${sessionId}-${process.pid}`;
}

async function claimNextPendingMedirefJob() {
  const { data: candidates, error } = await supabase
    .from("mediref_helper_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Could not check pending MediRef jobs:", error.message);
    return null;
  }

  const candidate = candidates?.[0] as MedirefHelperJob | undefined;
  if (!candidate) return null;

  const { data: claimed, error: claimError } = await supabase
    .from("mediref_helper_jobs")
    .update({
      status: "processing",
      attempts: Number(candidate.attempts || 0) + 1,
      locked_at: nowIso(),
      locked_by: workerId(),
      updated_at: nowIso(),
    })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("*")
    .single();

  if (claimError || !claimed) {
    return null;
  }

  return claimed as MedirefHelperJob;
}

async function completeMedirefJob(
  jobId: string,
  response: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("mediref_helper_jobs")
    .update({
      status: "completed",
      result: response,
      error: null,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Could not complete MediRef job: ${error.message}`);
  }
}

async function failMedirefJob(jobId: string, message: string) {
  const { error } = await supabase
    .from("mediref_helper_jobs")
    .update({
      status: "failed",
      error: message,
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Could not fail MediRef job: ${error.message}`);
  }
}

async function downloadStagedAttachments(job: MedirefHelperJob) {
  const rawAttachments =
    Array.isArray(job.payload?.attachments) && job.payload.attachments.length > 0
      ? job.payload.attachments
      : job.payload?.attachment
        ? [job.payload.attachment]
        : [];

  if (rawAttachments.length === 0) {
    throw new Error("MediRef job is missing attachment details.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mediref-send-"));
  const files: Array<{ localPath: string; fileName: string }> = [];

  for (const attachment of rawAttachments) {
    if (!attachment?.bucket || !attachment?.storagePath || !attachment?.fileName) {
      throw new Error("MediRef job has an invalid attachment.");
    }

    const { data, error } = await supabase.storage
      .from(attachment.bucket)
      .download(attachment.storagePath);

    if (error || !data) {
      throw new Error(
        `Could not download staged MediRef PDF: ${
          error?.message || "No file returned."
        }`,
      );
    }

    const localPath = path.join(tempDir, attachment.fileName);
    await fs.writeFile(localPath, Buffer.from(await data.arrayBuffer()));

    files.push({
      localPath,
      fileName: attachment.fileName,
    });
  }

  return { tempDir, files };
}

function normaliseForMatching(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/^dr\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDobForMediref(value: unknown) {
  const clean = String(value || "").trim();

  if (!clean) return "";

  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  return clean;
}

function getRecipientPracticeName(request: any) {
  return String(
    request?.recipient?.practiceName ||
      request?.recipient?.practice_name ||
      request?.referrerPracticeName ||
      request?.referrer_practice_name ||
      request?.practiceName ||
      request?.practice_name ||
      "",
  ).trim();
}

async function debugVisibleInputs(page: Page) {
  const inputs = await page
    .locator("input, textarea, select, button")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const htmlElement = element as HTMLElement;
        return {
          tag: element.tagName,
          type: element.getAttribute("type"),
          name: element.getAttribute("name"),
          id: element.getAttribute("id"),
          placeholder: element.getAttribute("placeholder"),
          ariaLabel: element.getAttribute("aria-label"),
          text: htmlElement.innerText?.slice(0, 100) || "",
          visible: Boolean(
            htmlElement.offsetWidth ||
              htmlElement.offsetHeight ||
              htmlElement.getClientRects().length,
          ),
        };
      }),
    )
    .catch((error) => [{ error: String(error) }]);

  console.log("MediRef send page element debug:", JSON.stringify(inputs, null, 2));
}

async function debugRecipientResults(page: Page) {
  const results = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");

  console.log("MediRef recipient/search page text:", results.slice(0, 4000));
}

async function fillFirstVisibleTextFieldByHints(
  page: Page,
  hints: string[],
  value: string,
) {
  if (!value.trim()) return false;

  const hintSelector = hints
    .flatMap((hint) => [
      `input[name*="${hint}" i]`,
      `input[id*="${hint}" i]`,
      `input[placeholder*="${hint}" i]`,
      `input[aria-label*="${hint}" i]`,
      `textarea[name*="${hint}" i]`,
      `textarea[id*="${hint}" i]`,
      `textarea[placeholder*="${hint}" i]`,
      `textarea[aria-label*="${hint}" i]`,
    ])
    .join(", ");

  const locator = page.locator(hintSelector);
  const count = await locator.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const field = locator.nth(i);
    const visible = await field.isVisible().catch(() => false);
    if (!visible) continue;

    await field.fill(value);
    return true;
  }

  return false;
}

async function fillComposePatientDetails(page: Page, request: any) {
  const patient = request.patient || {};
  const firstName = String(patient.firstName || patient.first_name || "").trim();
  const lastName = String(patient.lastName || patient.last_name || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const dob = formatDobForMediref(patient.dob || patient.dateOfBirth);

  const nameField = page
    .locator(
      [
        'input[name*="patient" i]',
        'input[id*="patient" i]',
        'input[placeholder*="patient" i]',
        'input[name*="name" i]',
        'input[id*="name" i]',
        'input[placeholder*="name" i]',
      ].join(", "),
    )
    .first();

  if (fullName && (await nameField.count().catch(() => 0)) > 0) {
    await nameField.fill(fullName).catch(async () => {
      await fillFirstVisibleTextFieldByHints(page, ["patient", "name"], fullName);
    });
  } else if (fullName) {
    await fillFirstVisibleTextFieldByHints(page, ["patient", "name"], fullName);
  }

  if (dob) {
    const dobFilled = await fillFirstVisibleTextFieldByHints(
      page,
      ["dob", "birth", "date"],
      dob,
    );

    if (!dobFilled) {
      await page.getByLabel(/date of birth|dob/i).fill(dob).catch(() => null);
    }
  }
}

async function getRecipientSearchInput(page: Page) {
  const candidates = page.locator(
    [
      'input[placeholder*="Search directory" i]',
      'input[placeholder*="directory" i]',
      'input[placeholder*="recipient" i]',
      'input[name*="recipient" i]',
      'input[id*="recipient" i]',
      'input[aria-label*="recipient" i]',
      'input[aria-label*="directory" i]',
      'input[type="search"]',
      'input[type="text"]',
    ].join(", "),
  );

  const count = await candidates.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;

    const box = await candidate.boundingBox().catch(() => null);
    if (box && box.width > 250) return candidate;
  }

  return null;
}

async function chooseBestRecipientResult(params: {
  page: Page;
  recipientName: string;
  practiceName: string;
}) {
  const { page, recipientName, practiceName } = params;
  const nameKey = normaliseForMatching(recipientName);
  const practiceKey = normaliseForMatching(practiceName);

  const candidateSelectors = [
    '[role="option"]',
    '[cmdk-item]',
    '[data-radix-collection-item]',
    'li',
    'button',
    'div:has-text("@")',
  ];

  let best: { index: number; score: number; selector: string; text: string } | null = null;

  for (const selector of candidateSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 50);

    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      const visible = await item.isVisible().catch(() => false);
      if (!visible) continue;

      const text = await item.innerText().catch(() => "");
      const normalisedText = normaliseForMatching(text);

      if (!normalisedText || normalisedText.length < 4) continue;

      let score = 0;

      if (practiceKey && normalisedText.includes(practiceKey)) score += 100;
      if (nameKey && normalisedText.includes(nameKey)) score += 80;

      const nameWords = nameKey.split(" ").filter((word) => word.length > 2);
      const practiceWords = practiceKey.split(" ").filter((word) => word.length > 2);

      for (const word of nameWords) {
        if (normalisedText.includes(word)) score += 15;
      }

      for (const word of practiceWords) {
        if (normalisedText.includes(word)) score += 12;
      }

      if (text.includes("@")) score += 10;

      if (score > 0 && (!best || score > best.score)) {
        best = { index: i, score, selector, text };
      }
    }

    if (best && best.score >= 100) break;
  }

  if (!best) return false;

  console.log("Best MediRef recipient match:", {
    score: best.score,
    selector: best.selector,
    text: best.text.slice(0, 500),
  });

  await page.locator(best.selector).nth(best.index).click({ force: true });
  await page.waitForTimeout(1500);

  return true;
}

async function searchAndSelectMedirefRecipient(page: Page, request: any) {
  const recipient = request.recipient || {};
  const recipientName = String(recipient.name || "").trim();
  const recipientEmail = String(recipient.email || "").trim();
  const providerNumber = String(recipient.providerNumber || "").trim();
  const practiceName = getRecipientPracticeName(request);

  const searchInput = await getRecipientSearchInput(page);

  if (!searchInput) {
    await debugVisibleInputs(page);
    throw new Error("Could not find MediRef recipient directory search field.");
  }

  const queries = [
    practiceName && recipientName ? `${practiceName} ${recipientName}` : "",
    practiceName,
    recipientName,
    providerNumber,
    recipientEmail,
  ].filter(Boolean);

  for (const query of queries) {
    console.log("Searching MediRef directory:", query);

    await searchInput.fill("");
    await page.waitForTimeout(250);
    await searchInput.fill(query);
    await page.waitForTimeout(2500);

    const selected = await chooseBestRecipientResult({
      page,
      recipientName,
      practiceName,
    });

    if (selected) return true;
  }

  await debugRecipientResults(page);

  throw new Error(
    `Could not automatically match MediRef recipient. Tried referrer "${recipientName}" and practice "${practiceName}".`,
  );
}

async function uploadPdfsToFileInput(page: Page, localPaths: string[]) {
  const fileInput = page.locator('input[type="file"]').first();

  if ((await fileInput.count().catch(() => 0)) === 0) {
    return false;
  }

  await fileInput.setInputFiles(localPaths);
  return true;
}

async function openComposePage(page: Page) {
  await page.goto(`${MEDIREF_BASE_URL}/compose`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });

  await page.waitForTimeout(3000);

  if (!page.url().toLowerCase().includes("/compose")) {
    await clickFirstVisible(page, [
      'a:has-text("Compose")',
      'button:has-text("Compose")',
      'a[href*="compose"]',
    ]);

    await page.waitForTimeout(3000);
  }
}

async function sendMedirefLetterWithBrowser(
  page: Page,
  job: MedirefHelperJob,
  localPdfPaths: string[],
) {
  const request = job.payload;
  const recipient = request.recipient || {};
  const cc = Array.isArray(request.cc) ? request.cc : [];
  const practiceName = getRecipientPracticeName(request);

  await openComposePage(page);

  await fillComposePatientDetails(page, request);

  await searchAndSelectMedirefRecipient(page, request);

  if (cc.length > 0) {
    await fillFirstVisibleTextFieldByHints(
      page,
      ["cc", "copy"],
      cc
        .map((item: any) => item.email || item.name || item.providerNumber)
        .filter(Boolean)
        .join(", "),
    );
  }

  await fillFirstVisibleTextFieldByHints(
    page,
    ["message", "note", "body", "details"],
    String(request.message || ""),
  );

  const uploaded = await uploadPdfsToFileInput(page, localPdfPaths);

  await page.waitForTimeout(2500);
  await debugVisibleInputs(page);

  if (!uploaded) {
    throw new Error(
      "Could not find a MediRef PDF upload field. The helper opened MediRef and filled what it could; inspect the element debug output to add the exact selector.",
    );
  }

  if (!AUTO_SEND) {
    console.log(
      "MediRef job prepared but not sent because MEDIREF_AUTO_SEND is not true.",
    );

    return {
      prepared: true,
      sent: false,
      autoSend: false,
      currentUrl: await safePageUrl(page),
      recipient: {
        name: recipient.name || null,
        practiceName: practiceName || null,
        email: recipient.email || null,
        providerNumber: recipient.providerNumber || null,
      },
      message:
        "MediRef form was prepared and PDF was attached. Final send was not clicked because MEDIREF_AUTO_SEND is false.",
    };
  }

  const clickedSend = await clickFirstVisible(page, [
    'button:has-text("Send")',
    'button:has-text("Submit")',
    'button:has-text("Deliver")',
    'button:has-text("Continue")',
    'input[type="submit"]',
  ]);

  if (!clickedSend) {
    throw new Error("Could not find the final MediRef Send button.");
  }

  await page.waitForTimeout(6000);

  return {
    prepared: true,
    sent: true,
    autoSend: true,
    currentUrl: await safePageUrl(page),
    recipient: {
      name: recipient.name || null,
      practiceName: practiceName || null,
      email: recipient.email || null,
      providerNumber: recipient.providerNumber || null,
    },
  };
}

async function processOnePendingMedirefJob(page: Page, context: BrowserContext) {
  if (
    !(await isBrowserUiLoggedIn(page)) ||
    !(await validateSessionCookie(context))
  ) {
    return false;
  }

  const job = await claimNextPendingMedirefJob();

  if (!job) return false;

  console.log(`Processing MediRef job ${job.id} (${job.job_type}).`);

  let tempDir: string | null = null;

  try {
    if (job.job_type !== "send_mediref_letter") {
      throw new Error(`Unsupported MediRef job type: ${job.job_type}`);
    }

    const downloaded = await downloadStagedAttachments(job);
    tempDir = downloaded.tempDir;

    const result = await sendMedirefLetterWithBrowser(
      page,
      job,
      downloaded.files.map((file) => file.localPath),
    );

    await completeMedirefJob(job.id, {
      ...result,
      completedAt: nowIso(),
    });

    console.log(`Completed MediRef job ${job.id}.`);
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "MediRef job failed.";

    console.error(`MediRef job ${job.id} failed:`, error);

    await failMedirefJob(job.id, message);
    return true;
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    }
  }
}

async function keepBrowserOpenForever(context: BrowserContext, page: Page) {
  console.log(
    `MediRef practice browser left open. Helper will refresh cookies every ${Math.round(
      KEEP_ALIVE_INTERVAL_MS / 1000,
    )} seconds.`,
  );

  while (true) {
    try {
      const session = await getSession();

      if (session.scope !== "practice") {
        await updateSession({
          status: "expired",
          message: "MediRef uses the shared practice session only.",
          refresh_requested_at: null,
          last_used_at: nowIso(),
        });

        process.exit(0);
      }

      if (session.mfa_code && (await pageHasMfaInput(page))) {
        await submitMfaCodeIfAvailable(page);
      }

      if (
        (await isBrowserUiLoggedIn(page)) &&
        (await validateSessionCookie(context))
      ) {
        await saveCookies(
          context,
          page,
          "MediRef practice helper browser is connected. Helper jobs can run.",
        );

        await processOnePendingMedirefJob(page, context);
      } else if (await pageHasMfaInput(page)) {
        await submitMfaCodeIfAvailable(page);
      } else {
        await fillPracticeLoginIfCredentialsAvailable(page);
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
        message:
          error?.message ||
          "Could not refresh cookies from open MediRef browser.",
        current_url: await safePageUrl(page),
      });
    }

    await sleep(KEEP_ALIVE_INTERVAL_MS);
  }
}

async function refreshOnce() {
  const session = await getSession();

  if (session.scope !== "practice") {
    await updateSession({
      status: "expired",
      message: "MediRef uses the shared practice session only.",
      refresh_requested_at: null,
    });

    throw new Error("MediRef helper only supports the practice session.");
  }

  await updateSession({
    status: "refreshing",
    message:
      "Local helper is checking the saved practice MediRef browser session.",
  });

  const context = await chromium.launchPersistentContext(
    path.join(PROFILE_ROOT, "practice"),
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
        "Saved browser session was not active. Local helper is signing into the practice MediRef account.",
      current_url: await safePageUrl(page),
    });

    await page.goto(`${MEDIREF_BASE_URL}/login?redirectTo=%2Fsearch`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });

    await page.waitForTimeout(2500);

    const startedAt = Date.now();

    while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      if (
        (await isBrowserUiLoggedIn(page)) &&
        (await validateSessionCookie(context))
      ) {
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

      await fillPracticeLoginIfCredentialsAvailable(page);
      await page.waitForTimeout(2500);
    }

    throw new Error("Timed out waiting for MediRef practice login completion.");
  } catch (error: any) {
    await clearTemporaryPassword({
      status: "error",
      message: error?.message || "MediRef practice session refresh failed.",
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
  console.error("Failed to refresh MediRef practice session:");
  console.error(error);
  process.exit(1);
});
