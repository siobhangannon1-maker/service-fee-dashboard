import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { chromium, type Page } from "playwright";

// Execute the actual login functions with fixture credentials and session stubs.
// Never import the worker: its module entry point creates a real session client.

async function harness(page: Page) {
const source = await readFile(new URL("./refresh-mediref-session.ts", import.meta.url), "utf8");
const functions = source.slice(source.indexOf("async function getVisibleEmailField("), source.indexOf("async function submitMfaCodeIfAvailable("));
const loopStart = source.indexOf("      // The code screen may still offer password login.");
const loop = source.slice(loopStart, source.indexOf("\n    }", loopStart));
const recoveryStart = source.indexOf("      } else if ((await pageHasMfaInput(page))");
const recovery = source.slice(recoveryStart, source.indexOf("\n    } catch", recoveryStart));
const recoveryBody = "if (false) { " + recovery;
const compiled = ts.transpileModule(functions + `\nasync function iteration(page) { for (let n=0;n<1;n++) { ${loop} } }\nasync function recoveryIteration(page) { ${recoveryBody} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

  const logs: string[] = []; const states: unknown[] = []; let mfa = 0;
  const originalWait = page.waitForTimeout.bind(page);
  // Skip existing post-submit delays in fixtures; retain polling/delayed rendering.
  page.waitForTimeout = ms => originalWait(ms >= 800 ? 0 : ms);
  const helpers = runInNewContext(`${compiled}\n({ fillPracticeLoginIfCredentialsAvailable, clickUsePasswordOptionIfVisible, iteration, recoveryIteration })`, {
    Date, console: { log: (...args: unknown[]) => logs.push(JSON.stringify(args)) }, process: { env: {} },
    getSession: async () => ({ scope: "practice", pending_mediref_email: "private@example.invalid", pending_mediref_password: "PRIVATE-PASSWORD" }),
    cleanEnvValue: (v: string) => v, safePageUrl: async () => "login", updateSession: async (value: unknown) => states.push(value),
    pageHasMfaInput: async () => await page.locator('input[name="code"]').count() > 0 && await page.locator('input[type="password"]').count() === 0,
    submitMfaCodeIfAvailable: async () => { mfa++; return true; },
    clickFirstVisible: async (_page: Page, selectors: string[]) => {
      for (const selector of selectors) for (const item of await page.locator(selector).all()) if (await item.isVisible()) { await item.click(); return true; }
      return false;
    },
  });
  return { helpers, logs, states, mfa: () => mfa };
}

async function fixture(page: Page, label: string | null, delay: number, initial: "email" | "code" | "password" = "email") {
  await page.setContent('<main id="screen"></main>');
  // tsx names nested fixture callbacks; supply its inert helper in the test page.
  await page.evaluate("globalThis.__name = (value) => value");
  await page.evaluate(({ label, delay, initial }) => {
    const screen = document.getElementById("screen")!;
    const password = () => {
      screen.innerHTML = '<input type="password" autocomplete="current-password"><button>Sign in</button>';
      screen.querySelector("button")!.onclick = () => {
        if ((screen.querySelector("input") as HTMLInputElement).value === "PRIVATE-PASSWORD") screen.innerHTML = '<div data-authenticated="true"></div>';
      };
    };
    const code = () => {
      screen.innerHTML = '<input name="code" inputmode="numeric"><p>Enter verification code</p>';
      if (label !== null) setTimeout(() => {
        const hidden = document.createElement("button"); hidden.textContent = label; hidden.hidden = true; screen.append(hidden);
        const button = document.createElement(label === "Password" ? "a" : "button");
        if (button instanceof HTMLAnchorElement) button.href = "#password";
        button.textContent = label; button.onclick = event => { event.preventDefault(); password(); }; screen.append(button);
      }, delay);
    };
    if (initial === "password") password();
    else if (initial === "code") code();
    else {
      screen.innerHTML = '<input type="email"><button>Continue</button>';
      screen.querySelector("button")!.onclick = code;
    }
  }, { label, delay, initial });
}

test("MediRef password-first login and MFA fallback with local browser fixtures", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of [
      { name: "email → Use Password → authenticated", label: "Use Password", initial: "email", delay: 0 },
      { name: "delayed option after Continue", label: "Use Password", initial: "email", delay: 300 },
      { name: "already on password screen", label: null, initial: "password", delay: 0 },
      { name: "delayed password option on code screen beats outer MFA branch", label: "Use password", initial: "code", delay: 300 },
      { name: "session recovery also prefers password", label: "Use Password", initial: "code", delay: 300 },
      { name: "historical bare Password link", label: "Password", initial: "email", delay: 0 },
      { name: "historical wording and mixed case", label: "LoG In WiTh PaSsWoRd", initial: "email", delay: 0 },
      { name: "password unavailable preserves outer MFA path", label: null, initial: "code", delay: 0 },
    ] as const) {
      await t.test(scenario.name, async () => {
        const page = await browser.newPage();
        try {
          await fixture(page, scenario.label, scenario.delay, scenario.initial);
          const h = await harness(page);
          await (scenario.name === "session recovery also prefers password" ? h.helpers.recoveryIteration(page) : h.helpers.iteration(page));
          const fallback = scenario.label === null && scenario.initial === "code";
          assert.equal(await page.locator("[data-authenticated]").count(), fallback ? 0 : 1);
          assert.equal(h.mfa(), fallback ? 1 : 0);
          const logs = h.logs.join("\n");
          for (const value of ["private@example.invalid", "PRIVATE-PASSWORD"]) assert.ok(!logs.includes(value));
          assert.ok(logs.includes(fallback ? "password_option_unavailable" : "password_submitted"));
          if (scenario.initial === "email") assert.ok(logs.includes("email_submitted"));
          if (scenario.label !== null) assert.ok(logs.includes("password_option_clicked"));
        } finally { await page.close(); }
      });
    }
    await t.test("password entry failure does not expose credentials through worker errors", async () => {
      const page = await browser.newPage();
      try {
        await fixture(page, null, 0, "password");
        await page.locator('input[type="password"]').evaluate(element => { (element as HTMLInputElement).readOnly = true; });
        page.setDefaultTimeout(100);
        const h = await harness(page);
        await assert.rejects(h.helpers.iteration(page), /MediRef practice login could not be completed/);
        assert.ok(!h.logs.join(" ").includes("PRIVATE-PASSWORD"));
        assert.equal(h.mfa(), 0);
      } finally { await page.close(); }
    });
    await t.test("clicked option must produce a password field; never silently switches to MFA", async () => {
      const page = await browser.newPage();
      try {
        await page.setContent('<input name="code"><button>Use Password</button>');
        const h = await harness(page);
        await assert.rejects(h.helpers.iteration(page), /password field did not appear/);
        assert.equal(h.mfa(), 0);
      } finally { await page.close(); }
    });
  } finally { await browser.close(); }
});
