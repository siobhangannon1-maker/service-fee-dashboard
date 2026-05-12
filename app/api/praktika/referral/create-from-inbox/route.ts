import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { createPraktikaReferralFromInboxItem } from "@/lib/ai/brain/praktikaReferral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);
    const body = await request.json();
    const inboxItemId = String(body.inboxItemId || "").trim();
    if (!inboxItemId) {
      return NextResponse.json({ ok: false, error: "Missing inboxItemId." }, { status: 400 });
    }

    const result = await createPraktikaReferralFromInboxItem({
      inboxItemId,
      partyId: body.partyId ? String(body.partyId).trim() : null,
      referralDate: body.referralDate ? String(body.referralDate) : null,
      reason: body.reason ? String(body.reason) : null,
      notes: body.notes ? String(body.notes) : null,
    });

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create referral." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
