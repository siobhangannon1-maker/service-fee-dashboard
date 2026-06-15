import { NextResponse } from "next/server";
import {
  getCurrentUserMedirefSessionMode,
  getMedirefSession,
  markMedirefRefreshRequested,
} from "@/lib/mediref/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_CONNECTION_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const scope = body?.scope || "practice";
    const force = Boolean(body?.force);

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : await getCurrentUserMedirefSessionMode();

    const session = await getMedirefSession(mode);

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
        message: error?.message || "Could not request MediRef refresh.",
        error: error?.message || "Could not request MediRef refresh.",
      },
      { status: 500 },
    );
  }
}