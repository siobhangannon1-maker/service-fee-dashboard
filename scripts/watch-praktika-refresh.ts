import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const POLL_INTERVAL_MS = Number(
  process.env.PRAKTIKA_WATCHER_POLL_INTERVAL_MS || 10_000,
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const running = new Set<string>();

function nowIso() {
  return new Date().toISOString();
}

async function startHelperForSession(session: any, reason: string) {
  if (running.has(session.id)) {
    console.log(`Helper already running for ${session.id}. Reason: ${reason}`);
    return;
  }

  running.add(session.id);

  console.log(
    `Starting Praktika helper for ${session.scope} session ${session.id}. Reason: ${reason}`,
  );

  await supabase
    .from("praktika_sessions")
    .update({
      status: "refreshing",
      message:
        reason === "pending_job"
          ? "Local Praktika helper is starting to process queued jobs."
          : "Local Praktika helper is starting.",
      updated_at: nowIso(),
    })
    .eq("id", session.id);

  const child = spawn(
    "npm",
    ["run", "refresh:praktika-session", "--", `--session-id=${session.id}`],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  child.on("exit", async (code) => {
    running.delete(session.id);
    console.log(`Praktika helper for ${session.id} exited with code ${code}`);

    await supabase
      .from("praktika_sessions")
      .update({
        status: "error",
        message:
          "Local Praktika helper stopped. Click Reconnect before syncing again.",
        updated_at: nowIso(),
      })
      .eq("id", session.id);
  });

  child.on("error", async (error) => {
    running.delete(session.id);

    console.error(`Praktika helper for ${session.id} failed to start:`, error);

    await supabase
      .from("praktika_sessions")
      .update({
        status: "error",
        message: `Local Praktika helper failed to start: ${error.message}`,
        updated_at: nowIso(),
      })
      .eq("id", session.id);
  });
}

async function checkRefreshRequests() {
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
    await startHelperForSession(session, "refresh_requested");
  }
}

async function checkPendingJobs() {
  const { data: jobs, error } = await supabase
    .from("praktika_helper_jobs")
    .select("id, app_user_id, job_type, status, available_at, created_at")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("Could not check Praktika helper jobs:", error.message);
    return;
  }

  if (!jobs || jobs.length === 0) return;

  const userIds = Array.from(
    new Set(
      jobs
        .map((job) => job.app_user_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (userIds.length === 0) {
    console.warn(
      "There are pending Praktika helper jobs with no app_user_id. These cannot be processed by user-scoped helpers.",
    );
    return;
  }

  const { data: sessions, error: sessionError } = await supabase
    .from("praktika_sessions")
    .select("id, scope, app_user_id, status, message, refresh_requested_at")
    .eq("scope", "user")
    .in("app_user_id", userIds);

  if (sessionError) {
    console.error("Could not load Praktika sessions for jobs:", sessionError.message);
    return;
  }

  for (const userId of userIds) {
    const session = sessions?.find((item) => item.app_user_id === userId);

    if (!session) {
      console.warn(`No Praktika session exists for app user ${userId}.`);
      continue;
    }

    await startHelperForSession(session, "pending_job");
  }
}

async function check() {
  await checkRefreshRequests();
  await checkPendingJobs();
}

async function main() {
  console.log(
    `Watching Praktika refresh requests and helper jobs every ${Math.round(
      POLL_INTERVAL_MS / 1000,
    )} seconds...`,
  );

  await check();

  setInterval(() => {
    check().catch((error) => {
      console.error("Watcher check failed:", error);
    });
  }, POLL_INTERVAL_MS);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});