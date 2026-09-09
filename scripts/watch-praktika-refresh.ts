import { claimPlannedRestoration } from "../lib/praktika/planned-restoration";
import { claimPraktikaHelper, writePraktikaHelper } from "../lib/praktika/helper-lease";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn, type ChildProcess } from "node:child_process";

dotenv.config({ path: ".env.local" });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const POLL_INTERVAL_MS = Number(
  process.env.PRAKTIKA_WATCHER_POLL_INTERVAL_MS || 10_000,
);

const MEMORY_LOG_INTERVAL_MS = Number(
  process.env.PRAKTIKA_MEMORY_LOG_INTERVAL_MS || 5 * 60_000,
);

const MAX_CONCURRENT_HELPERS = Number(
  process.env.PRAKTIKA_MAX_CONCURRENT_HELPERS || 3,
);

const PENDING_JOB_SCAN_LIMIT = Number(
  process.env.PRAKTIKA_PENDING_JOB_SCAN_LIMIT || 500,
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const running = new Set<string>();
const children = new Map<string, { child: ChildProcess; owner: string }>();
let shuttingDown = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(pollTimer);
  console.log("[Praktika lifecycle]", JSON.stringify({ event: "shutdown_started", stage: "watcher" }));
  for (const { child, owner } of children.values()) {
    let delivered = false;
    try { delivered = child.kill("SIGTERM"); } catch { /* Log only the fixed delivery result. */ }
    console.log("[Praktika lifecycle]", JSON.stringify({ event: "helper_signal_sent", generation: owner, delivered }));
  }
  // Never release a generation merely because the supervisor is stopping.
  const deadline = setTimeout(() => process.exit(1), 28_000);
  const drained = setInterval(() => {
    if (!checkInProgress && running.size === 0) {
      clearTimeout(deadline); clearInterval(drained);
    }
  }, 50);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
let checkInProgress = false;
let lastMemoryLogAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function formatMb(bytes: number) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function logWatcherMemory() {
  const memory = process.memoryUsage();

  console.log(
    `[memory] watcher rss=${formatMb(memory.rss)}MB heapUsed=${formatMb(
      memory.heapUsed,
    )}MB activeHelpers=${running.size}/${MAX_CONCURRENT_HELPERS}`,
  );
}

function helperCapacityAvailable() {
  return !shuttingDown && running.size < MAX_CONCURRENT_HELPERS;
}

async function startHelperForSession(session: any, reason: string) {
  if (running.has(session.id)) {
    console.log(`Helper already running for ${session.id}. Reason: ${reason}`);
    return false;
  }

  if (!helperCapacityAvailable()) {
    console.log(
      `Helper capacity reached (${running.size}/${MAX_CONCURRENT_HELPERS}). Session ${session.id} will remain queued. Reason: ${reason}`,
    );
    return false;
  }

  running.add(session.id);

  let instanceId: string | null;
  let idleRemainingMs: number | undefined;
  let claimReceivedAt = 0;
  let restoring = reason === "restoration";
  let restorationSource = session.source_instance_id;
  try {
    if (reason === "pending_job") {
      // Queued work has priority, but must not reset a carried idle budget
      // before it has actually completed useful work.
      const { data, error } = await supabase.from("praktika_helper_restorations")
        .select("source_instance_id").eq("session_id", session.id)
        .is("consumed_at", null).gt("expires_at", nowIso()).maybeSingle();
      if (error) throw new Error("Restoration lookup unavailable");
      if (data) { restoring = true; restorationSource = data.source_instance_id; }
    }
    if (shuttingDown) { running.delete(session.id); return false; }
    if (restoring) {
      const claim = await claimPlannedRestoration(supabase, session.id, restorationSource);
      instanceId = claim?.instance_id || null;
      idleRemainingMs = claim?.idle_remaining_ms;
      claimReceivedAt = performance.now();
      if (claim) console.log("[Praktika lifecycle] restoration_consumed");
    } else {
      instanceId = await claimPraktikaHelper(supabase, session.id);
    }
  } catch {
    running.delete(session.id);
    console.error("Praktika helper ownership claim failed; no helper started.");
    return false;
  }
  if (!instanceId) {
    running.delete(session.id);
    return false;
  }

  const owner = instanceId;
  if (shuttingDown || (idleRemainingMs !== undefined && idleRemainingMs <= 0)) {
    await writePraktikaHelper(supabase, session.id, owner, "release").catch(() => {});
    running.delete(session.id);
    return false;
  }
  let cleanedUp = false;
  const cleanup = async (failed: boolean, leaseFallback = false) => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      // A late exit can neither promote Connected nor overwrite a newer owner.
      if (!leaseFallback && (!shuttingDown || !failed)) await writePraktikaHelper(supabase, session.id, owner, "release", {
        status: failed ? "error" : "not_started",
      });
    } catch {
      console.warn("Praktika helper exit cleanup skipped: ownership unavailable.");
    } finally {
      children.delete(session.id);
      running.delete(session.id);
    }
  };

  try {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/refresh-praktika-session.ts", `--session-id=${session.id}`,
        `--helper-instance-id=${owner}`,
        ...(idleRemainingMs === undefined ? [] : [`--restore-idle-remaining-ms=${Math.max(0, Math.floor(idleRemainingMs - (performance.now() - claimReceivedAt)))}`])],
      { cwd: process.cwd(), stdio: "inherit", shell: process.platform === "win32" },
    );
    if (restoring) console.log("[Praktika lifecycle] restoration_started");
    children.set(session.id, { child, owner });
    child.on("exit", (code) => { void cleanup(code !== 0, code === 75); });
    child.on("error", () => { void cleanup(true); });
  } catch {
    await cleanup(true);
    return false;
  }

  return true;
}

