import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import dotenv from "dotenv";
import { enterPatientDob } from "./mediref-dob";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
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

function cleanEnvValue(value: unknown) {
  const text = String(value ?? "").trim();

  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1).trim();
  }

  return text;
}

function normaliseDateForHtmlDateInput(value: unknown) {
  const clean = String(value || "").trim();

  if (!clean) return "";

  // HTML <input type="date"> requires YYYY-MM-DD exactly.
  // It will reject Australian display format such as DD/MM/YYYY.
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY.
  const auMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (auMatch) {
    const day = auMatch[1].padStart(2, "0");
    const month = auMatch[2].padStart(2, "0");
    const year = auMatch[3];

    return `${year}-${month}-${day}`;
  }

  const parsed = new Date(clean);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return clean;
}

function formatDateForHumanTextInput(value: unknown) {
  const iso = normaliseDateForHtmlDateInput(value);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return String(value || "").trim();

  return `${match[3]}/${match[2]}/${match[1]}`;
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
  // If a password field is visible, MediRef is on the password-login screen.
  // That page also contains the text "login with an emailed code", so do not
  // misclassify it as an MFA/code screen.
  if (await pageHasVisiblePasswordInput(page)) return false;

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
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);

    for (let i = 0; i < count; i += 1) {
      const field = locator.nth(i);
      const visible = await field.isVisible().catch(() => false);
      if (visible) return true;
    }
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();

  return (
    lower.includes("verification code") ||
    lower.includes("enter code") ||
    lower.includes("email code") ||
    lower.includes("emailed code") ||
    lower.includes("code from email") ||
    lower.includes("6 digit") ||
    lower.includes("six digit") ||
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
  // Deliberately avoid a broad input[type="text"] fallback here.
  // On the MediRef emailed-code screen, the code boxes can be plain text inputs;
  // treating those as email fields causes the helper to repeatedly type the
  // email address into the code screen and click Continue forever.
  const locator = page.locator(
    [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[placeholder*="email" i]',
      'input[aria-label*="email" i]',
      'input[autocomplete="email"]',
      'input[name*="username" i]',
      'input[id*="username" i]',
      'input[placeholder*="username" i]',
      'input[aria-label*="username" i]',
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

async function clickUsePasswordOptionIfVisible(page: Page) {
  // MediRef's verification screen currently displays a link like:
  // "Enter verification code or login with password".
  // Prefer Playwright text locators before CSS :has-text selectors because the
  // visible text can be split across nested elements.
  const textLocators = [
    page.getByText(/login with password/i).first(),
    page.getByText(/log in with password/i).first(),
    page.getByText(/use password/i).first(),
    page.getByText(/enter password/i).first(),
  ];

  for (const locator of textLocators) {
    const count = await locator.count().catch(() => 0);
    if (count === 0) continue;

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;

    await locator.click({ force: true });
    console.log("Clicked MediRef login/use password text link.");
    await page.waitForTimeout(2500);
    return true;
  }

  const clicked = await clickFirstVisible(page, [
    'button:has-text("login with password")',
    'a:has-text("login with password")',
    '[role="button"]:has-text("login with password")',
    'button:has-text("Login with password")',
    'a:has-text("Login with password")',
    '[role="button"]:has-text("Login with password")',
    'button:has-text("Use password")',
    'button:has-text("use password")',
    'a:has-text("Use password")',
    'a:has-text("use password")',
    '[role="button"]:has-text("Use password")',
    'button:has-text("Enter password")',
    'button:has-text("enter password")',
    'a:has-text("Enter password")',
    'a:has-text("enter password")',
    '[role="button"]:has-text("Enter password")',
  ]);

  if (clicked) {
    console.log("Clicked MediRef Use/Enter password option.");
    await page.waitForTimeout(2500);
  }

  return clicked;
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

  const email = cleanEnvValue(
    session.pending_mediref_email ||
      process.env.MEDIREF_EMAIL ||
      session.mediref_email ||
      "",
  );

  const password = cleanEnvValue(
    session.pending_mediref_password || process.env.MEDIREF_PASSWORD || "",
  );

  if (!email || !password) {
    await updateSession({
      status: "waiting_for_credentials",
      message:
        "Practice MediRef credentials are missing. Configure MEDIREF_EMAIL and MEDIREF_PASSWORD on Render, or enter credentials in MediRef tools.",
      current_url: await safePageUrl(page),
      refresh_requested_at: null,
    });

    return false;
  }

  // Some MediRef screens show an email-code option first. Prefer password login
  // whenever the option is available before trying to fill any field.
  await clickUsePasswordOptionIfVisible(page);

  const passwordFieldBeforeEmail = await getVisiblePasswordField(page);

  if (passwordFieldBeforeEmail) {
    console.log("MediRef password field is visible. Entering password.");

    await passwordFieldBeforeEmail.fill(password);

    await clickFirstVisible(page, [
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Continue")',
    ]);

    await updateSession({
      status: "refreshing",
      message:
        "Practice MediRef password was submitted. Waiting for MediRef to finish signing in or request verification.",
      current_url: await safePageUrl(page),
    });

    await page.waitForTimeout(7000);
    return true;
  }

  const emailField = await getVisibleEmailField(page);

  if (emailField) {
    const currentValue = await emailField.inputValue().catch(() => "");

    if (currentValue.trim().toLowerCase() !== email.trim().toLowerCase()) {
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
        "Practice MediRef email was submitted. Waiting for password or verification option.",
      current_url: await safePageUrl(page),
    });

    await page.waitForTimeout(3000);
  }

  await clickUsePasswordOptionIfVisible(page);

  const passwordField = await getVisiblePasswordField(page);

  if (!passwordField && (await pageHasMfaInput(page))) {
    return await submitMfaCodeIfAvailable(page);
  }

  if (!passwordField) {
    await updateSession({
      status: "refreshing",
      message:
        "Practice MediRef email was entered. Waiting for the password field or verification code screen to appear.",
      current_url: await safePageUrl(page),
    });

    return true;
  }

  console.log("Entering MediRef practice password.");

  await passwordField.fill(password);

  await clickFirstVisible(page, [
    'button:has-text("Sign in")',
    'button:has-text("Login")',
    'button:has-text("Log in")',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Continue")',
  ]);

  await updateSession({
    status: "refreshing",
    message:
      "Practice MediRef password was submitted. Waiting for MediRef to finish signing in or request verification.",
    current_url: await safePageUrl(page),
  });

  await page.waitForTimeout(7000);
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

async function updateDraftAfterMedirefSuccess(
  job: MedirefHelperJob,
  result: Record<string, unknown>,
) {
  const draftId = String(job.payload?.draftId || "").trim();

  if (!draftId) {
    console.warn(
      `MediRef job ${job.id} completed, but its payload did not contain a draftId.`,
    );
    return;
  }

  const completedAt = nowIso();
  const recipient = job.payload?.recipient || {};
  const recipientLabel = String(
    recipient.email || recipient.name || "",
  ).trim();

  /*
   * Recipient matching has intentionally been removed from the helper.
   * Once the patient details and PDFs are prepared in MediRef, DocuDental
   * considers the workflow complete and removes the letter from Approved.
   * No separate manual confirmation is required.
   */
  const values: Record<string, unknown> = {
    workflow_status: "completed",
    workflow_mediref_status: "completed",
    workflow_completed_at: completedAt,
    workflow_error: null,
    workflow_last_message:
      "MediRef draft prepared with the PDF attached. Recipient matching was skipped.",
    emailed_to_referrer_at: completedAt,
    emailed_to_referrer_email: recipientLabel || null,
    emailed_to_referrer_resend_id: `mediref:${job.id}`,
    updated_at: completedAt,
  };

  const { error } = await supabase
    .from("report_drafts")
    .update(values)
    .eq("id", draftId);

  if (error) {
    throw new Error(
      `MediRef job completed, but report_drafts could not be updated: ${error.message}`,
    );
  }
}

async function updateDraftAfterMedirefFailure(
  job: MedirefHelperJob,
  message: string,
) {
  const draftId = String(job.payload?.draftId || "").trim();

  if (!draftId) {
    console.warn(
      `MediRef job ${job.id} failed, but its payload did not contain a draftId.`,
    );
    return;
  }

  const failedAt = nowIso();

  const { error } = await supabase
    .from("report_drafts")
    .update({
      workflow_status: "failed",
      workflow_mediref_status: "failed",
      workflow_completed_at: null,
      workflow_error: message,
      workflow_last_message: "MediRef helper failed.",
      emailed_to_referrer_at: null,
      updated_at: failedAt,
    })
    .eq("id", draftId);

  if (error) {
    throw new Error(
      `MediRef job failed, but report_drafts could not be updated: ${error.message}`,
    );
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
  return normaliseDateForHtmlDateInput(value);
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

function parseAdditionalRecipientsFromRequest(request: any) {
  const explicitRecipients = Array.isArray(request?.additionalRecipients)
    ? request.additionalRecipients
    : [];

  const textRecipients = String(request?.additionalRecipientsText || "")
    .split(/\n|;/)
    .map((line) => line.replace(/^cc\.?\s*/i, "").trim())
    .filter(Boolean)
    .map((line) => ({
      name: line,
      practiceName: "",
      email: "",
      providerNumber: "",
    }));

  const combined = [...explicitRecipients, ...textRecipients];

  const seen = new Set<string>();

  return combined
    .map((recipient) => ({
      name: String(recipient?.name || "").trim(),
      practiceName: String(
        recipient?.practiceName ||
          recipient?.practice_name ||
          recipient?.practice ||
          "",
      ).trim(),
      email: String(recipient?.email || "").trim(),
      providerNumber: String(
        recipient?.providerNumber || recipient?.provider_number || "",
      ).trim(),
    }))
    .filter(
      (recipient) =>
        recipient.name ||
        recipient.practiceName ||
        recipient.email ||
        recipient.providerNumber,
    )
    .filter((recipient) => {
      const key = [
        recipient.name.toLowerCase(),
        recipient.practiceName.toLowerCase(),
        recipient.email.toLowerCase(),
        recipient.providerNumber.toLowerCase(),
      ].join("|");

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

async function fillPatientEmailIfAvailable(page: Page, request: any) {
  const patientEmail = String(
    request?.patient?.email ||
      request?.patientEmail ||
      request?.patient_email ||
      "",
  ).trim();

  if (!patientEmail) return false;

  const locator = page.locator(
    [
      'input[data-testid*="patient" i][data-testid*="email" i]',
      'input[name*="patient" i][name*="email" i]',
      'input[id*="patient" i][id*="email" i]',
      'input[placeholder*="patient" i][placeholder*="email" i]',
      'input[aria-label*="patient" i][aria-label*="email" i]',
      'input[name="patientEmail"]',
      'input[name="patient_email"]',
      'input[id="patientEmail"]',
      'input[id="patient_email"]',
    ].join(", "),
  );

  const count = await locator.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const field = locator.nth(i);
    const visible = await field.isVisible().catch(() => false);

    if (!visible) continue;

    console.log("Entering MediRef patient email.");
    await field.fill(patientEmail);
    return true;
  }

  console.warn(
    "Patient email was provided, but no specific MediRef patient email field was found.",
  );

  return false;
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

async function fillPatientDobField(page: Page, rawDob: unknown) {
  return enterPatientDob(
    page,
    normaliseDateForHtmlDateInput(rawDob),
    formatDateForHumanTextInput(rawDob),
  );
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
  const dob = normaliseDateForHtmlDateInput(patient.dob || patient.dateOfBirth);

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
    const dobFilled = await fillPatientDobField(page, patient.dob || patient.dateOfBirth);

    if (!dobFilled) {
      console.warn("Could not find a visible MediRef patient DOB field.");
    }
  }

  await fillPatientEmailIfAvailable(page, request);
}

async function getRecipientSearchInput(page: Page) {
  /*
   * MediRef has a wide navbar input with:
   *   data-testid="navbar-correspondence-search"
   *   placeholder="Search correspondences"
   *
   * That field is not the Compose recipient directory. This function first
   * opens the Recipients control and then scores visible fields by proximity
   * to the Recipients label while explicitly rejecting the navbar search.
   */

  const recipientsLabel = page.getByText(/^Recipients$/i).first();

  if ((await recipientsLabel.count().catch(() => 0)) > 0) {
    await recipientsLabel.scrollIntoViewIfNeeded().catch(() => undefined);
    await recipientsLabel.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
  }

  const candidateSelector = [
    'input[placeholder*="Search directory" i]',
    'input[placeholder*="directory" i]',
    'input[placeholder*="recipient" i]',
    'input[name*="recipient" i]',
    'input[id*="recipient" i]',
    'input[aria-label*="recipient" i]',
    'input[aria-label*="directory" i]',
    '[role="combobox"]',
    'input[type="search"]',
    'input[type="text"]',
    '[contenteditable="true"]',
  ].join(", ");

  async function collectCandidates() {
    const candidates = page.locator(candidateSelector);
    const count = Math.min(await candidates.count().catch(() => 0), 100);
    const labelBox = await recipientsLabel.boundingBox().catch(() => null);

    const ranked: Array<{
      locator: Locator;
      score: number;
      details: Record<string, unknown>;
    }> = [];

    for (let i = 0; i < count; i += 1) {
      const candidate = candidates.nth(i);
      if (!(await candidate.isVisible().catch(() => false))) continue;

      const details = await candidate
        .evaluate((element) => {
          const html = element as HTMLElement;
          const rect = html.getBoundingClientRect();

          return {
            tag: element.tagName,
            type: element.getAttribute("type"),
            name: element.getAttribute("name"),
            id: element.getAttribute("id"),
            role: element.getAttribute("role"),
            placeholder: element.getAttribute("placeholder"),
            ariaLabel: element.getAttribute("aria-label"),
            ariaControls: element.getAttribute("aria-controls"),
            dataTestId: element.getAttribute("data-testid"),
            contentEditable: element.getAttribute("contenteditable"),
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        })
        .catch(() => null);

      if (!details) continue;

      const identifyingText = [
        details.dataTestId,
        details.placeholder,
        details.ariaLabel,
        details.ariaControls,
        details.name,
        details.id,
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      const y = Number(details.y || 0);
      const width = Number(details.width || 0);

      // Explicitly reject MediRef's navbar correspondence search.
      if (
        identifyingText.includes("navbar-correspondence-search") ||
        identifyingText.includes("search correspondences") ||
        identifyingText.includes("navbar-correspondence-search-results")
      ) {
        continue;
      }

      // Reject obvious patient fields and anything in the top navigation bar.
      if (
        identifyingText.includes("patient") ||
        identifyingText.includes("date of birth") ||
        identifyingText.includes("dob") ||
        identifyingText.includes("email") ||
        y < 70
      ) {
        continue;
      }

      let score = 0;

      if (identifyingText.includes("recipient")) score += 500;
      if (identifyingText.includes("directory")) score += 450;
      if (String(details.role || "").toLowerCase() === "combobox") score += 150;
      if (width >= 180) score += 30;

      if (labelBox) {
        const verticalDistance = Math.abs(y - labelBox.y);
        const horizontalDistance = Math.abs(Number(details.x || 0) - labelBox.x);

        score += Math.max(0, 300 - verticalDistance);
        score += Math.max(0, 100 - horizontalDistance / 4);

        // The real recipient field should be close to or below the label.
        if (y >= labelBox.y - 20 && y <= labelBox.y + 220) score += 250;
      }

      ranked.push({ locator: candidate, score, details });
    }

    ranked.sort((a, b) => b.score - a.score);

    console.log(
      "MediRef recipient field candidates:",
      ranked.slice(0, 10).map((item, index) => ({
        rank: index + 1,
        score: Math.round(item.score),
        ...item.details,
      })),
    );

    return ranked;
  }

  let ranked = await collectCandidates();

  if (ranked.length > 0) {
    return ranked[0].locator;
  }

  /*
   * Some versions of the Compose form expose Recipients as a button first.
   * Click the closest interactive control beneath the label, then look again
   * for the search input created by the popover.
   */
  if ((await recipientsLabel.count().catch(() => 0)) > 0) {
    const nearbyContainer = recipientsLabel.locator(
      'xpath=ancestor::*[self::div or self::section or self::fieldset][1]',
    );

    const triggers = nearbyContainer.locator(
      'button, [role="button"], [role="combobox"], [aria-haspopup]',
    );

    const triggerCount = Math.min(await triggers.count().catch(() => 0), 20);

    for (let i = 0; i < triggerCount; i += 1) {
      const trigger = triggers.nth(i);
      if (!(await trigger.isVisible().catch(() => false))) continue;

      const text = String(await trigger.innerText().catch(() => "")).trim();
      const ariaLabel = String(
        (await trigger.getAttribute("aria-label").catch(() => "")) || "",
      ).trim();

      if (/send|clear|patient|file|theme|setting/i.test(`${text} ${ariaLabel}`)) {
        continue;
      }

      await trigger.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(700);

      ranked = await collectCandidates();
      if (ranked.length > 0) return ranked[0].locator;
    }
  }

  return null;
}

type RecipientCandidate = {
  locator: Locator;
  selector: string;
  index: number;
  text: string;
  normalisedText: string;
  score: number;
  reasons: string[];
  exactName: boolean;
  exactPractice: boolean;
};

function scoreRecipientCandidate(params: {
  text: string;
  recipientName: string;
  practiceName: string;
  recipientEmail: string;
  providerNumber: string;
}) {
  const {
    text,
    recipientName,
    practiceName,
    recipientEmail,
    providerNumber,
  } = params;

  const normalisedText = normaliseForMatching(text);
  const nameKey = normaliseForMatching(recipientName);
  const practiceKey = normaliseForMatching(practiceName);
  const emailKey = String(recipientEmail || "").trim().toLowerCase();
  const providerNumberKey = normaliseForMatching(providerNumber);

  const reasons: string[] = [];
  let score = 0;

  const exactName = Boolean(nameKey && normalisedText.includes(nameKey));
  const exactPractice = Boolean(
    practiceKey && normalisedText.includes(practiceKey),
  );

  if (exactPractice) {
    score += 250;
    reasons.push("exact practice match +250");
  }

  if (exactName) {
    score += 220;
    reasons.push("exact provider match +220");
  }

  if (emailKey && text.toLowerCase().includes(emailKey)) {
    score += 350;
    reasons.push("exact email match +350");
  }

  if (providerNumberKey && normalisedText.includes(providerNumberKey)) {
    score += 350;
    reasons.push("exact provider number match +350");
  }

  const nameWords = nameKey
    .split(" ")
    .filter((word) => word.length > 2);
  const practiceWords = practiceKey
    .split(" ")
    .filter((word) => word.length > 2);

  for (const word of nameWords) {
    if (normalisedText.includes(word)) {
      score += 20;
      reasons.push(`provider word "${word}" +20`);
    }
  }

  for (const word of practiceWords) {
    if (normalisedText.includes(word)) {
      score += 15;
      reasons.push(`practice word "${word}" +15`);
    }
  }

  if (text.includes("@")) {
    score += 5;
    reasons.push("contains email-like text +5");
  }

  // When both provider and practice were supplied, strongly penalise a row
  // that contains only one of them. This protects providers who work at more
  // than one clinic.
  if (nameKey && practiceKey && !(exactName && exactPractice)) {
    score -= 200;
    reasons.push("missing exact provider/practice pair -200");
  }

  return {
    score,
    reasons,
    normalisedText,
    exactName,
    exactPractice,
  };
}

async function visibleMatchingRecipientOptions(params: {
  page: Page;
  recipientName: string;
  practiceName: string;
}) {
  const { page, recipientName, practiceName } = params;
  const nameKey = normaliseForMatching(recipientName);
  const practiceKey = normaliseForMatching(practiceName);

  const optionLocator = page.locator(
    [
      '[role="option"]',
      '[cmdk-item]',
      '[data-radix-collection-item]',
      '[role="listbox"] li',
      '[role="menu"] li',
    ].join(", "),
  );

  const count = Math.min(await optionLocator.count().catch(() => 0), 100);
  let matches = 0;

  for (let i = 0; i < count; i += 1) {
    const item = optionLocator.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;

    const text = normaliseForMatching(await item.innerText().catch(() => ""));
    if (!text) continue;

    const nameMatches = !nameKey || text.includes(nameKey);
    const practiceMatches = !practiceKey || text.includes(practiceKey);

    if (nameMatches && practiceMatches) matches += 1;
  }

  return matches;
}

async function verifyRecipientSelection(params: {
  page: Page;
  searchInput: Locator;
  recipientName: string;
  practiceName: string;
  beforeInputValue: string;
}) {
  const {
    page,
    searchInput,
    recipientName,
    practiceName,
    beforeInputValue,
  } = params;

  await page.waitForTimeout(1200);

  const nameKey = normaliseForMatching(recipientName);
  const practiceKey = normaliseForMatching(practiceName);

  const selectedIndicators = page.locator(
    [
      '[aria-selected="true"]',
      '[data-selected="true"]',
      '[data-state="checked"]',
      '[data-state="selected"]',
      '[class*="selected" i]',
      '[class*="recipient" i] [class*="chip" i]',
      '[class*="recipient" i] [class*="tag" i]',
    ].join(", "),
  );

  const selectedCount = Math.min(
    await selectedIndicators.count().catch(() => 0),
    100,
  );

  for (let i = 0; i < selectedCount; i += 1) {
    const item = selectedIndicators.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;

    const text = normaliseForMatching(await item.innerText().catch(() => ""));
    if (!text) continue;

    const nameMatches = !nameKey || text.includes(nameKey);
    const practiceMatches = !practiceKey || text.includes(practiceKey);

    if (nameMatches && practiceMatches) {
      console.log("Verified MediRef recipient using selected UI element:", {
        text: text.slice(0, 500),
      });
      return true;
    }
  }

  const remainingMatchingOptions = await visibleMatchingRecipientOptions({
    page,
    recipientName,
    practiceName,
  });

  const afterInputValue = await searchInput.inputValue().catch(() => "");
  const inputChanged = afterInputValue.trim() !== beforeInputValue.trim();
  const inputCleared = afterInputValue.trim() === "";
  const dropdownClosed = remainingMatchingOptions === 0;

  console.log("MediRef recipient click verification:", {
    beforeInputValue,
    afterInputValue,
    inputChanged,
    inputCleared,
    dropdownClosed,
    remainingMatchingOptions,
  });

  // Many autocomplete widgets clear or replace the search text and close the
  // result list after a successful selection. Require both signals so a mere
  // click is never treated as success.
  return dropdownClosed && (inputChanged || inputCleared);
}

async function chooseBestRecipientResult(params: {
  page: Page;
  searchInput: Locator;
  recipientName: string;
  practiceName: string;
  recipientEmail: string;
  providerNumber: string;
}) {
  const {
    page,
    searchInput,
    recipientName,
    practiceName,
    recipientEmail,
    providerNumber,
  } = params;

  // Prefer true option/list-item elements. The final two fallbacks support
  // custom MediRef markup, but they are deliberately evaluated after the
  // semantic selectors.
  const candidateSelectors = [
    '[role="option"]',
    '[cmdk-item]',
    '[data-radix-collection-item]',
    '[role="listbox"] li',
    '[role="menu"] li',
    'li',
    'button',
  ];

  const candidates: RecipientCandidate[] = [];
  const seenTexts = new Set<string>();

  for (const selector of candidateSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 75);

    for (let i = 0; i < count; i += 1) {
      const item = locator.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;

      const text = (await item.innerText().catch(() => "")).trim();
      const normalisedText = normaliseForMatching(text);

      if (!normalisedText || normalisedText.length < 4) continue;

      // Avoid scoring the same nested result several times under different
      // selectors. Keep the first occurrence, which comes from the most
      // semantic selector.
      if (seenTexts.has(normalisedText)) continue;
      seenTexts.add(normalisedText);

      const scored = scoreRecipientCandidate({
        text,
        recipientName,
        practiceName,
        recipientEmail,
        providerNumber,
      });

      if (scored.score <= 0) continue;

      candidates.push({
        locator: item,
        selector,
        index: i,
        text,
        normalisedText: scored.normalisedText,
        score: scored.score,
        reasons: scored.reasons,
        exactName: scored.exactName,
        exactPractice: scored.exactPractice,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  console.log(
    "MediRef recipient candidates:",
    candidates.slice(0, 20).map((candidate, index) => ({
      rank: index + 1,
      score: candidate.score,
      selector: candidate.selector,
      exactName: candidate.exactName,
      exactPractice: candidate.exactPractice,
      text: candidate.text.slice(0, 500),
      reasons: candidate.reasons,
    })),
  );

  const best = candidates[0];
  if (!best) return false;

  const bothIdentityFieldsProvided = Boolean(
    normaliseForMatching(recipientName) && normaliseForMatching(practiceName),
  );

  // When provider and practice are both available, require the chosen result
  // to contain both. This is the key safety rule for multi-clinic providers.
  if (
    bothIdentityFieldsProvided &&
    !(best.exactName && best.exactPractice)
  ) {
    console.warn(
      "Rejected best MediRef candidate because it did not contain both the exact provider and exact practice.",
      {
        score: best.score,
        text: best.text.slice(0, 500),
      },
    );
    return false;
  }

  const beforeInputValue = await searchInput.inputValue().catch(() => "");

  console.log("Clicking best MediRef recipient match:", {
    score: best.score,
    selector: best.selector,
    text: best.text.slice(0, 500),
    reasons: best.reasons,
  });

  await best.locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await best.locator.click({ force: true });

  const verified = await verifyRecipientSelection({
    page,
    searchInput,
    recipientName,
    practiceName,
    beforeInputValue,
  });

  if (!verified) {
    console.warn(
      "MediRef recipient candidate was clicked, but the UI did not confirm selection.",
      {
        text: best.text.slice(0, 500),
      },
    );
  }

  return verified;
}

async function describeRecipientSearchInput(searchInput: Locator) {
  const details = await searchInput
    .evaluate((element) => {
      const htmlElement = element as HTMLElement;
      const inputElement = element as HTMLInputElement;
      const rect = htmlElement.getBoundingClientRect();

      return {
        tag: element.tagName,
        type: element.getAttribute("type"),
        name: element.getAttribute("name"),
        id: element.getAttribute("id"),
        role: element.getAttribute("role"),
        placeholder: element.getAttribute("placeholder"),
        ariaLabel: element.getAttribute("aria-label"),
        ariaControls: element.getAttribute("aria-controls"),
        ariaExpanded: element.getAttribute("aria-expanded"),
        autocomplete: element.getAttribute("autocomplete"),
        contentEditable: element.getAttribute("contenteditable"),
        value:
          "value" in inputElement ? String(inputElement.value || "") : null,
        textContent: String(element.textContent || "").slice(0, 300),
        outerHtml: String(element.outerHTML || "").slice(0, 2000),
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    })
    .catch((error) => ({ error: String(error) }));

  console.log(
    "Selected MediRef recipient search element:",
    JSON.stringify(details, null, 2),
  );
}

async function enterRecipientSearchQuery(
  page: Page,
  searchInput: Locator,
  query: string,
) {
  await searchInput.scrollIntoViewIfNeeded().catch(() => undefined);
  await searchInput.click({ force: true });
  await page.waitForTimeout(200);

  await searchInput.press("ControlOrMeta+A").catch(() => undefined);
  await searchInput.press("Backspace").catch(() => undefined);
  await page.waitForTimeout(300);

  // Use real key events rather than fill(). Some Svelte autocomplete controls
  // only start their remote search after keyboard input events.
  await searchInput.type(query, { delay: 90 });
  await page.waitForTimeout(300);

  const value = await searchInput.inputValue().catch(() => "<not-an-input>");
  const ariaExpanded = await searchInput
    .getAttribute("aria-expanded")
    .catch(() => null);

  console.log("MediRef recipient field after typing:", {
    query,
    value,
    ariaExpanded,
    activeElementMatches: await searchInput
      .evaluate((element) => document.activeElement === element)
      .catch(() => false),
  });
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

  await describeRecipientSearchInput(searchInput);

  const queries = Array.from(
    new Set(
      [
        practiceName && recipientName
          ? `${practiceName} ${recipientName}`
          : "",
        recipientName && practiceName
          ? `${recipientName} ${practiceName}`
          : "",
        practiceName,
        recipientName,
        providerNumber,
        recipientEmail,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  console.log("MediRef recipient auto-match request:", {
    recipientName,
    practiceName,
    providerNumber: providerNumber || null,
    recipientEmail: recipientEmail || null,
    queries,
  });

  let directoryRequestCount = 0;
  let directoryResponseCount = 0;

  const requestListener = (networkRequest: any) => {
    if (!networkRequest.url().includes("directorySearchQueryFn")) return;

    directoryRequestCount += 1;
    const postData = networkRequest.postData() || "";

    console.log("MediRef directory request detected:", {
      sequence: directoryRequestCount,
      method: networkRequest.method(),
      url: networkRequest.url(),
      resourceType: networkRequest.resourceType(),
      postDataLength: postData.length,
      postData: postData.slice(0, 6000),
    });
  };

  const responseListener = async (networkResponse: any) => {
    if (!networkResponse.url().includes("directorySearchQueryFn")) return;

    directoryResponseCount += 1;

    const headers = await networkResponse.allHeaders().catch(() => ({}));
    const body = await networkResponse.text().catch((error: unknown) =>
      `<could not read response body: ${String(error)}>`,
    );

    console.log("MediRef directory response detected:", {
      sequence: directoryResponseCount,
      status: networkResponse.status(),
      ok: networkResponse.ok(),
      url: networkResponse.url(),
      contentType: headers["content-type"] || null,
      bodyLength: body.length,
    });

    console.log(
      "MediRef directory response body (first 12000 characters):",
      body.slice(0, 12_000),
    );
  };

  const requestFailedListener = (networkRequest: any) => {
    if (!networkRequest.url().includes("directorySearchQueryFn")) return;

    console.warn("MediRef directory request failed:", {
      method: networkRequest.method(),
      url: networkRequest.url(),
      failure: networkRequest.failure(),
      postData: String(networkRequest.postData() || "").slice(0, 3000),
    });
  };

  page.on("request", requestListener);
  page.on("response", responseListener);
  page.on("requestfailed", requestFailedListener);

  try {
    for (const query of queries) {
      console.log("Searching MediRef directory:", query);

      const requestsBeforeQuery = directoryRequestCount;
      const responsesBeforeQuery = directoryResponseCount;

      await enterRecipientSearchQuery(page, searchInput, query);

      // Give the remote search/debounce enough time to run.
      await page.waitForTimeout(4000);

      console.log("MediRef directory network activity for query:", {
        query,
        requestsTriggered: directoryRequestCount - requestsBeforeQuery,
        responsesReceived: directoryResponseCount - responsesBeforeQuery,
      });

      if (directoryRequestCount === requestsBeforeQuery) {
        console.warn(
          "No directorySearchQueryFn request was triggered by this automated query. The helper may be targeting the wrong field or the field may require a different interaction.",
          { query },
        );
      }

      // Print the visible page text for every attempted query while debugging.
      await debugRecipientResults(page);

      const selected = await chooseBestRecipientResult({
        page,
        searchInput,
        recipientName,
        practiceName,
        recipientEmail,
        providerNumber,
      });

      if (selected) {
        console.log("MediRef recipient selection verified for query:", query);
        return true;
      }

      console.warn(
        "No verified MediRef recipient selection for query. Trying the next query:",
        query,
      );
    }

    await debugRecipientResults(page);

    throw new Error(
      `Could not automatically match and verify MediRef recipient. Tried referrer "${recipientName}" and practice "${practiceName}". Directory requests observed: ${directoryRequestCount}; responses observed: ${directoryResponseCount}.`,
    );
  } finally {
    page.off("request", requestListener);
    page.off("response", responseListener);
    page.off("requestfailed", requestFailedListener);
  }
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

  await openComposePage(page);

  await fillComposePatientDetails(page, request);

  /*
   * Recipient matching is intentionally disabled.
   * The helper now performs only the reliable parts of the workflow:
   * open Compose, enter the patient details, attach the PDFs, add the message,
   * and leave the MediRef draft open.
   */
  console.log("Starting MediRef PDF attachment.", {
    count: localPdfPaths.length,
    files: localPdfPaths.map((filePath) => path.basename(filePath)),
  });

  const uploaded = await uploadPdfsToFileInput(page, localPdfPaths);

  if (!uploaded) {
    await debugVisibleInputs(page);

    throw new Error("Could not find a MediRef PDF upload field.");
  }

  await page.waitForTimeout(2500);

  console.log("MediRef PDF attachment input completed.", {
    count: localPdfPaths.length,
  });

  await fillFirstVisibleTextFieldByHints(
    page,
    ["message", "note", "body", "details"],
    String(request.message || ""),
  );

  console.log(
    "MediRef draft prepared. Recipient matching and final Send click were intentionally skipped.",
  );

  return {
    prepared: true,
    sent: false,
    autoSend: false,
    recipientMatchingSkipped: true,
    currentUrl: await safePageUrl(page),
    attachmentCount: localPdfPaths.length,
    message:
      "MediRef draft prepared with patient details and PDF attachment. Recipient matching was skipped.",
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

    await updateDraftAfterMedirefSuccess(job, result);

    console.log(`Completed MediRef job ${job.id}.`);
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "MediRef job failed.";

    console.error(`MediRef job ${job.id} failed:`, error);

    await failMedirefJob(job.id, message);

    await updateDraftAfterMedirefFailure(job, message).catch((draftError) => {
      console.error(
        `Could not update report draft after MediRef job ${job.id} failed:`,
        draftError,
      );
    });

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
