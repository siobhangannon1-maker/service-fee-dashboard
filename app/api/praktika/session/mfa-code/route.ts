import { authorizePraktikaSession, PraktikaSessionAuthorizationError } from "@/lib/praktika/session-authorization";
import { NextResponse } from "next/server";
import {
  savePraktikaMfaCode,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = await authorizePraktikaSession(body);
    const code = String(body?.code || "").replace(/\D/g, "").trim();

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "Missing MFA code." },
        { status: 400 },
      );
    }


    await savePraktikaMfaCode({ mode, code });

    return NextResponse.json({
      ok: true,
      scope: mode.scope,
      message: "MFA code saved. Waiting for local helper machine.",
    });
  } catch (error: any) {
    if (error instanceof PraktikaSessionAuthorizationError) {
      return NextResponse.json({ connected: false, status: "error", error: error.message, message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        ok: false,
        message: error?.message || "Could not save MFA code.",
      },
      { status: 500 },
    );
  }
}