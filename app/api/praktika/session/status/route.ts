import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  getCurrentUserPraktikaSessionMode,
  getPraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WORKER_HEARTBEAT_STALE_MS = 30_000;

function heartbeatIsFresh(lastHeartbeatAt: string | null | undefined) {
  if (!lastHeartbeatAt) return false;

  const heartbeatTime = new Date(lastHeartbeatAt).getTime();

  if (!Number.isFinite(heartbeatTime)) return false;

  return Date.now() - heartbeatTime <= WORKER_HEARTBEAT_STALE_MS;
}

function sessionIsConnected({
  status,
  hasCookie,
  currentUrl,
}: {
  status: string;
  hasCookie: boolean;
  currentUrl: string | null;
}) {
  const lowerUrl = String(currentUrl || "").toLowerCase();

  const isLoginOrLogoutUrl =
    lowerUrl.includes("/login") ||
    lowerUrl.includes("/v2/login") ||
    lowerUrl.includes("/logout");

  return status === "connected" && hasCookie && !isLoginOrLogoutUrl;
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

    const [session, workerResult] = await Promise.all([
      getPraktikaSession(mode),

      supabaseAdmin
        .from("automation_workers")
        .select(
          "id, name, type, status, is_paused, last_heartbeat_at, updated_at",
        )
        .eq("type", "praktika")
        .order("last_heartbeat_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (workerResult.error) {
      console.warn(
        "Could not load Praktika worker heartbeat:",
        workerResult.error.message,
      );
    }

    const worker = workerResult.data ?? null;

    const workerOnline =
      Boolean(worker) &&
      !worker?.is_paused &&
      heartbeatIsFresh(worker?.last_heartbeat_at);

    const hasCookie = Boolean(session.cookie);

    const browserSessionConnected = sessionIsConnected({
      status: session.status,
      hasCookie,
      currentUrl: session.current_url,
    });

    const connected = workerOnline && browserSessionConnected;

    let effectiveStatus = session.status;
    let effectiveMessage =
      session.message || "Praktika session status is unavailable.";

    if (!workerOnline) {
      effectiveStatus = "error";
      effectiveMessage =
        "The Praktika cloud worker is offline or has stopped sending heartbeats.";
    } else if (
      session.status === "connected" &&
      !browserSessionConnected
    ) {
      effectiveStatus = "expired";
      effectiveMessage =
        "The saved Praktika session cannot currently be confirmed as connected.";
    }

    return NextResponse.json(
      {
        connected,

        // This is the status the popup should display.
        status: effectiveStatus,
        message: effectiveMessage,

        // The raw database session status is included for debugging.
        sessionStatus: session.status,

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

        worker: {
          found: Boolean(worker),
          online: workerOnline,
          id: worker?.id ?? null,
          name: worker?.name ?? null,
          storedStatus: worker?.status ?? null,
          isPaused: worker?.is_paused ?? false,
          lastHeartbeatAt: worker?.last_heartbeat_at ?? null,
        },
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
        sessionStatus: "error",
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

        worker: {
          found: false,
          online: false,
          id: null,
          name: null,
          storedStatus: null,
          isPaused: false,
          lastHeartbeatAt: null,
        },
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