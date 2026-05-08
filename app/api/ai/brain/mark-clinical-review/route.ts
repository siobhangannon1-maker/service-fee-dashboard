import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireRole(["super_admin"]);

    const body = await request.json();

    const inboxItemId = body.inboxItemId as string | undefined;
    const reason =
      (body.reason as string | undefined) ||
      "Marked for clinical review from the Workbench.";

    if (!inboxItemId) {
      return NextResponse.json(
        { error: "Missing inboxItemId." },
        { status: 400 }
      );
    }

    const { data: item, error: itemError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", inboxItemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json(
        { error: itemError?.message || "Inbox item not found." },
        { status: 404 }
      );
    }

    const { data: aiCase } = await supabaseAdmin
      .from("ai_cases")
      .select("*")
      .eq("inbox_item_id", inboxItemId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let caseId = aiCase?.id || null;

    if (aiCase?.id) {
      const { error: caseUpdateError } = await supabaseAdmin
        .from("ai_cases")
        .update({
          status: "clinical_review",
          risk_level: aiCase.risk_level || "medium",
          recommended_next_step: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", aiCase.id);

      if (caseUpdateError) {
        return NextResponse.json(
          { error: caseUpdateError.message },
          { status: 500 }
        );
      }
    } else {
      const { data: newCase, error: caseInsertError } = await supabaseAdmin
        .from("ai_cases")
        .insert({
          inbox_item_id: inboxItemId,
          status: "clinical_review",
          title:
            item.patient_name ||
            item.file_name ||
            item.email_subject ||
            item.subject ||
            "Clinical review required",
          patient_name: item.patient_name || null,
          patient_dob: item.patient_dob || null,
          category: item.category || "unknown",
          confidence: item.confidence || null,
          risk_level: "medium",
          recommended_next_step: reason,
        })
        .select()
        .single();

      if (caseInsertError) {
        return NextResponse.json(
          { error: caseInsertError.message },
          { status: 500 }
        );
      }

      caseId = newCase.id;
    }

    const decisionPayload = {
      title:
        item.patient_name ||
        item.file_name ||
        item.email_subject ||
        item.subject ||
        "Clinical review required",
      category: item.category || "unknown",
      operational_intent: "clinical_review_required",
      confidence: item.confidence || null,
      patient_name: item.patient_name || null,
      patient_dob: item.patient_dob || null,
      risk_level: "medium",
      requires_clinical_review: true,
      safe_to_auto_draft: false,
      risks: ["Manually marked for clinical review by staff."],
      missing_information: [],
      recommended_next_step: reason,
      summary: item.summary || "This item has been marked for clinical review.",
      suggested_action: "Send this item to a clinician before replying.",
      explanation: reason,
      manually_marked: true,
    };

    if (caseId) {
      const { error: decisionError } = await supabaseAdmin
        .from("ai_decisions")
        .insert({
          case_id: caseId,
          decision_type: "manual_clinical_review",
          decision: decisionPayload,
          confidence: item.confidence || null,
          risks: decisionPayload.risks,
          explanation: reason,
        });

      if (decisionError) {
        return NextResponse.json(
          { error: decisionError.message },
          { status: 500 }
        );
      }

      await supabaseAdmin.from("ai_case_events").insert({
        case_id: caseId,
        event_type: "marked_for_clinical_review",
        event_summary: reason,
        metadata: {
          inbox_item_id: inboxItemId,
          manually_marked: true,
        },
      });
    }

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        suggested_action: "Send this item to a clinician before replying.",
        email_status: "clinical_review_required",
      })
      .eq("id", inboxItemId)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    await supabaseAdmin.from("ai_workbench_audit_events").insert({
      inbox_item_id: inboxItemId,
      case_id: caseId,
      actor_id: null,
      event_type: "marked_for_clinical_review",
      event_summary: reason,
      previous_values: {
        email_status: item.email_status || null,
        suggested_action: item.suggested_action || null,
      },
      new_values: {
        email_status: "clinical_review_required",
        suggested_action: "Send this item to a clinician before replying.",
      },
      metadata: {
        manually_marked: true,
      },
    });

    return NextResponse.json({
      success: true,
      item: updatedItem,
      case_id: caseId,
      message: "Item marked for clinical review.",
    });
  } catch (error) {
    console.error("Mark clinical review route error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to mark item for clinical review.",
      },
      { status: 500 }
    );
  }
}
