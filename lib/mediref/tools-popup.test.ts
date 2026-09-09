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
test("MediRef popup shows three simple states without credentials", () => {
  for (const status of ["not_started", "error", "waiting_for_credentials", "refresh_requested", "refreshing", "waiting_for_mfa", "connected"]) {
    const html = render(status);
    assert.doesNotMatch(html, /type="(?:email|password)"|Save credentials|Logged in as|MediRef account/);
    if (status === "connected") {
      assert.match(html, /MediRef: Connected/);
      assert.doesNotMatch(html, />Connect<|>Connecting</);
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
