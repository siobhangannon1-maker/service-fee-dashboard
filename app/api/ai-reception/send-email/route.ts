import { NextResponse } from "next/server";
import { Resend } from "resend";

import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request) {
  try {
    await requireRole(["super_admin"]);

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: "Missing RESEND_API_KEY" },
        { status: 500 }
      );
    }

    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing item id" }, { status: 400 });
    }

    const { data: item, error: itemError } = await supabaseAdmin
      .from("ai_inbox_items")
      .select("*")
      .eq("id", id)
      .single();

    if (itemError || !item) {
      return NextResponse.json(
        { error: itemError?.message || "Inbox item not found" },
        { status: 404 }
      );
    }

    if (!item.sender_email) {
      return NextResponse.json(
        { error: "No recipient email found." },
        { status: 400 }
      );
    }

    const { data: latestDraft, error: draftError } = await supabaseAdmin
      .from("ai_email_drafts")
      .select("*")
      .eq("inbox_item_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (draftError) {
      return NextResponse.json({ error: draftError.message }, { status: 500 });
    }

    const subject =
      String(
        latestDraft?.subject ||
          item.draft_reply_subject ||
          "Reply from Focus Dental Specialists"
      ).trim() || "Reply from Focus Dental Specialists";

    const body = String(latestDraft?.body || item.draft_reply_body || "").trim();

    if (!body) {
      return NextResponse.json(
        { error: "No saved draft body found. Please save or generate a draft first." },
        { status: 400 }
      );
    }

    const sendResult = await resend.emails.send({
      from:
        process.env.RESEND_FROM_EMAIL ||
        "Focus Dental Specialists <ai-receptionist@focusdentalspecialists.com.au>",
      to: item.sender_email,
      subject,
      text: body,
    });

    if (sendResult.error) {
      return NextResponse.json(
        { error: sendResult.error.message },
        { status: 500 }
      );
    }

    const sentAt = new Date().toISOString();

    if (latestDraft?.id) {
      await supabaseAdmin
        .from("ai_email_drafts")
        .update({
          subject,
          body,
          status: "sent",
          updated_at: sentAt,
        })
        .eq("id", latestDraft.id);
    }

    await supabaseAdmin
      .from("ai_inbox_items")
      .update({
        draft_reply_subject: subject,
        draft_reply_body: body,
        draft_status: "sent",
        email_status: "sent_manually",
        sent_at: sentAt,
      })
      .eq("id", id);

    const caseId = latestDraft?.case_id;

    if (caseId) {
      await supabaseAdmin.from("ai_case_events").insert({
        case_id: caseId,
        event_type: "email_sent",
        event_summary:
          "Receptionist-approved AI email draft was sent manually.",
        metadata: {
          inbox_item_id: id,
          draft_id: latestDraft.id,
          resend_id: sendResult.data?.id || null,
          recipient: item.sender_email,
          subject,
        },
      });
    }

    return NextResponse.json({
      success: true,
      resend_id: sendResult.data?.id || null,
      draft_id: latestDraft?.id || null,
      subject,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send email" },
      { status: 500 }
    );
  }
}