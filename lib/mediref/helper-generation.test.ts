import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createMedirefLifecycle, writeMedirefGeneration } from "./helper-generation";
import { hasRecentMedirefAuthentication, safeToolsStatus } from "./tools-status";
const now = Date.parse("2026-09-10T00:00:00Z");
const iso = (offset: number) => new Date(now + offset).toISOString();
const healthy = { status: "connected", helper_instance_id: "new", authenticated_instance_id: "new", helper_heartbeat_at: iso(0), helper_expires_at: iso(120000), authenticated_at: iso(0) };
test("current live generation and proof required; historical cookies and proof cannot connect replacement", () => {
  assert.equal(hasRecentMedirefAuthentication(healthy, now), true);
  for (const patch of [
    { helper_instance_id: "replacement" }, { helper_heartbeat_at: iso(-120000) }, { authenticated_at: null }, { helper_expires_at: iso(0) },
    { helper_stopping_at: iso(0) }, { authenticated_at: iso(-300000) }, { status: "refreshing" },
    { status: "waiting_for_credentials" }, { status: "waiting_for_mfa" }, { status: "error" },
  ]) assert.equal(hasRecentMedirefAuthentication({ ...healthy, ...patch }, now), false);
  assert.equal(hasRecentMedirefAuthentication({ status: "connected", refreshed_at: iso(0), cookie: "SECRET" }, now), false);
  assert.equal(safeToolsStatus(healthy, null, now).session.validForMs, 120000);
  assert.equal(safeToolsStatus({ ...healthy, authenticated_at: iso(-290000) }, null, now).session.validForMs, 10000);
});
test("idle shutdown invalidates before closing and releases after close; repeated signals harmless", async () => {
  const events: string[] = []; let exit = 0;
  const lifecycle = createMedirefLifecycle({ write: async action => { events.push(action); return true; }, close: async () => { events.push("closed"); }, exit: () => { exit++; } });
  const stop = lifecycle.stop(); assert.equal(lifecycle.stopping, true);
  assert.equal(lifecycle.stop(), stop); await stop;
  assert.deepEqual(events, ["stop", "closed", "release"]); assert.equal(exit, 1);
  await assert.rejects(lifecycle.write("authenticate"));
});
test("browser close failure never releases ownership", async () => {
  const events: string[] = [];
  const lifecycle = createMedirefLifecycle({ write: async action => { events.push(action); return true; }, close: async () => { throw new Error("SECRET"); }, exit() {} });
  await lifecycle.stop(); assert.deepEqual(events, ["stop"]);
});
test("heartbeat runs independently; lost ownership stops browser and cannot authenticate", async () => {
  let beats = 0; let closed = false;
  const lifecycle = createMedirefLifecycle({ heartbeatMs: 1, write: async action => action === "heartbeat" ? ++beats < 2 : false, close: async () => { closed = true; }, exit() {} });
  lifecycle.start(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(closed, true); assert.equal(lifecycle.stopping, true);
  await assert.rejects(lifecycle.write("authenticate"));
});
test("RPC errors are redacted and writes always carry generation", async () => {
  await assert.rejects(writeMedirefGeneration({ rpc: async (_name, args) => {
    assert.equal(args.p_instance_id, "owner"); return { data: null, error: "SECRET" };
  } }, "session", "owner", "authenticate"), { message: "MediRef helper ownership unavailable." });
});
test("password selectors and ordering, pending-only claim and persistence adapter remain unchanged", () => {
  const file = "scripts/refresh-mediref-session.ts";
  const old = execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" });
  const current = readFileSync(file, "utf8");
  const login = (s: string) => s.slice(s.indexOf("async function getVisibleEmailField("), s.indexOf("async function submitMfaCodeIfAvailable("));
  assert.equal(login(current), login(old));
  assert.match(current, /\.eq\("status", "pending"\)/);
  assert.match(current, /process.on\("SIGTERM"/);
  assert.match(current, /lifecycle.write\("authenticate"/);
  for (const path of ["lib/mediref/remote-draft-adapter.ts", "lib/mediref/persisted-draft.ts", "lib/mediref/retry.ts", "lib/mediref/enqueue-transition.ts"]) {
    assert.equal(readFileSync(path,"utf8"), execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" }));
  }
});

test("hung browser close meets shutdown bound without releasing; no new work is admitted", async () => {
  const events: string[] = []; let exited!: () => void;
  const exit = new Promise<void>(resolve => { exited = resolve; });
  const lifecycle = createMedirefLifecycle({ cleanupMs: 5, write: async action => { events.push(action); return true; }, close: async () => new Promise(() => {}), exit: exited });
  void lifecycle.stop(); await exit;
  assert.equal(lifecycle.stopping, true);
  assert.deepEqual(events, ["stop"]);
});
test("watcher claims before spawn, forwards generation, and invalidates on known exit", () => {
  const watcher = readFileSync("scripts/watch-mediref-refresh.ts", "utf8");
  assert.ok(watcher.indexOf("const generation = await claimMedirefGeneration") < watcher.indexOf("const child = spawn("));
  assert.match(watcher, /--helper-instance-id=\$\{generation\}/);
  assert.match(watcher, /child.kill\(signal\)/);
  assert.match(watcher, /if \(shuttingDown\) \{\s*await writeMedirefGeneration[\s\S]*?"release"/);
  assert.doesNotMatch(watcher, /\.update\(/);
  assert.ok(watcher.includes('child.pid ? "stop" : "release"'));
  assert.match(watcher, /process.on\("SIGTERM"/);
});

test("real helper SIGTERM/SIGINT handlers invalidate once and close before release", async () => {
  const { spawn } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const source = readFileSync("scripts/refresh-mediref-session.ts", "utf8");
  const handlers = source.slice(source.indexOf('process.on("SIGTERM"'), source.indexOf("async function getSession()"));
  const moduleUrl = pathToFileURL(resolve("lib/mediref/helper-generation.ts")).href;
  const script = `import {createMedirefLifecycle} from ${JSON.stringify(moduleUrl)};
    const events=[];
    const lifecycle=createMedirefLifecycle({write:async(action)=>{events.push(action);return true;},
      close:async()=>{await new Promise(r=>setTimeout(r,100));events.push('closed');},
      exit:()=>{console.log(JSON.stringify(events));process.exit(0);}});
    ${handlers}
    lifecycle.start();console.log('ready');`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; let signalled = false;
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", chunk => {
        output += chunk;
        if (!signalled && output.includes("ready")) {
          signalled = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGINT"), 20);
        }
      });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Synthetic helper did not stop cleanly")));
    });
    assert.equal(signalled, true);
    assert.deepEqual(JSON.parse(output.trim().split("\n").at(-1)!), ["stop", "closed", "release"]);
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill("SIGKILL"); }
});
