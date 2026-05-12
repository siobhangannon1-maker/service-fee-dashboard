import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SESSION_DIR = path.join(process.cwd(), ".praktika-session");
const MFA_CODE_PATH = path.join(SESSION_DIR, "mfa-code.txt");

export async function POST(request: Request) {
  const body = await request.json();
  const code = String(body.code ?? "").replace(/\D/g, "").trim();

  if (!code || code.length < 4) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid MFA code." },
      { status: 400 }
    );
  }

  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.writeFileSync(MFA_CODE_PATH, code);

  return NextResponse.json({
    ok: true,
    message: "MFA code sent to Praktika refresh browser.",
  });
}