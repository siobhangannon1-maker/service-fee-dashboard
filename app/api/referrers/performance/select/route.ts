import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = String(body.inboxItemId || "").trim();
    const partyId = body.partyId ? Number(body.partyId) : null;

    if (!inboxItemId || !partyId) {
      return NextResponse.json(
        { ok: false, error: "Missing inboxItemId or partyId." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        praktika_referrer_match_status: "confirmed_manual",
        praktika_referrer_match_confidence: 1,
        praktika_referrer_party_id: partyId,
        praktika_referrer_provider_number: body.providerNumber || null,
        praktika_referrer_match_reason:
          body.displayName || "Referrer selected manually by staff.",
        praktika_referrer_matched_at: now,
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "praktika_referrer_selected",
      event_label: "Praktika referrer selected",
      details: {
        partyId,
        providerNumber: body.providerNumber || null,
        displayName: body.displayName || null,
        clinicName: body.clinicName || null,
        selected_at: now,
      },
    });

    return NextResponse.json(
      { ok: true, item: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to select referrer." },
      { status: 500 },
    );
  }
}