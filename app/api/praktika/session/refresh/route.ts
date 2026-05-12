import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SESSION_DIR = path.join(process.cwd(), ".praktika-session");
const STATE_PATH = path.join(SESSION_DIR, "state.json");

function writeState(state: Record<string, unknown>) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)
  );
}

export async function POST() {
  writeState({
    status: "running",
    message: "Starting Praktika session refresh...",
  });

  const child = spawn("npm", ["run", "refresh:praktika-cookie"], {
    cwd: process.cwd(),
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  return NextResponse.json({
    ok: true,
    message: "Praktika session refresh started.",
  });
}