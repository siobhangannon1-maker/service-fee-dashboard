import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const POLL_INTERVAL_MS = Number(
  process.env.MEDIREF_WATCHER_POLL_INTERVAL_MS || 10_000,
);

const SHUTDOWN_TIMEOUT_MS = Number(
  process.env.MEDIREF_WATCHER_SHUTDOWN_TIMEOUT_MS || 240_000,
);

const HELPER_RESTART_DELAY_MS = Number(
  process.env.MEDIREF_HELPER_RESTART_DELAY_MS || 5_000,
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type PracticeSession = {
  id: string;
  scope: string;
  app_user_id: string | null;
  status: string | null;
  message: string | null;
  refresh_requested_at: string | null;
};

let activeChild: ChildProcess | null = null;
let activeSessionId: string | null = null;
let activeReason: string | null = null;
let shuttingDown = false;
let pollTimer: NodeJS.Timeout | null = null;
let checkInProgress = false;
let restartTimer: NodeJS.Timeout | null = null;

function nowIso() {
  return new Date().toISOString();
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function log(message: string, details?: unknown) {
  const prefix = `[MediRef watcher ${nowIso()}]`;

  if (details === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }

  console.log(`${prefix} ${message}`, details);
}

function logError(message: string, error?: unknown) {
  const prefix = `[MediRef watcher ${nowIso()}]`;

  if (error === undefined) {
    console.error(`${prefix} ${message}`);
    return;
  }

  console.error(`${prefix} ${message}`, error);
}

async function updatePracticeSession(
  sessionId: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("mediref_sessions")
    .update({
      ...values,
      updated_at: nowIso(),
    })
    .eq("id", sessionId);

  if (error) {
    logError(
      `Could not update MediRef practice session ${sessionId}: ${error.message}`,
    );
  }
}

async function getPracticeSession(): Promise<PracticeSession> {
  const { data, error } = await supabase
    .from("mediref_sessions")
    .select("id, scope, app_user_id, status, message, refresh_requested_at")
    .eq("scope", "practice")
    .is("app_user_id", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load MediRef practice session: ${error.message}`);
  }

  if (!data) {
    throw new Error(
      "No MediRef practice session row exists. Create one in mediref_sessions.",
    );
  }

  return data as PracticeSession;
}

async function hasPendingJob() {
  const { data, error } = await supabase
    .from("mediref_helper_jobs")
    .select("id")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(`Could not check MediRef helper jobs: ${error.message}`);
  }

  return Boolean(data && data.length > 0);
}

function helperIsRunning() {
  return Boolean(activeChild && activeChild.exitCode === null);
}

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleNextPoll(delay = POLL_INTERVAL_MS) {
  if (shuttingDown) return;

  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  pollTimer = setTimeout(() => {
    pollTimer = null;

    runCheck().catch((error) => {
      logError("MediRef watcher check failed.", error);
    });
  }, delay);
}

function getTsxCliPath() {
  return path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
}

async function startHelperForPracticeSession(
  session: PracticeSession,
  reason: string,
) {
  if (shuttingDown) {
    log(`Not starting helper during shutdown. Reason: ${reason}`);
    return;
  }

  if (helperIsRunning()) {
    log(
      `Helper is already running for practice session ${activeSessionId}. ` +
        `Current reason: ${activeReason}. New reason: ${reason}.`,
    );
    return;
  }

  clearRestartTimer();

  activeSessionId = session.id;
  activeReason = reason;

  log(
    `Starting MediRef helper for practice session ${session.id}. Reason: ${reason}.`,
  );

  await updatePracticeSession(session.id, {
    status: "refreshing",
    message:
      reason === "pending_job"
        ? "MediRef helper is processing queued practice jobs."
        : "MediRef helper is starting.",
  });

  const helperScript = path.resolve(
    process.cwd(),
    "scripts",
    "refresh-mediref-session.ts",
  );

  const child = spawn(
    process.execPath,
    [getTsxCliPath(), helperScript, `--session-id=${session.id}`],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
      shell: false,
    },
  );

  activeChild = child;

  child.once("spawn", () => {
    log(
      `MediRef helper process started with PID ${child.pid ?? "unknown"}.`,
    );
  });

  child.once("error", async (error) => {
    if (activeChild === child) {
      activeChild = null;
      activeSessionId = null;
      activeReason = null;
    }

    logError("MediRef helper failed to start.", error);

    await updatePracticeSession(session.id, {
      status: "error",
      message: `MediRef helper failed to start: ${error.message}`,
    });

    if (!shuttingDown) {
      restartTimer = setTimeout(() => {
        restartTimer = null;
        scheduleNextPoll(0);
      }, HELPER_RESTART_DELAY_MS);
    }
  });

  child.once("exit", async (code, signal) => {
    const wasCurrentChild = activeChild === child;

    if (wasCurrentChild) {
      activeChild = null;
      activeSessionId = null;
      activeReason = null;
    }

    const exitDescription =
      signal != null ? `signal ${signal}` : `code ${String(code)}`;

    log(
      `MediRef helper for practice session ${session.id} exited with ${exitDescription}.`,
    );

    if (shuttingDown) {
      return;
    }

    if (code === 0 && signal == null) {
      await updatePracticeSession(session.id, {
        status: "ready",
        message:
          "MediRef helper stopped cleanly and will restart automatically when new work arrives.",
      });
    } else {
      await updatePracticeSession(session.id, {
        status: "error",
        message:
          `MediRef helper stopped unexpectedly with ${exitDescription}. ` +
          "The watcher will retry automatically.",
      });
    }

    /*
      Re-check quickly after any helper exit.

      This is important after a Render restart or helper crash. If a job is still
      pending, the replacement helper starts without requiring a manual worker
      restart.
    */
    restartTimer = setTimeout(() => {
      restartTimer = null;
      scheduleNextPoll(0);
    }, HELPER_RESTART_DELAY_MS);
  });
}

async function runCheck() {
  if (shuttingDown) return;

  if (checkInProgress) {
    log("Skipping overlapping poll because the previous check is still running.");
    scheduleNextPoll();
    return;
  }

  checkInProgress = true;

  try {
    const session = await getPracticeSession();

    if (helperIsRunning()) {
      scheduleNextPoll();
      return;
    }

    const refreshRequested =
      session.status === "refresh_requested" &&
      Boolean(session.refresh_requested_at);

    if (refreshRequested) {
      await startHelperForPracticeSession(session, "refresh_requested");
      scheduleNextPoll();
      return;
    }

    if (await hasPendingJob()) {
      await startHelperForPracticeSession(session, "pending_job");
      scheduleNextPoll();
      return;
    }

    scheduleNextPoll();
  } finally {
    checkInProgress = false;
  }
}

async function stopActiveChild(signal: NodeJS.Signals) {
  const child = activeChild;

  if (!child || child.exitCode !== null) {
    return;
  }

  log(
    `Forwarding ${signal} to MediRef helper PID ${child.pid ?? "unknown"}.`,
  );

  child.kill(signal);

  await new Promise<void>((resolve) => {
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    child.once("exit", finish);

    setTimeout(() => {
      if (child.exitCode === null) {
        logError(
          `MediRef helper did not exit within ${Math.round(
            SHUTDOWN_TIMEOUT_MS / 1000,
          )} seconds. Sending SIGKILL.`,
        );
        child.kill("SIGKILL");
      }

      finish();
    }, SHUTDOWN_TIMEOUT_MS);
  });
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;

  shuttingDown = true;

  log(`${signal} received. Stopping MediRef watcher gracefully.`);

  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  clearRestartTimer();

  try {
    await stopActiveChild(signal);
  } catch (error) {
    logError("Error while stopping the MediRef helper.", error);
  }

  log("MediRef watcher shutdown complete.");
  process.exit(0);
}

async function main() {
  log(
    `Watching MediRef practice refresh requests and helper jobs every ${Math.round(
      POLL_INTERVAL_MS / 1000,
    )} seconds.`,
  );

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("uncaughtException", (error) => {
    logError("Uncaught exception in MediRef watcher.", error);
  });

  process.on("unhandledRejection", (reason) => {
    logError("Unhandled promise rejection in MediRef watcher.", reason);
  });

  /*
    A tiny delay lets Render finish bringing the container online before the
    first Supabase request. It also makes deploy logs easier to read.
  */
  await sleep(1_000);
  await runCheck();
}

main().catch((error) => {
  logError("MediRef watcher failed during startup.", error);
  process.exit(1);
});
