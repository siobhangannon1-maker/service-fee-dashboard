import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { matchPraktikaPatientForInboxItem } from "@/lib/ai/brain/praktikaPatientMatch";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await request.json();
    const inboxItemId = body.inboxItemId as string | undefined;

    if (!inboxItemId) {
      return NextResponse.json(
        { success: false, error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    const result = await withPraktikaAutoRefresh(
      () =>
        matchPraktikaPatientForInboxItem({
          inboxItemId,
        }),
      {
        mode,
      },
    );

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Praktika match patient error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to match Praktika patient.",
      },
      { status: 500 },
    );
  }
}
