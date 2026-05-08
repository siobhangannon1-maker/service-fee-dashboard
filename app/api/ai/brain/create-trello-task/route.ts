import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { ensureTrelloTaskForInboxItem } from "@/lib/ai/brain/ensureTrelloTask";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;
    const reason =
      (body.reason as string | undefined) ||
      "Created manually from AI Reception Workbench.";
    const force = typeof body.force === "boolean" ? body.force : true;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const result = await ensureTrelloTaskForInboxItem({
      inboxItemId,
      reason,
      force,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Create Trello task route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create Trello task.",
      },
      { status: 500 }
    );
  }
}
