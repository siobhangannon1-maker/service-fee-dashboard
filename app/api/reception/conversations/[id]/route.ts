import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data: conversation, error } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !conversation) {
    return NextResponse.json(
      { error: error?.message || "Conversation not found." },
      { status: 404 }
    );
  }

  const [
    { data: messages },
    { data: audits },
    { data: consent },
    { data: patient },
    { data: appointments },
    { data: attachments },
  ] = await Promise.all([
    supabaseAdmin
      .from("reception_messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),

    supabaseAdmin
      .from("reception_audit_logs")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),

    supabaseAdmin
      .from("reception_sms_consent")
      .select("*")
      .eq("phone_number", conversation.patient_mobile)
      .maybeSingle(),

    conversation.praktika_patient_id
      ? supabaseAdmin
          .from("praktika_patients")
          .select("*")
          .eq("praktika_patient_id", conversation.praktika_patient_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),

    conversation.praktika_patient_id
      ? supabaseAdmin
          .from("praktika_appointments")
          .select("*")
          .eq("praktika_patient_id", conversation.praktika_patient_id)
          .order("appointment_datetime", { ascending: true })
          .limit(20)
      : Promise.resolve({ data: [] }),

    supabaseAdmin
      .from("reception_message_attachments")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const attachmentsByMessageId = new Map<string, any[]>();

  for (const attachment of attachments || []) {
    if (!attachment.message_id) continue;

    const current = attachmentsByMessageId.get(attachment.message_id) || [];
    current.push(attachment);
    attachmentsByMessageId.set(attachment.message_id, current);
  }

  const messagesWithAttachments = (messages || []).map((message) => ({
    ...message,
    attachments: attachmentsByMessageId.get(message.id) || [],
  }));

  await supabaseAdmin
    .from("reception_conversations")
    .update({
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({
    conversation: {
      ...conversation,
      unread_count: 0,
    },
    messages: messagesWithAttachments,
    audits: audits || [],
    consent,
    patient,
    appointments: appointments || [],
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staff = await getStaffDisplayInfo(user.id);
  const body = await request.json();

  const { data: existingConversation } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!existingConversation) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 }
    );
  }

  const updatePayload: any = {
    updated_at: new Date().toISOString(),
  };

  let action = "conversation_updated";

  if (body.status === "open" || body.status === "closed") {
    updatePayload.status = body.status;

    if (body.status === "closed") {
      updatePayload.closed_by_user_id = user.id;
      updatePayload.closed_at = new Date().toISOString();
      updatePayload.close_summary = body.closeSummary || null;
      action = "conversation_closed";
    }

    if (body.status === "open") {
      updatePayload.closed_by_user_id = null;
      updatePayload.closed_at = null;
      updatePayload.close_summary = null;
      action = "conversation_opened";
    }
  }

  if (
    body.workflowStatus === "general" ||
    body.workflowStatus === "waiting_on_patient" ||
    body.workflowStatus === "waiting_on_practice" ||
    body.workflowStatus === "needs_follow_up"
  ) {
    updatePayload.workflow_status = body.workflowStatus;
    action = "workflow_status_updated";
  }

  if (typeof body.isUrgent === "boolean") {
    updatePayload.is_urgent = body.isUrgent;
    action = body.isUrgent ? "conversation_marked_urgent" : "conversation_unmarked_urgent";
  }

  if (body.praktikaAppointmentId !== undefined) {
    updatePayload.praktika_appointment_id = body.praktikaAppointmentId || null;

    if (!body.praktikaAppointmentId) {
      updatePayload.appointment_confirmation_status = null;
      updatePayload.appointment_confirmed_at = null;
    }

    action = "appointment_link_updated";
  }

  const { data: conversation, error } = await supabaseAdmin
    .from("reception_conversations")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("Could not update reception conversation", {
      error,
      id,
      updatePayload,
      body,
    });

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: id,
    actor_user_id: user.id,
    actor_display_name: staff.displayName,
    action,
    details: {
      previous_is_urgent: existingConversation.is_urgent,
      previous_workflow_status: existingConversation.workflow_status,
      previous_status: existingConversation.status,
      ...body,
    },
  });

  return NextResponse.json({ conversation });
}
