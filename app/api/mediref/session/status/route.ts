import { NextResponse } from "next/server";
import {
  getCurrentUserMedirefSessionMode,
  getMedirefSession,
  updateMedirefSession,
} from "@/lib/mediref/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "practice";

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : await getCurrentUserMedirefSessionMode();

    const session = await getMedirefSession(mode);

    const hasCookie = Boolean(session.cookie);

    let status = session.status;
    let message = session.message;
    let currentUrl = session.current_url;

    if (status === "refreshing" && hasCookie) {
      status = "connected";
      message = "MediRef cloud helper is connected. Helper jobs can be attempted.";
      currentUrl = null;

      await updateMedirefSession(mode, {
        status: "connected",
        message,
        current_url: null,
        last_used_at: new Date().toISOString(),
        refresh_requested_at: null,
      });
    }

    return NextResponse.json(
      {
        scope: session.scope,
        status,
        message,
        currentUrl,
        medirefEmail: session.mediref_email,
        email: session.mediref_email,
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
        message: error?.message || "Could not load MediRef session status.",
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