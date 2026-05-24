import { NextResponse } from "next/server";
import {
  getCurrentUserPraktikaSessionMode,
  savePraktikaMfaCode,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = String(body?.code || "").replace(/\D/g, "").trim();
    const scope = body?.scope || "user";

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "Missing MFA code." },
        { status: 400 },
      );
    }

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : await getCurrentUserPraktikaSessionMode();

    await savePraktikaMfaCode({ mode, code });

    return NextResponse.json({
      ok: true,
      scope: mode.scope,
      message: "MFA code saved. Waiting for local helper machine.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.message || "Could not save MFA code.",
      },
      { status: 500 },
    );
  }
}