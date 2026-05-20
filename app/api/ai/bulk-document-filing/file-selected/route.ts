import { NextResponse } from "next/server";
import { autoFileInboxItemToPraktika } from "@/lib/ai/brain/praktikaAutoFile";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await request.json();
    const inboxItemIds = Array.isArray(body.inboxItemIds)
      ? body.inboxItemIds.map((id: any) => String(id).trim()).filter(Boolean)
      : [];

    if (inboxItemIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No documents selected for filing." },
        { status: 400 },
      );
    }

    const results: any[] = [];

    for (const inboxItemId of inboxItemIds) {
      try {
        const result = await withPraktikaAutoRefresh(
          () =>
            autoFileInboxItemToPraktika({
              inboxItemId,
              force: false,
            }),
          {
            mode,
          },
        );

        results.push({
          inboxItemId,
          ok: true,
          result,
        });
      } catch (error: any) {
        results.push({
          inboxItemId,
          ok: false,
          error: error?.message || "Filing failed.",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      completed: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    });
  } catch (error: any) {
    console.error("Bulk filing failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Bulk filing failed.",
      },
      { status: 500 },
    );
  }
}
