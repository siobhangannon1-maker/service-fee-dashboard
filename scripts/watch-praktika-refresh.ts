import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const running = new Set<string>();

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
    data.map((s) => ({
      id: s.id,
      scope: s.scope,
      app_user_id: s.app_user_id,
      refresh_requested_at: s.refresh_requested_at,
    })),
  );

  for (const session of data) {
    if (running.has(session.id)) continue;

    running.add(session.id);

    console.log(
      `Starting Praktika refresh for ${session.scope} session ${session.id}`,
    );

    const child = spawn(
      "npm",
      ["run", "refresh:praktika-session", "--", `--session-id=${session.id}`],
      {
        cwd: process.cwd(),
        stdio: "inherit",
        shell: false,
      },
    );

    child.on("exit", (code) => {
      running.delete(session.id);
      console.log(`Refresh for ${session.id} exited with code ${code}`);
    });

    child.on("error", (error) => {
      running.delete(session.id);
      console.error(`Refresh for ${session.id} failed to start:`, error);
    });
  }
}

async function main() {
  console.log("Watching for Praktika refresh requests...");
  setInterval(() => check().catch(console.error), 5000);
  await check();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});