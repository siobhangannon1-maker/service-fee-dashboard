import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

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

    const { data: latestDraft, error: draftLookupError } = await supabaseAdmin
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
        { error: "No draft found for this inbox item. Generate a draft first." },
        { status: 404 }
      );
    }

    const { data: updatedDraft, error: updateError } = await supabaseAdmin
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
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (latestDraft.case_id) {
      await supabaseAdmin.from("ai_case_events").insert({
        case_id: latestDraft.case_id,
        event_type: "draft_edited",
        event_summary: "Receptionist edited and saved the AI email draft.",
        metadata: {
          draft_id: latestDraft.id,
          subject: finalSubject,
          status: status || "edited",
        },
      });
    }

    return NextResponse.json({
      success: true,
      draft: updatedDraft,
    });
  } catch (error: any) {
    console.error("Update draft error:", error);

    return NextResponse.json(
      { error: error.message || "Something went wrong updating the draft." },
      { status: 500 }
    );
  }
}