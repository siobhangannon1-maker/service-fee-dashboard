import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { routeSpecialistForInboxItem } from "@/lib/ai/brain/specialistRouting";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;
    const persist = typeof body.persist === "boolean" ? body.persist : true;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const routing = await routeSpecialistForInboxItem({
      inboxItemId,
      persist,
    });

    return NextResponse.json({
      success: true,
      routing,
    });
  } catch (error) {
    console.error("Operational routing route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to route item.",
      },
      { status: 500 }
    );
  }
}
