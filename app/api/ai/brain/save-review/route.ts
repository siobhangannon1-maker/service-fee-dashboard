import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyFeedbackLearning } from "@/lib/ai/brain/learning/applyFeedbackLearning";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const { data: originalItem, error: originalError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (originalError || !originalItem) {
      return NextResponse.json(
        {
          error:
            originalError?.message ||
            "Could not load the original inbox item.",
        },
        { status: 404 }
      );
    }

    const { data: latestDraft } = await supabaseAdmin
      .from("ai_email_drafts")
      .select("id, subject, body")
      .eq("inbox_item_id", inboxItemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const originalSubject =
      latestDraft?.subject ?? originalItem.draft_reply_subject ?? null;

    const originalBody =
      latestDraft?.body ?? originalItem.draft_reply_body ?? null;

    const finalSubject =
      body.final_subject ??
      body.draft_reply_subject ??
      body.subject ??
      originalSubject ??
      null;

    const finalBody =
      body.final_body ??
      body.draft_reply_body ??
      body.body ??
      originalBody ??
      null;

    const updatePayload = {
      patient_name: body.patient_name ?? originalItem.patient_name ?? null,
      patient_dob: body.patient_dob ?? originalItem.patient_dob ?? null,
      category: body.category ?? originalItem.category ?? null,
      summary: body.summary ?? originalItem.summary ?? null,
      suggested_action:
        body.suggested_action ?? originalItem.suggested_action ?? null,
      reception_notes:
        body.reception_notes ?? originalItem.reception_notes ?? null,
      final_decision: body.final_decision ?? originalItem.final_decision ?? null,
      email_status: body.email_status || originalItem.email_status || "drafted",
      draft_reply_subject: finalSubject,
      draft_reply_body: finalBody,
      draft_status: finalBody ? "drafted" : originalItem.draft_status,
      reviewed_at: new Date().toISOString(),
    };

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update(updatePayload)
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (updateError) {
      console.error("Save review update error:", updateError);

      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    if (latestDraft?.id && (finalSubject || finalBody)) {
      const { error: draftUpdateError } = await supabaseAdmin
        .from("ai_email_drafts")
        .update({
          subject: finalSubject || latestDraft.subject || null,
          body: finalBody || latestDraft.body || "",
          status: "reviewed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", latestDraft.id);

      if (draftUpdateError) {
        console.warn(
          "Review saved, but latest draft update failed:",
          draftUpdateError.message
        );
      }
    }

    const learningResult = await applyFeedbackLearning({
      inboxItemId,
      originalSubject,
      originalBody,
      finalSubject,
      finalBody,
      category: updatedItem.category,
      notes: updatePayload.reception_notes,
    });

    const { error: auditError } = await supabaseAdmin
      .from("ai_workbench_audit_events")
      .insert({
        inbox_item_id: inboxItemId,
        event_type: "review_saved",
        event_label: "Review saved",
        details: {
          email_status: updatePayload.email_status,
          final_decision: updatePayload.final_decision,
          category: updatePayload.category,
          draft_subject_changed:
            String(originalSubject || "").trim() !==
            String(finalSubject || "").trim(),
          draft_body_changed:
            String(originalBody || "").trim() !==
            String(finalBody || "").trim(),
          learning_result: learningResult,
        },
      });

    if (auditError) {
      console.warn("Review saved, but audit event failed:", auditError.message);
    }

    return NextResponse.json({
      success: true,
      item: updatedItem,
      learning: learningResult,
    });
  } catch (error) {
    console.error("Save review route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to save review.",
      },
      { status: 500 }
    );
  }
}
