import { ApiAuthorizationError, requireApiRole } from "@/lib/auth";
import { NextResponse } from "next/server";
import { autoFileInboxItemToPraktika } from "@/lib/ai/brain/praktikaAutoFile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireApiRole(["super_admin"]);
    const body = await request.json();

    const inboxItemId = String(body.inboxItemId || "").trim();
    const force = Boolean(body.force);

    if (!inboxItemId) {
      return NextResponse.json(
        { ok: false, error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const result = await autoFileInboxItemToPraktika({
      inboxItemId,
      force,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof ApiAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }


    return NextResponse.json(
      {
        ok: false,
        error: "Praktika inbox filing failed.",
      },
      { status: 500 }
    );
  }
}
