import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const { user } = await requireRole(["super_admin"]);

    const body = await req.json();

    const {
      inboxItemId,
      subject,
      draft_reply_subject,
      body: draftBodyFromBody,
      draft_reply_body,
      status,
    } = body;

    const finalSubject = subject ?? draft_reply_subject ?? "";
    const finalBody = draftBodyFromBody ?? draft_reply_body ?? "";

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId" },
        { status: 400 }
      );
    }

    const { data: latestDraft, error: draftLookupError } =
      await supabaseAdmin
        .from("ai_email_drafts")
        .select("*")
        .eq("inbox_item_id", inboxItemId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (draftLookupError) {
      return NextResponse.json(
        { error: draftLookupError.message },
        { status: 500 }
      );
    }

    if (!latestDraft) {
      return NextResponse.json(
        {
          error:
            "No draft found for this inbox item. Generate a draft first.",
        },
        { status: 404 }
      );
    }

    const originalSubject = latestDraft.subject || "";
    const originalBody = latestDraft.body || "";

    const wasEdited =
      originalSubject.trim() !== finalSubject.trim() ||
      originalBody.trim() !== finalBody.trim();

    const { data: updatedDraft, error: updateError } =
      await supabaseAdmin
        .from("ai_email_drafts")
        .update({
          subject: finalSubject,
          body: finalBody,
          status: status || "edited",
          updated_at: new Date().toISOString(),
        })
        .eq("id", latestDraft.id)
        .select()
        .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    /*
      SAVE FEEDBACK MEMORY
    */

    if (wasEdited) {
      const feedbackType =
        status === "approved"
          ? "approved_with_edits"
          : "human_edit";

      await supabaseAdmin.from("ai_feedback").insert({
        draft_id: latestDraft.id,
        inbox_item_id: inboxItemId,
        case_id: latestDraft.case_id || null,

        original_subject: originalSubject,
        original_body: originalBody,

        final_subject: finalSubject,
        final_body: finalBody,

        feedback_type: feedbackType,

        notes:
          "Receptionist edited the AI-generated draft before approval or Outlook draft creation.",
      });
    }

    /*
      AUDIT EVENT
    */

    if (latestDraft.case_id) {
      await supabaseAdmin.from("ai_case_events").insert({
        case_id: latestDraft.case_id,
        event_type: "draft_edited",
        event_summary:
          wasEdited
            ? "Receptionist edited the AI draft and feedback memory was saved."
            : "Receptionist saved the AI draft without changes.",
        metadata: {
          draft_id: latestDraft.id,
          subject: finalSubject,
          status: status || "edited",
          feedback_saved: wasEdited,
        },
      });
    }

    return NextResponse.json({
      success: true,
      feedback_saved: wasEdited,
      draft: updatedDraft,
    });
  } catch (error: any) {
    console.error("Update draft error:", error);

    return NextResponse.json(
      {
        error:
          error.message ||
          "Something went wrong updating the draft.",
      },
      { status: 500 }
    );
  }
}