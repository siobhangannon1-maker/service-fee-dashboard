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
    const scope = body?.scope || "user";

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : await getCurrentUserMedirefSessionMode();

    const session = await getMedirefSession(mode);

    const lastActivity =
      session.last_used_at || session.refreshed_at || session.updated_at;

    const recentlyConnected =
      session.status === "connected" &&
      lastActivity &&
      Date.now() - new Date(lastActivity).getTime() <
        RECENT_CONNECTION_WINDOW_MS;

    if (recentlyConnected) {
      return NextResponse.json({
        ok: true,
        alreadyConnected: true,
        scope: mode.scope,
        message: "MediRef is already connected. No refresh required.",
      });
    }

    if (
      session.status === "refreshing" ||
      session.status === "refresh_requested"
    ) {
      return NextResponse.json({
        ok: true,
        alreadyRefreshing: true,
        scope: mode.scope,
        message: "MediRef reconnect is already in progress.",
      });
    }

    await markMedirefRefreshRequested(mode);

    return NextResponse.json({
      ok: true,
      scope: mode.scope,
      message: "Your MediRef refresh was requested.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.message || "Could not request MediRef refresh.",
      },
      { status: 500 },
    );
  }
}
