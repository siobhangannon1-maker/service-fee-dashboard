import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const inboxItemId = String(body.inboxItemId || "").trim();
    const patient = body.patient || null;

    if (!inboxItemId) {
      return NextResponse.json(
        { ok: false, error: "Missing inboxItemId." },
        { status: 400 },
      );
    }

    if (!patient?.id) {
      return NextResponse.json(
        { ok: false, error: "Missing patient selection." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        praktika_patient_id: String(patient.id),
        praktika_patient_number: patient.patientNumber
          ? String(patient.patientNumber)
          : null,
        praktika_match_status: "confirmed_manual",
        praktika_match_confidence: Number(patient.matchScore || 0.8),
        praktika_match_reason: `Receptionist manually selected Praktika patient ${patient.id}.`,
        praktika_match_confirmed_at: new Date().toISOString(),
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      event_type: "bulk_document_patient_selected",
      event_label: "Receptionist selected Praktika patient for bulk document",
      details: {
        patient,
      },
    });

    return NextResponse.json({
      ok: true,
      item: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to select patient.",
      },
      { status: 500 },
    );
  }
}