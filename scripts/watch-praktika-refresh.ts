import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
}

if (!serviceRoleKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

let running = false;
let lastRefreshRequestedAt: string | null = null;

async function check() {
  if (running) return;

  const { data, error } = await supabase
    .from("praktika_session")
    .select("status, refresh_requested_at")
    .eq("id", "main")
    .single();

  if (error) {
    console.error("Could not check Praktika session:", error.message);
    return;
  }

  if (
    data?.status === "refresh_requested" &&
    data?.refresh_requested_at &&
    data.refresh_requested_at !== lastRefreshRequestedAt
  ) {
    running = true;
    lastRefreshRequestedAt = data.refresh_requested_at;

    console.log("Praktika refresh requested. Starting local refresh script...");

    const child = spawn("npm", ["run", "refresh:praktika-cookie"], {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", (code) => {
      running = false;
      console.log(`Praktika refresh script exited with code ${code}`);
    });
  }
}

async function main() {
  console.log("Watching for Praktika refresh requests...");

  setInterval(() => {
    check().catch((error) => {
      console.error("Watcher error:", error);
    });
  }, 5000);

  await check();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});