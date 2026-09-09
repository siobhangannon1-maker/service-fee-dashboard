import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const paths = [
  "components/report-writing/PraktikaToolsPopup.tsx",
  "components/PraktikaSessionPanel.tsx",
  "components/PraktikaCompactSessionPanel.tsx",
  "components/PraktikaReconnectPopup.tsx",
  "app/(protected)/ai-reception/workbench/WorkbenchClient.tsx",
];
const read = (path: string) => readFile(new URL("../../" + path, import.meta.url), "utf8");
function extract(source: string, name: string) {
  const ast = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found);
  return ts.transpileModule(found.getText(ast).replace(/^export default /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
}
for (const path of paths) {
  test(path + ": old response and old error cannot replace newer status", async () => {
    const source = await read(path);
    for (const rejectOld of [false, true]) {
      let state = { status: "connected" };
      const statusRequest = { current: 0 };
      const requests: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
      const update = (value: unknown) => {
        if (typeof value === "function") state = value(state);
        else if (typeof value === "string") state = { status: value };
        else state = value as typeof state;
      };
      const load = runInNewContext(extract(source, "loadStatus") + "\nloadStatus", {
        statusRequest, scope: "user", username: "", dismissedForStatus: null,
        fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
        safeJson: (response: { json(): unknown }) => response.json(),
        setState: update, setSession: update, setDisplayStatus: update,
        setChecking() {}, setUsername() {}, setLiveStatus() {}, setLiveMessage() {},
        setLocalMessage() {}, setPassword() {}, setOpen() {}, setDismissedForStatus() {},
        shouldShowNotification: () => false, console: { error() {} },
      });
      const old = load(); const current = load();
      requests[1].resolve({ ok: true, json: async () => ({ status: "error", connected: false }) });
      await current; assert.equal(state.status, "error");
      if (rejectOld) requests[0].reject(new Error("fixture network error"));
      else requests[0].resolve({ ok: true, json: async () => ({ status: "connected", connected: true }) });
      await old; assert.equal(state.status, "error");
      const unmounted = load(); ++statusRequest.current;
      requests[2].resolve({ ok: true, json: async () => ({ status: "connected", connected: true }) });
      await unmounted; assert.equal(state.status, "error");
    }
    assert.match(source, /return \(\) => \{\s*\+\+statusRequest.current;/);
  });
}
test("Tools popup discards cached child when closed and starts checking on reopen", async () => {
  const source = await read(paths[0]);
  const child = {};
  const wrapper = runInNewContext(extract(source, "PraktikaToolsPopup") + "\nPraktikaToolsPopup", {
    React: { createElement: (type: unknown) => type }, PraktikaToolsPopupContent: child,
  });
  assert.equal(wrapper({ open: false }), null);
  assert.equal(wrapper({ open: true }), child);
  assert.match(source, /\[displayStatus, setDisplayStatus\] = useState\("refreshing"\)/);
  assert.doesNotMatch(source, /needsReconnect && currentStatus !== "connected"\s*\?/);
  const state = runInNewContext(extract(source, "connectionState") + "\nconnectionState", {});
  assert.equal(state("idle", false), "idle");
  assert.equal(state("connected", false), "connected");
  assert.equal(state("waiting_for_mfa", false), "connecting");
  assert.equal(state("waiting_for_credentials", false), "disconnected");
});
test("panels poll at five seconds and retire green while request is pending", async () => {
  for (const path of paths.slice(1, 3)) {
    const source = await read(path);
    assert.match(source, /STATUS_POLL_MS = 5000/);
    assert.match(source, /setState\(current => current.status === "connected" \? \{ \.\.\.current, status: "refreshing" \}/);
  }
});
test("migration removes table and column client mutation grants without changing SELECT or RLS", async () => {
  const sql = await read("supabase/migrations/202609090001_praktika_helper_lease.sql");
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger\s+on table public.praktika_sessions from public, anon, authenticated/);
  assert.match(sql, /revoke insert \(%s\), update \(%s\), references \(%s\)/);
  assert.match(sql, /has_column_privilege\('authenticated'/);
  assert.match(sql, /grant select, insert, update, delete on table public.praktika_sessions to service_role/);
  assert.doesNotMatch(sql, /revoke select|drop policy|disable row level security/i);
});
test("session panel display matrix: green only for connected, actionable credentials/MFA and neutral idle", async () => {
 const source=await read(paths[1]);
 const display=runInNewContext(extract(source,"getDisplayState")+"\ngetDisplayState",{isReconnectStatus:(s:string)=>["refresh_requested","refreshing"].includes(s)});
 for(const status of ["not_started","refreshing","connected","idle","waiting_for_credentials","waiting_for_mfa","error","expired"]){
  const result=display({status,message:""},status==="connected"?"connected":"not_checked");
  assert.equal(result.dot.includes("emerald"),status==="connected");
  if(status==="idle")assert.equal(result.label,"Idle");
  if(status==="waiting_for_credentials")assert.equal(result.label,"Login needed");
  if(status==="waiting_for_mfa")assert.equal(result.label,"MFA needed");
 }
});
test("compact panel and Tools display matrix",async()=>{
 const compact=await read(paths[2]);
 const label=runInNewContext(extract(compact,"needsLogin")+extract(compact,"statusLabel")+"\nstatusLabel",{});
 const tools=await read(paths[0]);
 const functions=runInNewContext(extract(tools,"connectionState")+extract(tools,"dotClass")+"\n({connectionState,dotClass})",{});
 for(const status of ["not_started","refreshing","connected","idle","waiting_for_credentials","waiting_for_mfa","error","expired"]){
  assert.equal(functions.dotClass(functions.connectionState(status,false)).includes("emerald"),status==="connected");
  assert.equal(label(status)==="Connected",status==="connected");
 }
 assert.equal(label("idle"),"Idle");
 assert.equal(label("waiting_for_mfa"),"MFA needed");
});
test("Workbench understands current API status vocabulary",async()=>{
 const source=await read(paths[4]);
 const label=runInNewContext(extract(source,"praktikaSessionStatusLabel")+"\npraktikaSessionStatusLabel",{});
 assert.equal(label("connected"),"Connected");
 assert.equal(label("idle"),"Idle");
 assert.equal(label("waiting_for_mfa"),"MFA required");
 assert.equal(label("waiting_for_credentials"),"Login required");
});
