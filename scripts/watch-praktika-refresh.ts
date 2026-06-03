import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const POLL_INTERVAL_MS = Number(
  process.env.PRAKTIKA_WATCHER_POLL_INTERVAL_MS || 30_000,
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const running = new Set<string>();

function nowIso() {
  return new Date().toISOString();
}

async function claimRefreshRequest(sessionId: string) {
  const { data, error } = await supabase
    .from("praktika_sessions")
    .update({
      status: "refreshing",
      message: "Local Praktika helper is starting.",
      updated_at: nowIso(),
    })
    .eq("id", sessionId)
    .eq("status", "refresh_requested")
    .not("refresh_requested_at", "is", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(
      `Could not claim Praktika refresh request ${sessionId}:`,
      error.message,
    );
    return false;
  }

  return Boolean(data);
}

async function markHelperStartFailed(sessionId: string, message: string) {
  const { error } = await supabase
    .from("praktika_sessions")
    .update({
      status: "error",
      message,
      updated_at: nowIso(),
    })
    .eq("id", sessionId);

  if (error) {
    console.error(
      `Could not mark Praktika helper start failure for ${sessionId}:`,
      error.message,
    );
  }
}

async function check() {
  const { data, error } = await supabase
    .from("praktika_sessions")
    .select("id, scope, app_user_id, status, message, refresh_requested_at")
    .eq("status", "refresh_requested")
    .not("refresh_requested_at", "is", null)
    .order("refresh_requested_at", { ascending: true });

  if (error) {
    console.error("Could not check Praktika sessions:", error.message);
    return;
  }

  if (!data || data.length === 0) return;

  console.log(
    `Found ${data.length} Praktika refresh request(s):`,
    data.map((session) => ({
      id: session.id,
      scope: session.scope,
      app_user_id: session.app_user_id,
      refresh_requested_at: session.refresh_requested_at,
    })),
  );

  for (const session of data) {
    if (running.has(session.id)) {
      console.log(
        `Skipping ${session.id}; helper is already running in this watcher process.`,
      );
      continue;
    }

    running.add(session.id);

    const claimed = await claimRefreshRequest(session.id);

    if (!claimed) {
      running.delete(session.id);
      console.log(
        `Skipping ${session.id}; another watcher/helper already claimed it.`,
      );
      continue;
    }

    console.log(
      `Starting Praktika refresh for ${session.scope} session ${session.id}`,
    );

    const child = spawn(
      "npm",
      ["run", "refresh:praktika-session", "--", `--session-id=${session.id}`],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

    child.on("exit", (code) => {
      running.delete(session.id);
      console.log(`Refresh for ${session.id} exited with code ${code}`);
    });

    child.on("error", async (error) => {
      running.delete(session.id);

      console.error(`Refresh for ${session.id} failed to start:`, error);

      await markHelperStartFailed(
        session.id,
        `Local Praktika helper failed to start: ${error.message}`,
      );
    });
  }
}

async function main() {
  console.log(
    `Watching for Praktika refresh requests every ${Math.round(
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