import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  isStartMessage,
  isStopMessage,
  isYesConfirmation,
  normalizePhone,
} from "@/lib/reception/phone";
import { confirmPraktikaAppointment } from "@/lib/praktika/confirm-appointment";

function twiml(message = "") {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${
      message ? `<Message>${message}</Message>` : ""
    }</Response>`,
    {
      headers: {
        "Content-Type": "text/xml",
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const form = await request.formData();

  const from = normalizePhone(String(form.get("From") || ""));
  const body = String(form.get("Body") || "").trim();
  const messageSid = String(form.get("MessageSid") || "");

  if (!from) return twiml();

  if (isStopMessage(body)) {
    await supabaseAdmin.from("reception_sms_consent").upsert(
      {
        phone_number: from,
        status: "unsubscribed",
        source: "patient_sms",
        raw_message: body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number" }
    );
  }

  if (isStartMessage(body)) {
    await supabaseAdmin.from("reception_sms_consent").upsert(
      {
        phone_number: from,
        status: "subscribed",
        source: "patient_sms",
        raw_message: body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number" }
    );
  }

  const { data: conversation } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("patient_mobile", from)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = conversation?.id;

  if (!conversationId) {
    const { data: created } = await supabaseAdmin
      .from("reception_conversations")
      .insert({
        status: "open",
        patient_mobile: from,
        patient_first_name: "",
        patient_last_name: "",
        last_message_preview: body.slice(0, 160),
        last_message_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    conversationId = created?.id;
  }

  if (conversationId) {
    await supabaseAdmin.from("reception_messages").insert({
      conversation_id: conversationId,
      direction: "inbound",
      body,
      twilio_message_sid: messageSid,
      twilio_status: "received",
      message_source: "manual",
    });

    await supabaseAdmin
      .from("reception_conversations")
      .update({
        status: "open",
        last_message_preview: body.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "message_received",
      details: {
        from,
        body,
        twilio_message_sid: messageSid,
      },
    });
  }

  if (
    conversation?.praktika_appointment_id &&
    isYesConfirmation(body) &&
    !isStopMessage(body)
  ) {
    try {
      await confirmPraktikaAppointment({
        praktikaAppointmentId: conversation.praktika_appointment_id,
      });

      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: conversation.id,
        action: "appointment_auto_confirmed",
        details: {
          reply: body,
          praktika_appointment_id: conversation.praktika_appointment_id,
        },
      });
    } catch (error) {
      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: conversation.id,
        action: "appointment_auto_confirm_failed",
        details: {
          reply: body,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }

  return twiml();
}