import { authorizePraktikaSession, PraktikaSessionAuthorizationError } from "@/lib/praktika/session-authorization";
import { derivePraktikaConnection, PRAKTIKA_AUTH_FRESHNESS_MS } from "@/lib/praktika/authentication";
import { NextResponse } from "next/server";

import {
  getPraktikaSession,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const mode = await authorizePraktikaSession(Object.fromEntries(requestUrl.searchParams));

    const session = await getPraktikaSession(mode);

    const hasCookie = Boolean(session.cookie);
    const { status, message, connected, helperAlive, authenticationVerified, experimentalEligible } = derivePraktikaConnection(session);

    return NextResponse.json(
      {
        connected,
        helperAlive,
        helperHeartbeatAt: session.helper_heartbeat_at ?? null,
        // Liveness and authentication proof are independently required.
        authenticatedAt: session.authenticated_at ?? null,
        authenticationExpiresAt: authenticationVerified && session.authenticated_at
          ? new Date(Date.parse(session.authenticated_at) + PRAKTIKA_AUTH_FRESHNESS_MS).toISOString() : null,
        authenticationVerified,
        experimentalEligible,
        experimentalEligibilityExpiresAt: experimentalEligible && session.experimental_auth_at
          ? new Date(Date.parse(session.experimental_auth_at) + PRAKTIKA_AUTH_FRESHNESS_MS).toISOString() : null,
        storedStatus: session.status,
        status,
        message,

        scope: session.scope,
        appUserId: session.app_user_id,

        hasCookie,
        currentUrl: session.current_url,
        praktikaUsername: session.praktika_username,

        refreshedAt: session.refreshed_at,
        lastUsedAt: session.last_used_at,
        updatedAt: session.updated_at,
        refreshRequestedAt: session.refresh_requested_at,
        mfaCodeUpdatedAt: session.mfa_code_updated_at,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error: unknown) {
    if (error instanceof PraktikaSessionAuthorizationError) {
      return NextResponse.json({ connected: false, status: "error", error: error.message, message: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error
        ? error.message
        : "Could not load Praktika session status.";

    console.error("Praktika session status error:", error);

    return NextResponse.json(
      {
        connected: false,
        helperAlive: false,
        helperHeartbeatAt: null,
        authenticatedAt: null,
        authenticationVerified: false,
        status: "error",
        message,

        scope: null,
        appUserId: null,

        hasCookie: false,
        currentUrl: null,
        praktikaUsername: null,

        refreshedAt: null,
        lastUsedAt: null,
        updatedAt: null,
        refreshRequestedAt: null,
        mfaCodeUpdatedAt: null,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }
}