async function checkRefreshRequests() {
  if (!helperCapacityAvailable()) return;

  const { data, error } = await supabase
    .from("praktika_sessions")
    .select("id, scope, app_user_id, status, message, refresh_requested_at")
    .eq("status", "refresh_requested")
    .not("refresh_requested_at", "is", null)
    .order("refresh_requested_at", { ascending: true });

  if (error) {
    console.error("Could not check Praktika refresh requests:", error.message);
    return;
  }

  for (const session of data || []) {
    if (!helperCapacityAvailable()) break;
    await startHelperForSession(session, "refresh_requested");
  }
}

async function loadPendingUsersFairly() {
  const { data: jobs, error } = await supabase
    .from("praktika_helper_jobs")
    .select("id, app_user_id, job_type, status, available_at, created_at")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("created_at", { ascending: true })
    .limit(PENDING_JOB_SCAN_LIMIT);

  if (error) {
    console.error("Could not check Praktika helper jobs:", error.message);
    return [];
  }

  if (!jobs || jobs.length === 0) return [];

  const firstPendingJobByUser = new Map<
    string,
    { appUserId: string; createdAt: string }
  >();

  for (const job of jobs) {
    const appUserId = String(job.app_user_id || "").trim();
    if (!appUserId) continue;

    if (!firstPendingJobByUser.has(appUserId)) {
      firstPendingJobByUser.set(appUserId, {
        appUserId,
        createdAt: String(job.created_at || ""),
      });
    }
  }

  return Array.from(firstPendingJobByUser.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

async function checkPendingJobs() {
  if (!helperCapacityAvailable()) return;

  const pendingUsers = await loadPendingUsersFairly();

  if (pendingUsers.length === 0) return;

  const appUserIds = pendingUsers.map((item) => item.appUserId);

  const { data: sessions, error: sessionError } = await supabase
    .from("praktika_sessions")
    .select("id, scope, app_user_id, status, message, refresh_requested_at")
    .eq("scope", "user")
    .in("app_user_id", appUserIds);

  if (sessionError) {
    console.error(
      "Could not load Praktika sessions for jobs:",
      sessionError.message,
    );
    return;
  }

  const sessionByUserId = new Map(
    (sessions || [])
      .filter((session) => Boolean(session.app_user_id))
      .map((session) => [String(session.app_user_id), session]),
  );

  for (const pendingUser of pendingUsers) {
    if (!helperCapacityAvailable()) break;

    const session = sessionByUserId.get(pendingUser.appUserId);

    if (!session) {
      console.warn(
        `No Praktika session exists for app user ${pendingUser.appUserId}.`,
      );
      continue;
    }

    if (running.has(session.id)) {
      continue;
    }

    const sessionStatus = String(session.status || "").trim();

    if (
      sessionStatus === "waiting_for_credentials" ||
      sessionStatus === "waiting_for_mfa" ||
      sessionStatus === "error" ||
      sessionStatus === "expired"
    ) {
      console.log(
        `Skipping session ${session.id} for app user ${pendingUser.appUserId} because status=${sessionStatus}. Pending jobs remain queued.`,
      );
      continue;
    }

    await startHelperForSession(session, "pending_job");
  }
}

async function checkRestorationRequests() {
  if (!helperCapacityAvailable()) return;
  const { data, error } = await supabase.from("praktika_helper_restorations")
    .select("session_id, source_instance_id")
    .is("consumed_at", null).gt("expires_at", nowIso())
    .order("requested_at", { ascending: true }).limit(PENDING_JOB_SCAN_LIMIT);
  if (error) { console.warn("[Praktika lifecycle] restoration_skipped"); return; }
  for (const request of data || []) {
    if (!helperCapacityAvailable()) break;
    await startHelperForSession({ id: request.session_id, source_instance_id: request.source_instance_id }, "restoration");
  }
}

async function check() {
  if (shuttingDown) return;
  if (checkInProgress) {
    console.log("Watcher check skipped because the previous check is still running.");
    return;
  }

  checkInProgress = true;

  try {
    const now = Date.now();

    if (now - lastMemoryLogAt >= MEMORY_LOG_INTERVAL_MS) {
      logWatcherMemory();
      lastMemoryLogAt = now;
    }

    await checkRefreshRequests();
    await checkPendingJobs();
    await checkRestorationRequests();
  } finally {
    checkInProgress = false;
  }
}

async function main() {
  console.log(
    `Watching Praktika refresh requests and helper jobs every ${Math.round(
      POLL_INTERVAL_MS / 1000,
    )} seconds...`,
  );

  console.log(
    `Praktika helper concurrency limit: ${MAX_CONCURRENT_HELPERS}. Pending job scan limit: ${PENDING_JOB_SCAN_LIMIT}.`,
  );

  await check();

  if (shuttingDown) return;
  pollTimer = setInterval(() => {
    check().catch((error) => {
      console.error("Watcher check failed:", error);
    });
  }, POLL_INTERVAL_MS);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
