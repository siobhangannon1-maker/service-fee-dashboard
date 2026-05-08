import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { getTrelloBoardLists } from "@/lib/trello/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await requireRole(["super_admin"]);

    const lists = await getTrelloBoardLists();

    return NextResponse.json({
      success: true,
      lists,
    });
  } catch (error) {
    console.error("Trello lists route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch Trello lists.",
      },
      { status: 500 }
    );
  }
}
