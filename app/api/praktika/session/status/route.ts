import { NextResponse } from "next/server";
import {
  getCurrentUserPraktikaSessionMode,
  getPraktikaSession,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "user";

    const mode =
      scope === "practice"
        ? { scope: "practice" as const }
        : await getCurrentUserPraktikaSessionMode();

    const session = await getPraktikaSession(mode);

    return NextResponse.json(
      {
        scope: session.scope,
        status: session.status,
        message: session.message,
        currentUrl: session.current_url,
        praktikaUsername: session.praktika_username,
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
        message: error?.message || "Could not load Praktika session status.",
        currentUrl: null,
        praktikaUsername: null,
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