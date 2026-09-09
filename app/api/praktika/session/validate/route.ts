import { authorizePraktikaSession, PraktikaSessionAuthorizationError } from "@/lib/praktika/session-authorization";
import { NextResponse } from "next/server";

import {
  markPraktikaRefreshRequested,
} from "@/lib/praktika/hybrid-session-store";
import { validatePraktikaSession } from "@/lib/praktika/validate-praktika-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestRefresh = Boolean(body?.requestRefresh);

    const mode = await authorizePraktikaSession(body);

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
    if (error instanceof PraktikaSessionAuthorizationError) {
      return NextResponse.json({ connected: false, status: "error", error: error.message, message: error.message }, { status: error.status });
    }
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