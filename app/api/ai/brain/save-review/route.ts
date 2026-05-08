import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

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

    const updatePayload = {
      patient_name: body.patient_name || null,
      patient_dob: body.patient_dob || null,
      category: body.category || null,
      summary: body.summary || null,
      suggested_action: body.suggested_action || null,
      reception_notes: body.reception_notes || null,
      final_decision: body.final_decision || null,
      email_status: body.email_status || "drafted",
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
        },
      });

    if (auditError) {
      console.warn("Review saved, but audit event failed:", auditError.message);
    }

    return NextResponse.json({
      success: true,
      item: updatedItem,
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