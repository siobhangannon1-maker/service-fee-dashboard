import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import ts from "typescript";

const source = readFileSync("components/report-writing/MedirefToolsPopup.tsx", "utf8");
const requireModule = createRequire(import.meta.url);
function render(status: string) {
  const exports: Record<string, React.ComponentType<{ open: boolean }>> = {};
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  runInNewContext(js, { exports, require: (name: string) => name === "react" ? {
    ...React, useEffect() {}, useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value === "not_started" ? status : value, () => {}],
  } : requireModule(name) });
  return renderToStaticMarkup(React.createElement(exports.default, { open: true }));
}
test("MediRef popup shows actionable states without credentials", () => {
  for (const status of ["not_started", "error", "waiting_for_credentials", "refresh_requested", "refreshing", "waiting_for_mfa", "connected"]) {
    const html = render(status);
    assert.doesNotMatch(html, /type="(?:email|password)"|Save credentials|Logged in as|MediRef account/);
    if (status === "waiting_for_credentials") {
      assert.match(html, /MediRef: Login required/);
    } else if (status === "waiting_for_mfa") {
      assert.match(html, /MediRef: MFA required/);
    } else if (status === "connected") {
      assert.match(html, /MediRef: Not connected/);

    } else if (["refresh_requested", "refreshing", "waiting_for_mfa"].includes(status)) {
      assert.match(html, /MediRef: Connecting/);
      assert.match(html, /disabled=""[^>]*>Connecting<\/button>/);
    } else {
      assert.match(html, /MediRef: Not connected/);
      assert.match(html, />Connect<\/button>/);
    }
    if (status === "waiting_for_mfa") assert.match(html, /Verification code/);
  }
  assert.doesNotMatch(source, /\/session\/credentials/);
});

test("authoritative downgrade removes green on first response; positive state expires without polling", async () => {
  const { chromium } = await import("playwright");
  const { build } = await import("esbuild");
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Popup from './components/report-writing/MedirefToolsPopup'; createRoot(document.getElementById('root')).render(<Popup open={true}/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    let next = { status: "connected", connected: true, validForMs: 120000 };
    await page.route("**/*", route => new URL(route.request().url()).pathname === "/" ?
      route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.fulfill({ json: next }));
    await page.goto("http://mediref-connection.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("MediRef: Connected", { exact: true }).waitFor();
    for (const [status, label] of [["refreshing", "Connecting"], ["waiting_for_credentials", "Login required"], ["waiting_for_mfa", "MFA required"], ["error", "Not connected"]]) {
      next = { status, connected: false, validForMs: 0 };
      await page.clock.runFor(5000);
      await page.getByText(`MediRef: ${label}`, { exact: true }).waitFor();
      assert.equal(await page.getByText("MediRef: Connected", { exact: true }).count(), 0);
      next = { status: "connected", connected: true, validForMs: 120000 };
      await page.clock.runFor(5000);
      await page.getByText("MediRef: Connected", { exact: true }).waitFor();
    }
    next = { status: "connected", connected: true, validForMs: 1000 };
    await page.clock.runFor(5000);
    await page.clock.runFor(1100);
    await page.getByText("MediRef: Not connected", { exact: true }).waitFor();
  } finally { await browser.close(); }
});
