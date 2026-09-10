import { authorizeMedirefSession } from "@/lib/mediref/session-authorization";
import { NextResponse } from "next/server";
import {
  getMedirefSession,
} from "@/lib/mediref/hybrid-session-store";

import { safeToolsStatus } from "@/lib/mediref/tools-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authorization = await authorizeMedirefSession();
    if (authorization.response) return authorization.response;
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "practice";

    if (scope !== "practice" && scope !== "user") return NextResponse.json({ ok: false, error: "Invalid session scope." }, { status: 400 });

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : { scope: "user" as const, appUserId: authorization.actorUserId };

    const session = await getMedirefSession(mode);

    const hasCookie = Boolean(session.cookie);

    const { status, message, validForMs, helperAlive } = safeToolsStatus(session, null).session;

    return NextResponse.json(
      {
        scope: session.scope,
        status,
        message,
        validForMs,
        helperAlive,

        connected: status === "connected",
        updatedAt: session.updated_at,
        refreshRequestedAt: status === "connected" ? null : session.refresh_requested_at,
        refreshedAt: session.refreshed_at,
        lastUsedAt: session.last_used_at,
        mfaCodeUpdatedAt: session.mfa_code_updated_at,
        hasCookie,
      },
      { status: 200 },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        scope: "unknown",
        status: "error",
        connected: false,
        validForMs: 0,
        helperAlive: false,
        message: "Could not load MediRef session status.",
        currentUrl: null,
        medirefEmail: null,
        email: null,
        updatedAt: new Date().toISOString(),
        refreshRequestedAt: null,
        refreshedAt: null,
        lastUsedAt: null,
        mfaCodeUpdatedAt: null,
        hasCookie: false,
      },
      { status: 200 },
    );
  }
}