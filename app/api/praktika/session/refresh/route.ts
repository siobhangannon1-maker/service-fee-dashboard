import { authorizePraktikaSession, PraktikaSessionAuthorizationError } from "@/lib/praktika/session-authorization";
import { derivePraktikaConnection } from "@/lib/praktika/authentication";
import { NextResponse } from "next/server";

import {
  getPraktikaSession,
  markPraktikaRefreshRequested,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = Boolean(body?.force);

    const mode = await authorizePraktikaSession(body);

    const session = await getPraktikaSession(mode);

    const recentlyConnected = !force && derivePraktikaConnection(session).connected;

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
    if (error instanceof PraktikaSessionAuthorizationError) {
      return NextResponse.json({ connected: false, status: "error", error: error.message, message: error.message }, { status: error.status });
    }
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