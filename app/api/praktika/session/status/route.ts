import { NextResponse } from "next/server";

import {
  getCurrentUserPraktikaSessionMode,
  getPraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLoginOrLogoutUrl(currentUrl: string | null) {
  const url = String(currentUrl || "").toLowerCase();

  return (
    url.includes("/login") ||
    url.includes("/v2/login") ||
    url.includes("/logout")
  );
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const requestedScope = requestUrl.searchParams.get("scope");

    let mode: PraktikaSessionMode;

    if (requestedScope === "practice") {
      mode = { scope: "practice" };
    } else {
      mode = await getCurrentUserPraktikaSessionMode();
    }

    const session = await getPraktikaSession(mode);

    const hasCookie = Boolean(session.cookie);
    const invalidCurrentUrl = isLoginOrLogoutUrl(session.current_url);

    const connected =
      session.status === "connected" &&
      hasCookie &&
      !invalidCurrentUrl;

    let status = session.status;
    let message =
      session.message || "Praktika session status is unavailable.";

    /*
     * Protect against inconsistent saved states without changing the database.
     */
    if (session.status === "connected" && !hasCookie) {
      status = "not_started";
      message = "No saved Praktika browser session was found.";
    }

    if (session.status === "connected" && invalidCurrentUrl) {
      status = "expired";
      message =
        "The Praktika helper is currently on a login or logout page.";
    }

    return NextResponse.json(
      {
        connected,
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
    const message =
      error instanceof Error
        ? error.message
        : "Could not load Praktika session status.";

    console.error("Praktika session status error:", error);

    return NextResponse.json(
      {
        connected: false,
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