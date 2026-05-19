import { NextResponse } from "next/server";
import { getPraktikaSession } from "@/lib/praktika/session-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getPraktikaSession();

    return NextResponse.json({
      status: session.status,
      message: session.message,
      currentUrl: session.current_url,
      updatedAt: session.updated_at,
      refreshRequestedAt: session.refresh_requested_at,
      mfaCodeUpdatedAt: session.mfa_code_updated_at,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: "error",
        message: error?.message || "Could not load Praktika session status.",
        updatedAt: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}