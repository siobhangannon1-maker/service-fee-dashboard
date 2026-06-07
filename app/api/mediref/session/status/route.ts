import { NextResponse } from "next/server";
import {
  getCurrentUserMedirefSessionMode,
  getMedirefSession,
} from "@/lib/mediref/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "user";

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : await getCurrentUserMedirefSessionMode();

    const session = await getMedirefSession(mode);

    return NextResponse.json(
      {
        scope: session.scope,
        status: session.status,
        message: session.message,
        currentUrl: session.current_url,
        medirefEmail: session.mediref_email,
        email: session.mediref_email,
        connected: session.status === "connected",
        updatedAt: session.updated_at,
        refreshRequestedAt: session.refresh_requested_at,
        refreshedAt: session.refreshed_at,
        lastUsedAt: session.last_used_at,
        mfaCodeUpdatedAt: session.mfa_code_updated_at,
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
      },
      { status: 200 },
    );
  }
}
