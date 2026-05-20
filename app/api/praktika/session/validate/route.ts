import { NextResponse } from "next/server";

import {
  getCurrentUserPraktikaSessionMode,
  markPraktikaRefreshRequested,
} from "@/lib/praktika/hybrid-session-store";
import { validatePraktikaSession } from "@/lib/praktika/validate-praktika-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const scope = body?.scope || "practice";
    const requestRefresh = Boolean(body?.requestRefresh);

    const mode =
      scope === "user"
        ? await getCurrentUserPraktikaSessionMode()
        : { scope: "practice" as const };

    const result = await validatePraktikaSession(mode);

    if (!result.connected && requestRefresh) {
      await markPraktikaRefreshRequested(mode);
    }

    return NextResponse.json({
      ok: true,
      scope: mode.scope,
      ...result,
      refreshRequested: !result.connected && requestRefresh,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        status: "error",
        message: error?.message || "Could not validate Praktika session.",
      },
      { status: 500 },
    );
  }
}