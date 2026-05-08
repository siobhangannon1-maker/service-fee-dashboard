import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { reanalyseInboxItem } from "@/lib/ai/brain/reanalyseInboxItem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;
    const regenerateDraft =
      typeof body.regenerateDraft === "boolean" ? body.regenerateDraft : true;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const result = await reanalyseInboxItem({
      inboxItemId,
      source: "manual_reanalyse",
      regenerateDraft,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Reanalyse item route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to reanalyse item.",
      },
      { status: 500 }
    );
  }
}
