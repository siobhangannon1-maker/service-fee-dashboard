import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await req.json();
    const { inboxItemId, matchCandidateId } = body;

    if (!inboxItemId || !matchCandidateId) {
      return NextResponse.json(
        { error: "Missing inboxItemId or matchCandidateId." },
        { status: 400 }
      );
    }

    const { data: match, error: matchError } = await supabaseAdmin
      .from("ai_patient_match_candidates")
      .select("*")
      .eq("id", matchCandidateId)
      .eq("inbox_item_id", inboxItemId)
      .single();

    if (matchError || !match) {
      return NextResponse.json(
        { error: matchError?.message || "Match candidate not found." },
        { status: 404 }
      );
    }

    await supabaseAdmin
      .from("ai_patient_match_candidates")
      .update({ status: "rejected" })
      .eq("inbox_item_id", inboxItemId);

    const { error: confirmError } = await supabaseAdmin
      .from("ai_patient_match_candidates")
      .update({ status: "confirmed" })
      .eq("id", matchCandidateId);

    if (confirmError) {
      return NextResponse.json(
        { error: confirmError.message },
        { status: 500 }
      );
    }

    const { error: inboxError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        matched_patient_id: match.patient_id,
        patient_match_confidence: match.confidence,
        patient_match_confirmed_at: new Date().toISOString(),
        match_status: "confirmed",
      })
      .eq("id", inboxItemId);

    if (inboxError) {
      return NextResponse.json(
        { error: inboxError.message },
        { status: 500 }
      );
    }

    const { data: aiCase } = await supabaseAdmin
      .from("ai_cases")
      .select("id")
      .eq("inbox_item_id", inboxItemId)
      .maybeSingle();

    if (aiCase?.id) {
      await supabaseAdmin.from("ai_case_events").insert({
        case_id: aiCase.id,
        event_type: "patient_match_confirmed",
        event_summary: "Reception confirmed a patient match.",
        metadata: {
          patient_id: match.patient_id,
          confidence: match.confidence,
          matched_fields: match.matched_fields,
        },
      });
    }

    return NextResponse.json({
      success: true,
      patientId: match.patient_id,
      confidence: match.confidence,
    });
  } catch (error: any) {
    console.error("Confirm patient match error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to confirm patient match." },
      { status: 500 }
    );
  }
}