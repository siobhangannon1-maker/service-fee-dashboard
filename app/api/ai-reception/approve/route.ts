import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    const item = await req.json();

    if (!item?.id) {
      return NextResponse.json(
        { error: "Missing inbox item ID." },
        { status: 400 }
      );
    }

    const { data: originalItem, error: originalError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", item.id)
      .single();

    if (originalError || !originalItem) {
      return NextResponse.json(
        { error: originalError?.message || "Original inbox item not found." },
        { status: 404 }
      );
    }

    const { data: aiCase, error: caseError } = await supabaseAdmin
      .from("ai_cases")
      .select("id")
      .eq("inbox_item_id", item.id)
      .maybeSingle();

    if (caseError) {
      return NextResponse.json({ error: caseError.message }, { status: 500 });
    }

    const { data: latestDraft, error: latestDraftError } = await supabaseAdmin
      .from("ai_email_drafts")
      .select("*")
      .eq("inbox_item_id", item.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestDraftError) {
      return NextResponse.json(
        { error: latestDraftError.message },
        { status: 500 }
      );
    }

    const finalSubject = String(
      item.draft_reply_subject ||
        latestDraft?.subject ||
        originalItem.draft_reply_subject ||
        ""
    ).trim();

    const finalBody = String(
      item.draft_reply_body ||
        latestDraft?.body ||
        originalItem.draft_reply_body ||
        ""
    ).trim();

    const originalSubject = String(
      latestDraft?.subject || originalItem.draft_reply_subject || ""
    ).trim();

    const originalBody = String(
      latestDraft?.body || originalItem.draft_reply_body || ""
    ).trim();

    const finalEmailStatus = item.email_status || "ready_to_send";
    const finalDraftStatus =
      finalEmailStatus === "no_reply_needed"
        ? "not_required"
        : item.draft_status || latestDraft?.status || "reviewed";

    if (latestDraft?.id && (finalSubject || finalBody)) {
      const { error: draftUpdateError } = await supabaseAdmin
        .from("ai_email_drafts")
        .update({
          subject: finalSubject,
          body: finalBody,
          status:
            finalEmailStatus === "sent_manually"
              ? "sent"
              : finalEmailStatus === "no_reply_needed"
              ? "not_required"
              : "reviewed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", latestDraft.id);

      if (draftUpdateError) {
        return NextResponse.json(
          { error: draftUpdateError.message },
          { status: 500 }
        );
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        status: "processed",
        category: item.category,
        patient_name: item.patient_name,
        patient_dob: item.patient_dob,
        summary: item.summary,
        suggested_action: item.suggested_action,
        reception_notes: item.reception_notes,
        final_decision: item.final_decision,
        draft_reply_subject: finalSubject || null,
        draft_reply_body: finalBody || null,
        draft_status: finalDraftStatus,
        email_status: finalEmailStatus,
      })
      .eq("id", item.id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    const draftWasEdited =
      originalSubject.trim() !== finalSubject.trim() ||
      originalBody.trim() !== finalBody.trim();

    const feedbackType =
      finalEmailStatus === "no_reply_needed"
        ? "no_reply_needed"
        : item.final_decision === "needs_clinical_review"
        ? "needs_clinical_review"
        : draftWasEdited
        ? "approved_with_edits"
        : "approved";

    const { error: feedbackError } = await supabaseAdmin
      .from("ai_feedback")
      .insert({
        draft_id: latestDraft?.id || null,
        inbox_item_id: item.id,
        case_id: aiCase?.id || latestDraft?.case_id || null,

        original_subject: originalSubject,
        original_body: originalBody,

        final_subject: finalSubject,
        final_body: finalBody,

        feedback_type: feedbackType,
        notes: item.reception_notes || null,
      });

    if (feedbackError) {
      return NextResponse.json(
        { error: feedbackError.message },
        { status: 500 }
      );
    }

    const caseId = aiCase?.id || latestDraft?.case_id || null;

    if (caseId) {
      await supabaseAdmin.from("ai_case_events").insert({
        case_id: caseId,
        event_type: "human_review_completed",
        event_summary:
          "Reception reviewed and processed this AI receptionist case.",
        metadata: {
          inbox_item_id: item.id,
          draft_id: latestDraft?.id || null,
          feedback_type: feedbackType,
          final_decision: item.final_decision,
          email_status: finalEmailStatus,
          draft_status: finalDraftStatus,
          draft_was_edited: draftWasEdited,
        },
      });
    }

    return NextResponse.json({
      success: true,
      feedback_type: feedbackType,
      draft_was_edited: draftWasEdited,
    });
  } catch (error: any) {
    console.error("Approve item error:", error);

    return NextResponse.json(
      { error: error.message || "Failed to approve item." },
      { status: 500 }
    );
  }
}