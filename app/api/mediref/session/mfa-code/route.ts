import { authorizeMedirefSession } from "@/lib/mediref/session-authorization";
import { NextResponse } from "next/server";
import {
  saveMedirefMfaCode,
} from "@/lib/mediref/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const authorization = await authorizeMedirefSession();
    if (authorization.response) return authorization.response;
    const body = await request.json();
    const code = String(body?.code || "").replace(/\D/g, "").trim();
    const scope = body?.scope || "user";

    if (!code) {
      return NextResponse.json(
        { ok: false, message: "Missing MFA code." },
        { status: 400 },
      );
    }

    if (scope !== "practice" && scope !== "user") return NextResponse.json({ ok: false, error: "Invalid session scope." }, { status: 400 });

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : { scope: "user" as const, appUserId: authorization.actorUserId };

    await saveMedirefMfaCode({ mode, code });

    return NextResponse.json({
      ok: true,
      scope: mode.scope,
      message: "MFA code saved. Waiting for local helper machine.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: "Could not save MFA code.",
      },
      { status: 500 },
    );
  }
}
