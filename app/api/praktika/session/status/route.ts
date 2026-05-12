import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const STATE_PATH = path.join(process.cwd(), ".praktika-session", "state.json");

export async function GET() {
  if (!fs.existsSync(STATE_PATH)) {
    return NextResponse.json({
      status: "idle",
      message: "No Praktika session refresh has been started.",
    });
  }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  return NextResponse.json(state);
}