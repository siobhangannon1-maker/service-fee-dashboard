import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staff = await getStaffDisplayInfo(user.id);
  const body = await request.json();

  const conversationId = body.conversationId ? String(body.conversationId) : "";
  const praktikaAppointmentId = body.praktikaAppointmentId
    ? String(body.praktikaAppointmentId)
    : "";
  const inboundMessageId = body.inboundMessageId
    ? String(body.inboundMessageId)
    : null;

  if (!conversationId || !praktikaAppointmentId) {
    return NextResponse.json(
      { error: "Conversation and appointment are required." },
      { status: 400 }
    );
  }

  const { data: pendingRequest } = await supabaseAdmin
    .from("reception_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("confirmation_intent", "appointment_confirmation_request")
    .eq("praktika_appointment_id", praktikaAppointmentId)
    .eq("confirmation_response_detected", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const confirmedAt = new Date().toISOString();

  if (pendingRequest) {
    await supabaseAdmin
      .from("reception_messages")
      .update({
        confirmation_response_detected: true,
        confirmation_response_message_id: inboundMessageId,
        confirmation_response_at: confirmedAt,
      })
      .eq("id", pendingRequest.id);
  }

  await supabaseAdmin
    .from("reception_conversations")
    .update({
      praktika_appointment_id: praktikaAppointmentId,
      appointment_confirmation_status: "confirmed",
      appointment_confirmed_at: confirmedAt,
      updated_at: confirmedAt,
    })
    .eq("id", conversationId);

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: conversationId,
    message_id: inboundMessageId,
    actor_user_id: user.id,
    actor_display_name: staff.displayName,
    action: "appointment_confirmation_manually_resolved",
    details: {
      praktika_appointment_id: praktikaAppointmentId,
      confirmation_request_message_id: pendingRequest?.id || null,
      note: "Staff manually resolved an ambiguous confirmation reply.",
    },
  });

  return NextResponse.json({
    ok: true,
    confirmedAt,
  });
}
