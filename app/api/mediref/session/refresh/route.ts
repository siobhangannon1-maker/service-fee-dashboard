import { authorizeMedirefSession } from "@/lib/mediref/session-authorization";
import { NextResponse } from "next/server";
import {
  getMedirefSession,
  markMedirefRefreshRequested,
} from "@/lib/mediref/hybrid-session-store";

import { hasRecentMedirefAuthentication } from "@/lib/mediref/tools-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const authorization = await authorizeMedirefSession();
    if (authorization.response) return authorization.response;
    const body = await request.json().catch(() => ({}));
    const scope = body?.scope || "practice";
    const force = Boolean(body?.force);

    if (scope !== "practice" && scope !== "user") return NextResponse.json({ ok: false, error: "Invalid session scope." }, { status: 400 });

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : { scope: "user" as const, appUserId: authorization.actorUserId };

    const session = await getMedirefSession(mode);

    const recentlyConnected = !force && hasRecentMedirefAuthentication(session);

    if (recentlyConnected) {
      return NextResponse.json({
        ok: true,
        success: true,
        alreadyConnected: true,
        scope: mode.scope,
        message: "MediRef is already connected. No refresh required.",
      });
    }

    await markMedirefRefreshRequested(mode);

    return NextResponse.json({
      ok: true,
      success: true,
      scope: mode.scope,
      forced: force,
      previousStatus: session.status,
      message: "Your MediRef refresh was requested.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        message: "Could not request MediRef refresh.",
        error: "Could not request MediRef refresh.",
      },
      { status: 500 },
    );
  }
}