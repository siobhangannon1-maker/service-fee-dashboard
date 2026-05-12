import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { classifyInboxItemV2 } from "@/lib/ai/brain/classificationV2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();
    const inboxItemId = body.inboxItemId as string | undefined;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    const result = await classifyInboxItemV2({
      inboxItemId,
      source: body.source || "manual_v2_classification",
      persist: true,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Classification V2 route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Classification V2 failed.",
      },
      { status: 500 },
    );
  }
}
