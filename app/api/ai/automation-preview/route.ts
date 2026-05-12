import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { previewLearningRuleAutomationForInboxItem } from "@/lib/ai/automation/learningRuleAutomationPreview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();
    const inboxItemId = String(body.inboxItemId || "").trim();

    if (!inboxItemId) {
      return NextResponse.json(
        { ok: false, error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    const preview = await previewLearningRuleAutomationForInboxItem({
      inboxItemId,
    });

    return NextResponse.json({
      ok: true,
      preview,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Automation preview failed.",
      },
      { status: 500 },
    );
  }
}
