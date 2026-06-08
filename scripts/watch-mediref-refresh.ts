import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const POLL_INTERVAL_MS = Number(
  process.env.MEDIREF_WATCHER_POLL_INTERVAL_MS || 10_000,
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const running = new Set<string>();

function nowIso() {
  return new Date().toISOString();
}

async function getPracticeSession() {
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

  return data;
}

async function startHelperForPracticeSession(reason: string) {
  const session = await getPracticeSession();

  if (running.has(session.id)) {
    console.log(
      `MediRef helper already running for practice session ${session.id}. Reason: ${reason}`,
    );
    return;
  }

  running.add(session.id);

  console.log(
    `Starting MediRef helper for practice session ${session.id}. Reason: ${reason}`,
  );

  await supabase
    .from("mediref_sessions")
    .update({
      status: "refreshing",
      message:
        reason === "pending_job"
          ? "Local MediRef helper is starting to process queued practice jobs."
          : "Local MediRef helper is starting.",
      updated_at: nowIso(),
    })
    .eq("id", session.id);

  const child = spawn(
    "npm",
    [
      "run",
      "refresh:mediref-session",
      "--",
      `--session-id=${session.id}`,
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  child.on("exit", async (code) => {
    running.delete(session.id);
    console.log(
      `MediRef helper for practice session ${session.id} exited with code ${code}`,
    );

    await supabase
      .from("mediref_sessions")
      .update({
        status: "error",
        message:
          "Local MediRef helper stopped. Click Reconnect before sending again.",
        updated_at: nowIso(),
      })
      .eq("id", session.id);
  });

  child.on("error", async (error) => {
    running.delete(session.id);

    console.error(
      `MediRef helper for practice session ${session.id} failed to start:`,
      error,
    );

    await supabase
      .from("mediref_sessions")
      .update({
        status: "error",
        message: `Local MediRef helper failed to start: ${error.message}`,
        updated_at: nowIso(),
      })
      .eq("id", session.id);
  });
}

async function checkRefreshRequests() {
  const { data, error } = await supabase
    .from("mediref_sessions")
    .select("id, scope, app_user_id, status, message, refresh_requested_at")
    .eq("scope", "practice")
    .is("app_user_id", null)
    .eq("status", "refresh_requested")
    .not("refresh_requested_at", "is", null)
    .order("refresh_requested_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Could not check MediRef refresh requests:", error.message);
    return;
  }

  if ((data || []).length > 0) {
    await startHelperForPracticeSession("refresh_requested");
  }
}

async function checkPendingJobs() {
  const { data: jobs, error } = await supabase
    .from("mediref_helper_jobs")
    .select("id, app_user_id, job_type, status, available_at, created_at")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Could not check MediRef helper jobs:", error.message);
    return;
  }

  if (!jobs || jobs.length === 0) return;

  await startHelperForPracticeSession("pending_job");
}

async function check() {
  await checkRefreshRequests();
  await checkPendingJobs();
}

async function main() {
  console.log(
    `Watching MediRef practice refresh requests and helper jobs every ${Math.round(
      POLL_INTERVAL_MS / 1000,
    )} seconds...`,
  );

  await check();

  setInterval(() => {
    check().catch((error) => {
      console.error("MediRef watcher check failed:", error);
    });
  }, POLL_INTERVAL_MS);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});