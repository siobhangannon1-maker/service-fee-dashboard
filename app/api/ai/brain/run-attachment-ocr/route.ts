import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { runAttachmentOcr } from "@/lib/ai/brain/runAttachmentOcr";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;
    const storagePath = body.storagePath as string | undefined;
    const reanalyseAfterOcr =
      typeof body.reanalyseAfterOcr === "boolean"
        ? body.reanalyseAfterOcr
        : true;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    if (!storagePath) {
      return NextResponse.json(
        { error: "Missing storagePath." },
        { status: 400 }
      );
    }

    const result = await runAttachmentOcr({
      inboxItemId,
      storagePath,
      reanalyseAfterOcr,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Run attachment OCR route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to run attachment OCR.",
      },
      { status: 500 }
    );
  }
}
