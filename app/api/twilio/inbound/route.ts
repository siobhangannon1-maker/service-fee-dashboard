import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function normalizePhone(value: string) {
  return value.replace(/\s+/g, "");
}

function twimlEmptyResponse() {
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: {
        "Content-Type": "text/xml",
      },
    }
  );
}

function isStopMessage(body: string) {
  const clean = body.trim().toUpperCase();

  return [
    "STOP",
    "STOPALL",
    "UNSUBSCRIBE",
    "CANCEL",
    "END",
    "QUIT",
    "OPT OUT",
    "OPTOUT",
  ].includes(clean);
}

function isHelpMessage(body: string) {
  return body.trim().toUpperCase() === "HELP";
}

function isYesConfirmation(body: string) {
  const clean = body.trim().toUpperCase();
  return /^(Y|YES|YEP|YEAH|CONFIRM|CONFIRMED|OK|OKAY|👍)$/.test(clean);
}

async function findPendingConfirmationRequests(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("reception_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("confirmation_intent", "appointment_confirmation_request")
    .eq("confirmation_response_detected", false)
    .not("praktika_appointment_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Could not search pending confirmation requests", error);
    return [];
  }

  return data || [];
}

async function markConfirmationAsConfirmed({
  conversationId,
  inboundMessageId,
  pendingRequest,
}: {
  conversationId: string;
  inboundMessageId: string;
  pendingRequest: any;
}) {
  const confirmedAt = new Date().toISOString();
  const appointmentId = String(pendingRequest.praktika_appointment_id);

  const { error: messageUpdateError } = await supabaseAdmin
    .from("reception_messages")
    .update({
      confirmation_response_detected: true,
      confirmation_response_message_id: inboundMessageId,
      confirmation_response_at: confirmedAt,
    })
    .eq("id", pendingRequest.id);

  if (messageUpdateError) {
    console.error("Could not mark confirmation request as responded", {
      error: messageUpdateError,
      pendingRequestId: pendingRequest.id,
    });
  }

  const { data: updatedConversation, error: conversationUpdateError } =
    await supabaseAdmin
      .from("reception_conversations")
      .update({
        praktika_appointment_id: appointmentId,
        appointment_confirmation_status: "confirmed",
        appointment_confirmed_at: confirmedAt,
        updated_at: confirmedAt,
      })
      .eq("id", conversationId)
      .select("id, appointment_confirmation_status, appointment_confirmed_at, praktika_appointment_id")
      .single();

  if (conversationUpdateError || !updatedConversation) {
    console.error("Could not update conversation confirmation status", {
      error: conversationUpdateError,
      conversationId,
      appointmentId,
    });
  } else {
    console.log("Conversation marked confirmed", updatedConversation);
  }

  return confirmedAt;
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Twilio inbound webhook is live. SMS replies must POST here.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const from = normalizePhone(String(formData.get("From") || ""));
    const body = String(formData.get("Body") || "").trim();
    const messageSid = String(formData.get("MessageSid") || "");
    const numMedia = Number(formData.get("NumMedia") || 0);

    console.log("Inbound SMS", {
      from,
      body,
      messageSid,
      numMedia,
    });

    if (!from || (!body && numMedia === 0)) {
      return twimlEmptyResponse();
    }

    let { data: conversation } = await supabaseAdmin
      .from("reception_conversations")
      .select("*")
      .eq("patient_mobile", from)
      .eq("status", "open")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: createdConversation, error: createError } =
        await supabaseAdmin
          .from("reception_conversations")
          .insert({
            status: "open",
            workflow_status: "general",
            is_urgent: false,
            unread_count: 0,
            patient_first_name: null,
            patient_last_name: null,
            patient_mobile: from,
            praktika_patient_id: null,
            praktika_appointment_id: null,
            assigned_user_id: null,
            assigned_display_name: null,
            last_message_preview: body || "Message received",
            last_message_at: new Date().toISOString(),
          })
          .select("*")
          .single();

      if (createError || !createdConversation) {
        console.error("Could not create unknown inbound conversation", {
          error: createError,
          from,
          body,
        });

        return twimlEmptyResponse();
      }

      conversation = createdConversation;

      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: conversation.id,
        action: "conversation_created_from_unknown_inbound_sms",
        details: {
          from,
          body,
          twilio_message_sid: messageSid,
        },
      });
    }

    const messageBody = body || "Message received";

    const { data: message, error: messageError } = await supabaseAdmin
      .from("reception_messages")
      .insert({
        conversation_id: conversation.id,
        direction: "inbound",
        body: messageBody,
        twilio_message_sid: messageSid,
        twilio_status: "received",
        message_source: "manual",
      })
      .select("*")
      .single();

    if (messageError || !message) {
      console.error("Could not insert inbound SMS", {
        error: messageError,
        conversationId: conversation.id,
        from,
        body,
        messageSid,
      });

      return twimlEmptyResponse();
    }

    await supabaseAdmin
      .from("reception_conversations")
      .update({
        status: "open",
        last_message_preview: messageBody.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        unread_count: (conversation.unread_count || 0) + 1,
      })
      .eq("id", conversation.id);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversation.id,
      message_id: message.id,
      action: "message_received",
      details: {
        from,
        body,
        twilio_message_sid: messageSid,
        num_media: numMedia,
      },
    });

    if (isYesConfirmation(body)) {
      const pendingRequests = await findPendingConfirmationRequests(
        conversation.id
      );

      if (pendingRequests.length === 1) {
        const pendingRequest = pendingRequests[0];
        const confirmedAt = await markConfirmationAsConfirmed({
          conversationId: conversation.id,
          inboundMessageId: message.id,
          pendingRequest,
        });

        await supabaseAdmin.from("reception_audit_logs").insert({
          conversation_id: conversation.id,
          message_id: message.id,
          action: "appointment_confirmation_reply_detected",
          details: {
            from,
            body,
            confirmation_request_message_id: pendingRequest.id,
            confirmation_patient_name:
              pendingRequest.confirmation_patient_name,
            confirmation_appointment_label:
              pendingRequest.confirmation_appointment_label,
            praktika_appointment_id:
              pendingRequest.praktika_appointment_id,
            confirmed_at: confirmedAt,
            note: "Safe confirmation. One pending confirmation request existed.",
          },
        });
      } else if (pendingRequests.length > 1) {
        const { error: ambiguousError } = await supabaseAdmin
          .from("reception_conversations")
          .update({
            appointment_confirmation_status: "ambiguous",
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation.id);

        if (ambiguousError) {
          console.error("Could not mark conversation as ambiguous", {
            error: ambiguousError,
            conversationId: conversation.id,
          });
        }

        await supabaseAdmin.from("reception_audit_logs").insert({
          conversation_id: conversation.id,
          message_id: message.id,
          action: "ambiguous_confirmation_reply_received",
          details: {
            from,
            body,
            pending_confirmation_count: pendingRequests.length,
            pending_requests: pendingRequests.map((request) => ({
              message_id: request.id,
              praktika_appointment_id: request.praktika_appointment_id,
              confirmation_patient_name: request.confirmation_patient_name,
              confirmation_appointment_label:
                request.confirmation_appointment_label,
            })),
            note: "Multiple pending confirmation requests exist for this mobile number. Staff must manually choose the appointment.",
          },
        });
      } else {
        await supabaseAdmin.from("reception_audit_logs").insert({
          conversation_id: conversation.id,
          message_id: message.id,
          action: "yes_reply_received_without_pending_confirmation",
          details: {
            from,
            body,
            note: "YES was not treated as appointment confirmation because no pending confirmation request was found.",
          },
        });
      }
    }

    if (isStopMessage(body)) {
      await supabaseAdmin.from("reception_sms_consent").upsert(
        {
          phone_number: from,
          praktika_patient_id: conversation.praktika_patient_id,
          status: "unsubscribed",
          source: "patient_sms_reply",
          reason: `Patient replied: ${body}`,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "phone_number",
        }
      );

      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: conversation.id,
        message_id: message.id,
        action: "patient_unsubscribed",
        details: {
          from,
          body,
          source: "twilio_inbound_webhook",
        },
      });
    }

    if (isHelpMessage(body)) {
      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: conversation.id,
        message_id: message.id,
        action: "patient_requested_sms_help",
        details: {
          from,
          body,
        },
      });
    }

    return twimlEmptyResponse();
  } catch (error) {
    console.error("Twilio inbound webhook failed", error);
    return twimlEmptyResponse();
  }
}
