import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PraktikaAuthenticationUnverified } from "./authentication-probe";
import { createClient } from "@supabase/supabase-js";
import {
  hasLivePraktikaHelper, claimPraktikaHelper, writePraktikaHelper,
  PraktikaOwnershipLost, PRAKTIKA_HELPER_LEASE_MS,
} from "./helper-lease";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFile(new URL(file, root), "utf8");
async function functionsFrom(file: string, names: string[], globals: Record<string, unknown>) {
  const source = await read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ""));
  assert.equal(selected.length, names.length);
  const compiled = ts.transpileModule(selected.map((node) => node.getText(ast).replace(/^export /, "")).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(`${compiled}\n({${names.join(",")}})`, globals);
}
const quiet = { log() {}, warn() {}, error() {} };

test("historical, missing, stale and future health never count as live; checking creates no proof", () => {
  const now = Date.now();
  const historical = { status: "connected", cookie: "fixture", refreshed_at: new Date(now).toISOString() };
  assert.equal(hasLivePraktikaHelper({ ...historical, helper_instance_id: null }, now), false);
  for (const age of [PRAKTIKA_HELPER_LEASE_MS, PRAKTIKA_HELPER_LEASE_MS + 1, -1]) {
    assert.equal(hasLivePraktikaHelper({ helper_instance_id: "owner", helper_heartbeat_at: new Date(now - age).toISOString() }, now), false);
  }
  const live = { helper_instance_id: "owner", helper_heartbeat_at: new Date(now - 15_000).toISOString(), authenticated_at: null };
  const before = { ...live };
  assert.equal(hasLivePraktikaHelper(live, now), true);
  assert.deepEqual(live, before);
  assert.equal(hasLivePraktikaHelper({ helper_heartbeat_at: live.helper_heartbeat_at }, now), false);
});

test("RPC client carries exact generation, treats zero rows/errors as lost and never sends proof", async () => {
  let answer: unknown = "owner-a";
  let responseStatus = 200;
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const db = createClient("https://fixture.invalid", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      calls.push({ path: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(answer), { status: responseStatus, headers: { "content-type": "application/json" } });
    } },
  });
  assert.equal(await claimPraktikaHelper(db, "session"), "owner-a");
  answer = null;
  assert.equal(await claimPraktikaHelper(db, "session"), null);
  answer = true;
  await writePraktikaHelper(db, "session", "owner-a", "heartbeat");
  assert.deepEqual(calls.at(-1)?.body, { p_session_id: "session", p_instance_id: "owner-a", p_action: "heartbeat", p_values: {} });
  answer = false;
  await assert.rejects(writePraktikaHelper(db, "session", "old-owner", "update", { status: "connected" }), PraktikaOwnershipLost);
  answer = { message: "fixture database error" }; responseStatus = 500;
  await assert.rejects(writePraktikaHelper(db, "session", "owner-a", "heartbeat"), PraktikaOwnershipLost);
  assert.ok(calls.every((call) => !JSON.stringify(call.body).includes("authenticated_at")));
});

async function watcher(claim: () => Promise<string | null>, writes: unknown[]) {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const spawns: string[][] = [];
  const running = new Set<string>();
  const result = await functionsFrom("scripts/watch-praktika-refresh.ts", ["startHelperForSession"], {
    shuttingDown: false, children: new Map(), running, console: quiet, helperCapacityAvailable: () => true,
    claimPraktikaHelper: claim, supabase: {}, MAX_CONCURRENT_HELPERS: 3,
    writePraktikaHelper: async (...args: unknown[]) => { writes.push(args.slice(1)); },
    process: { cwd: () => ".", platform: "linux" },
    spawn: (_cmd: string, args: string[]) => { spawns.push(args); return { on: (event: string, cb: (...args: unknown[]) => void) => { handlers[event] = cb; } }; },
  });
  return { start: () => result.startHelperForSession({ id: "session" }, "refresh_requested"), handlers, spawns, running };
}

