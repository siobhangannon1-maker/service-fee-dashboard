import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { autoFileInboxItemToPraktika } from "@/lib/ai/brain/praktikaAutoFile";
import { withPraktikaAutoRefresh } from "@/lib/praktika/hybrid-seamless-request";
import { getCurrentUserPraktikaSessionMode } from "@/lib/praktika/hybrid-session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await request.json();

    const inboxItemId = String(body.inboxItemId || "").trim();
    const patientId = String(body.patientId || "").trim();
    const patientNumber = body.patientNumber
      ? String(body.patientNumber).trim()
      : null;
    const candidate = body.candidate || null;

    if (!inboxItemId || !patientId) {
      return NextResponse.json(
        { error: "Missing inboxItemId or patientId." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    const { data: confirmedItem, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        praktika_patient_id: patientId,
        praktika_patient_number: patientNumber,
        praktika_match_status: "confirmed_manual",
        praktika_match_confidence: 1,
        praktika_match_reason: "Confirmed manually by staff.",
        praktika_match_confirmed_at: now,
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "praktika_patient_match_confirmed",
      event_label: "Praktika patient match confirmed",
      details: {
        patientId,
        patientNumber,
        candidate,
        auto_file_requested: true,
      },
    });

    let filingResult: any = null;
    let filingError: string | null = null;

    try {
      filingResult = await withPraktikaAutoRefresh(
        () =>
          autoFileInboxItemToPraktika({
            inboxItemId,
            force: false,
          }),
        {
          mode,
        },
      );
    } catch (error: any) {
      filingError = error?.message || "Auto filing failed after match confirmation.";

      await supabaseAdmin.from("ai_workbench_audit_events").insert({
        inbox_item_id: inboxItemId,
        event_type: "praktika_auto_file_after_confirm_failed",
        event_label: "Auto file after patient confirmation failed",
        details: {
          error: filingError,
          patientId,
          patientNumber,
        },
      });
    }

    const { data: refreshedItem } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    return NextResponse.json({
      ok: true,
      item: refreshedItem || confirmedItem,
      filingResult,
      filingError,
      message: filingError
        ? "Patient match confirmed, but automatic filing failed."
        : "Patient match confirmed and attachments filed to Praktika.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to confirm Praktika match." },
      { status: 500 },
    );
  }
}
