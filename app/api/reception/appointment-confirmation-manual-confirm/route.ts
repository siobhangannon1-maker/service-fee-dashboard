import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";
import { writePraktikaConfirmationBack } from "@/lib/reception/praktika-writeback";

async function createWritebackQueueItem({
  conversationId,
  appointmentId,
  praktikaPatientId,
  error,
  note,
}: {
  conversationId: string;
  appointmentId: string;
  praktikaPatientId?: string | null;
  error?: string | null;
  note: string;
}) {
  const { data: existing } = await supabaseAdmin
    .from("reception_praktika_writeback_queue")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("praktika_appointment_id", appointmentId)
    .eq("writeback_type", "appointment_confirmation")
    .in("status", ["pending", "failed", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("reception_praktika_writeback_queue")
      .update({
        status: "pending",
        last_error: error || existing.last_error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return existing;
  }

  const { data } = await supabaseAdmin
    .from("reception_praktika_writeback_queue")
    .insert({
      conversation_id: conversationId,
      praktika_patient_id: praktikaPatientId || null,
      praktika_appointment_id: appointmentId,
      writeback_type: "appointment_confirmation",
      payload: {
        note,
        source: "manual_ambiguous_confirmation_resolver",
      },
      status: "pending",
      attempts: 0,
      last_error: error || null,
    })
    .select("*")
    .single();

  return data;
}

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

  const { data: conversation } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();

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

  const note = "Confirmed YES via text message";
  const praktikaResult = await writePraktikaConfirmationBack({
    conversationId,
    appointmentId: praktikaAppointmentId,
    note,
  });

  let queueItem = null;

  if (praktikaResult.errors?.length > 0) {
    queueItem = await createWritebackQueueItem({
      conversationId,
      appointmentId: praktikaAppointmentId,
      praktikaPatientId: conversation?.praktika_patient_id || null,
      error: praktikaResult.errors.join("; "),
      note,
    });

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_writeback_queue_item_created",
      details: {
        queue_id: queueItem?.id || null,
        praktika_appointment_id: praktikaAppointmentId,
        source: "manual_ambiguous_confirmation_resolver",
        errors: praktikaResult.errors,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    confirmedAt,
    praktikaResult,
    queueItem,
  });
}