test("separate watchers only spawn for successful atomic claim; pass both identifiers", async () => {
  // RPC boundary double: PostgreSQL locking is reviewed separately below.
  let owner: string | null = null;
  const claim = async () => { if (owner) return null; owner = "generation-a"; return owner; };
  const a = await watcher(claim, []); const b = await watcher(claim, []);
  assert.deepEqual(await Promise.all([a.start(), b.start()]), [true, false]);
  assert.equal(a.spawns.length + b.spawns.length, 1);
  assert.ok(a.spawns[0].includes("--session-id=session"));
  assert.ok(a.spawns[0].includes("--helper-instance-id=generation-a"));
});

test("claim failure starts no browser and frees local capacity", async () => {
  const w = await watcher(async () => { throw new Error("unavailable"); }, []);
  assert.equal(await w.start(), false);
  assert.equal(w.running.size, 0); assert.equal(w.spawns.length, 0);
});

test("clean exit only releases captured generation; never promotes Connected; duplicate exit ignored", async () => {
  const writes: unknown[] = [];
  const w = await watcher(async () => "old-owner", writes);
  await w.start(); w.handlers.exit(0);
  await new Promise((resolve) => setImmediate(resolve));
  w.handlers.error(new Error("late error"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  assert.equal(JSON.stringify(writes[0]), JSON.stringify(["session", "old-owner", "release", { status: "not_started" }]));
  assert.equal(w.running.size, 0);
});

test("helper session writes fail closed, close old browser, and refuse subsequent writes", async () => {
  const globals = {
    ownershipLost: false, sessionId: "session", helperInstanceId: "old-owner",
    renewal: { stop: () => { stopped++; } },
    shutdownCoordinator: { close: async () => { closed++; return true; } }, supabase: {}, PraktikaOwnershipLost,
    writePraktikaHelper: async () => { attempts++; throw new PraktikaOwnershipLost(); },
  };
  let attempts = 0; let closed = 0; let stopped = 0;
  const { ownedWrite } = await functionsFrom("scripts/refresh-praktika-session.ts", ["ownedWrite"], globals);
  await assert.rejects(ownedWrite("update", { status: "connected" }), PraktikaOwnershipLost);
  await assert.rejects(ownedWrite("heartbeat"), PraktikaOwnershipLost);
  assert.equal(closed, 1); assert.equal(attempts, 1); assert.equal(stopped, 1);
});

test("browser liveness failure releases as error and closes browser without authentication write", async () => {
  let tick: (() => void) | undefined; const events: string[] = [];
  const globals = {
    shuttingDown: false, ownershipLost: false, PRAKTIKA_HELPER_HEARTBEAT_MS: 15_000, PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS: 5_000,
    shutdownCoordinator: { close: async () => { events.push("close"); return true; } },
    setTimeout, clearTimeout,
    setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval() {},
    ownedWrite: async (action: string) => { events.push(action); },
    releaseOwnership: async (failed: boolean) => { assert.equal(failed, true); events.push("release"); },
  };
  const { startHeartbeat } = await functionsFrom("scripts/refresh-praktika-session.ts", ["startHeartbeat"], globals);
  const stop = startHeartbeat({ cookies: async () => { throw new Error("browser closed"); }, close: async () => { events.push("close"); } });
  tick!(); await stop();
  assert.deepEqual(events, ["close", "release"]); assert.equal(globals.ownershipLost, true);
});

test("ownership loss during a job never requeues an ambiguous external operation", async () => {
  for (const lostAt of [1, 2, 3, 4]) {
    let checks = 0; let requests = 0; let failed = 0; let completed = 0;
    const ownership = { assertOwned: async () => { if (++checks === lostAt) throw new PraktikaOwnershipLost(); }, updateSession: async () => {}, ensureAuthenticated: async () => {} };
    const { processOnePraktikaHelperJob } = await functionsFrom("scripts/praktika-helper-job-processor.ts", ["processOnePraktikaHelperJob"], {
      console: quiet, PraktikaOwnershipLost,
      claimNextJob: async () => ({ id: "fixture", job_type: "fixture", request: {} }),
      runPraktikaRequest: async () => { requests++; return {}; },
      completeJob: async () => { completed++; }, markSessionConnectedForJob: async () => {},
      failJob: async () => { failed++; },
    });
    await assert.rejects(processOnePraktikaHelperJob({}, "user", ownership), PraktikaOwnershipLost);
    assert.equal(requests, lostAt === 4 ? 1 : 0); assert.equal(failed, 0); assert.equal(completed, 0);
  }
});

test("migration contract fences stale generations, clears proof, and preserves terminal state on release", async () => {
  // Static migration checks, not a substitute for PostgreSQL concurrency tests before rollout.
  const sql = await read("supabase/migrations/202609090001_praktika_helper_lease.sql");
  const claim = sql.slice(sql.indexOf("create function public.claim_praktika_helper"), sql.indexOf("-- All helper-owned writes"));
  assert.match(claim, /gen_random_uuid\(\)/);
  assert.match(claim, /authenticated_at = null/);
  assert.match(claim, /where id = p_session_id and \(helper_instance_id is null/);
  assert.match(claim, /helper_heartbeat_at <= clock_timestamp\(\) - interval '90 seconds'/);
  assert.match(sql, /where id = p_session_id for update/);
  assert.match(sql, /helper_instance_id is distinct from p_instance_id/);
  const heartbeat = sql.slice(sql.indexOf("if p_action = 'heartbeat'"), sql.indexOf("if p_action = 'authenticate'"));
  assert.doesNotMatch(heartbeat, /authenticated_at|status\s*=/);
  const release = sql.slice(sql.indexOf("if p_action = 'release'"), sql.indexOf("if p_action <> 'update'"));
  assert.match(release, /helper_instance_id = null, helper_heartbeat_at = null/);
  assert.match(release, /authenticated_at = null/);
  assert.match(release, /status in \('error', 'waiting_for_credentials', 'waiting_for_mfa', 'refresh_requested'\) then status/);
  assert.doesNotMatch(release, /'connected'|cookie\s*=/);
  assert.match(sql, /revoke all on function public.claim_praktika_helper\(uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public.praktika_helper_write\(uuid,uuid,text,jsonb\) to service_role/);
  assert.equal(PRAKTIKA_HELPER_LEASE_MS, 90_000);
});

test("production consumers gate saved Connected on liveness, and idle does not promote it", async () => {
  for (const file of ["app/api/praktika/session/status/route.ts", "app/api/praktika/session/refresh/route.ts", "lib/praktika/validate-praktika-session.ts", "lib/praktika/hybrid-seamless-request.ts"]) {
    assert.match(await read(file), /derivePraktikaConnection\(/);
  }
  const helper = await read("scripts/refresh-praktika-session.ts");
  const idle = helper.slice(helper.indexOf("} else if (remainingUsefulWorkMs()"), helper.indexOf("} else if (await pageHasMfaInput", helper.indexOf("} else if (remainingUsefulWorkMs()")));
  assert.match(idle, /false, \/\/ Save reusable cookies/);
  assert.match(idle, /return;/);
  assert.match(helper, /shutdownCoordinator.close\(\)[^]*?await releaseOwnership\(\)/);
  assert.doesNotMatch(idle, /status: "connected"/);
  for (const file of ["scripts/watch-praktika-refresh.ts", "scripts/refresh-praktika-session.ts", "scripts/praktika-helper-job-processor.ts"]) {
    assert.doesNotMatch(await read(file), /\.from\("praktika_sessions"\)\s*\.update/);
  }
});

test("failed authentication stops the claimed job before any Praktika operation and prevents retry", async () => {
  let requests = 0; let completed = 0; let failed = 0;
  const { processOnePraktikaHelperJob } = await functionsFrom("scripts/praktika-helper-job-processor.ts", ["processOnePraktikaHelperJob"], {
    console: quiet, PraktikaOwnershipLost, PraktikaAuthenticationUnverified,
    claimNextJob: async () => ({ id: "fixture", job_type: "fixture", request: {} }),
    runPraktikaRequest: async () => { requests++; },
    completeJob: async () => { completed++; },
    failJob: async (_job: unknown, _message: string, permanent: boolean) => { assert.equal(permanent, true); failed++; },
  });
  const result = await processOnePraktikaHelperJob({}, "user", {
    assertOwned: async () => {}, updateSession: async () => {},
    ensureAuthenticated: async () => { throw new PraktikaAuthenticationUnverified(); },
  });
  assert.equal(result.outcome, "needs_reconnect");
  assert.equal(requests, 0); assert.equal(completed, 0); assert.equal(failed, 1);
});
