import { NextResponse } from "next/server";
import {
  getCurrentUserPraktikaSessionMode,
  markPraktikaRefreshRequested,
} from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const scope = body?.scope || "practice";

    const mode =
      scope === "user"
        ? await getCurrentUserPraktikaSessionMode()
        : { scope: "practice" as const };

    await markPraktikaRefreshRequested(mode);

    return NextResponse.json({
      ok: true,
      scope: mode.scope,
      message:
        mode.scope === "practice"
          ? "Practice Praktika refresh requested."
          : "Your Praktika refresh was requested.",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        message: error?.message || "Could not request Praktika refresh.",
      },
      { status: 500 },
    );
  }
}