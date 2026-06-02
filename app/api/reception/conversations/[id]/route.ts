import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

function formatMessageLine(message: any) {
  const direction = message.direction === "outbound" ? "Staff" : "Patient";
  const time = message.created_at
    ? new Date(message.created_at).toLocaleString("en-AU")
    : "";

  return `[${time}] ${direction}: ${message.body || ""}`;
}

function formatAuditLine(audit: any) {
  const time = audit.created_at
    ? new Date(audit.created_at).toLocaleString("en-AU")
    : "";

  return `[${time}] Event: ${String(audit.action || "").replaceAll("_", " ")}`;
}

async function createConversationClinicalNoteExport({
  conversationId,
  closedAt,
  closedBy,
}: {
  conversationId: string;
  closedAt: string;
  closedBy: string;
}) {
  const { data: conversation } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("id", conversationId)
    .single();

  if (!conversation) return null;

  const { data: messages } = await supabaseAdmin
    .from("reception_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const { data: audits } = await supabaseAdmin
    .from("reception_audit_logs")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const openedAudit = (audits || [])
    .filter((audit) => audit.action === "conversation_opened")
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];

  const startAt = openedAudit?.created_at || conversation.created_at;

  const relevantMessages = (messages || []).filter(
    (message) =>
      !startAt || new Date(message.created_at).getTime() >= new Date(startAt).getTime()
  );

  const relevantAudits = (audits || []).filter(
    (audit) =>
      !startAt || new Date(audit.created_at).getTime() >= new Date(startAt).getTime()
  );

  const patientName = [conversation.patient_first_name, conversation.patient_last_name]
    .filter(Boolean)
    .join(" ");

  const noteBody = [
    "Reception SMS conversation summary",
    "",
    `Patient: ${patientName || "Unknown patient"}`,
    `Mobile: ${conversation.patient_mobile || "Unknown"}`,
    `Conversation opened: ${
      startAt ? new Date(startAt).toLocaleString("en-AU") : "Unknown"
    }`,
    `Conversation closed: ${new Date(closedAt).toLocaleString("en-AU")}`,
    `Closed by: ${closedBy || "Unknown staff member"}`,
    "",
    "Messages:",
    relevantMessages.length > 0
      ? relevantMessages.map(formatMessageLine).join("\n")
      : "No messages in this conversation period.",
    "",
    "Events:",
    relevantAudits.length > 0
      ? relevantAudits.map(formatAuditLine).join("\n")
      : "No events in this conversation period.",
  ].join("\n");

  const { data: exportRow, error } = await supabaseAdmin
    .from("reception_praktika_general_note_exports")
    .insert({
      conversation_id: conversationId,
      praktika_patient_id: conversation.praktika_patient_id,
      praktika_appointment_id: conversation.praktika_appointment_id,
      note_title: "Reception SMS conversation summary",
      note_body: noteBody,
      status: conversation.praktika_patient_id ? "pending" : "no_praktika_patient",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    console.error("Could not create Praktika general note export", {
      error,
      conversationId,
    });

    return null;
  }

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: conversationId,
    action: "general_clinical_note_export_created",
    details: {
      export_id: exportRow.id,
      status: exportRow.status,
      note_title: exportRow.note_title,
      note_preview: noteBody.slice(0, 500),
      note: "Created when the conversation was closed. Praktika write-back can be connected after the create-note endpoint is confirmed.",
    },
  });

  return exportRow;
}

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

  const now = new Date().toISOString();

  const updatePayload: any = {
    updated_at: now,
  };

  let action = "conversation_updated";

  if (body.status === "open" || body.status === "closed") {
    updatePayload.status = body.status;

    if (body.status === "closed") {
      updatePayload.closed_by_user_id = user.id;
      updatePayload.closed_at = now;
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
    action = body.isUrgent
      ? "conversation_marked_urgent"
      : "conversation_unmarked_urgent";
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

  if (
    existingConversation.status !== "closed" &&
    body.status === "closed"
  ) {
    await createConversationClinicalNoteExport({
      conversationId: id,
      closedAt: now,
      closedBy: staff.displayName,
    });
  }

  return NextResponse.json({ conversation });
}
