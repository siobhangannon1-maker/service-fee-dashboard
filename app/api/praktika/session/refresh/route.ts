import { NextResponse } from "next/server";

import {
  getCurrentUserPraktikaSessionMode,
  getPraktikaSession,
  markPraktikaRefreshRequested,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_CONNECTION_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const scope = body?.scope || "user";
    const force = Boolean(body?.force);

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : await getCurrentUserPraktikaSessionMode();

    const session = await getPraktikaSession(mode);

    const lastActivity =
      session.last_used_at || session.refreshed_at || session.updated_at;

    const recentlyConnected =
      !force &&
      session.status === "connected" &&
      lastActivity &&
      Date.now() - new Date(lastActivity).getTime() <
        RECENT_CONNECTION_WINDOW_MS;

    if (recentlyConnected) {
      return NextResponse.json({
        ok: true,
        success: true,
        alreadyConnected: true,
        scope: mode.scope,
        message: "Praktika is already connected. No refresh required.",
      });
    }

    await markPraktikaRefreshRequested(mode);

    return NextResponse.json({
      ok: true,
      success: true,
      scope: mode.scope,
      forced: force,
      previousStatus: session.status,
      message: "Your Praktika refresh was requested.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        success: false,
        message: error?.message || "Could not request Praktika refresh.",
        error: error?.message || "Could not request Praktika refresh.",
      },
      { status: 500 },
    );
  }
}