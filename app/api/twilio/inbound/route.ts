import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writePraktikaConfirmationBack } from "@/lib/reception/praktika-writeback";

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

function isStartMessage(body: string) {
  const clean = body.trim().toUpperCase();
  return ["START", "UNSTOP"].includes(clean);
}

function isHelpMessage(body: string) {
  return body.trim().toUpperCase() === "HELP";
}

function isYesConfirmation(body: string) {
  const clean = body.trim().toUpperCase();
  return /^(Y|YES|YEP|YEAH|CONFIRM|CONFIRMED|OK|OKAY|👍)$/.test(clean);
}

async function audit({
  conversationId,
  messageId = null,
  action,
  details,
}: {
  conversationId: string;
  messageId?: string | null;
  action: string;
  details: any;
}) {
  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: conversationId,
    message_id: messageId,
    action,
    details,
  });
}

async function findPendingConfirmationRequests(conversationId: string) {
  const { data, error } = await supabaseAdmin
    .from("reception_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("confirmation_intent", "appointment_confirmation_request")
    .not("praktika_appointment_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Could not search pending confirmation requests", error);
    return {
      requests: [],
      error: error.message,
    };
  }

  // Important:
  // Resends can mark older confirmation request rows as responded/superseded.
  // We still need the latest appointment_confirmation_request for automatic
  // YES matching, so we do NOT filter confirmation_response_detected in SQL.
  // We prefer the newest unresponded request, but fall back to newest request.
  const allRequests = data || [];
  const unresponded = allRequests.filter(
    (request) => request.confirmation_response_detected !== true
  );

  return {
    requests: unresponded.length > 0 ? unresponded : allRequests.slice(0, 1),
    allRequests,
    error: null,
  };
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

  await supabaseAdmin
    .from("reception_messages")
    .update({
      confirmation_response_detected: true,
      confirmation_response_message_id: inboundMessageId,
      confirmation_response_at: confirmedAt,
    })
    .eq("id", pendingRequest.id);

  await supabaseAdmin
    .from("reception_conversations")
    .update({
      praktika_appointment_id: appointmentId,
      appointment_confirmation_status: "confirmed",
      appointment_confirmed_at: confirmedAt,
      updated_at: confirmedAt,
    })
    .eq("id", conversationId);

  await audit({
    conversationId,
    messageId: inboundMessageId,
    action: "appointment_confirmed",
    details: {
      praktika_appointment_id: appointmentId,
      confirmation_request_message_id: pendingRequest.id,
      source: "sms_confirmation_reply",
    },
  });

  await audit({
    conversationId,
    messageId: inboundMessageId,
    action: "praktika_confirmation_writeback_started",
    details: {
      praktika_appointment_id: appointmentId,
      confirmation_request_message_id: pendingRequest.id,
    },
  });

  const praktikaResult = await writePraktikaConfirmationBack({
    conversationId,
    appointmentId,
    note: "Confirmed YES via text message",
  });

  await audit({
    conversationId,
    messageId: inboundMessageId,
    action: "praktika_confirmation_writeback_finished",
    details: {
      praktika_appointment_id: appointmentId,
      result: praktikaResult,
    },
  });

  return {
    confirmedAt,
    praktikaResult,
  };
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

      await audit({
        conversationId: conversation.id,
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

    await audit({
      conversationId: conversation.id,
      messageId: message.id,
      action: "message_received",
      details: {
        from,
        body,
        twilio_message_sid: messageSid,
        num_media: numMedia,
      },
    });

    if (isYesConfirmation(body)) {
      await audit({
        conversationId: conversation.id,
        messageId: message.id,
        action: "yes_confirmation_reply_seen",
        details: {
          from,
          body,
          conversation_id: conversation.id,
          current_praktika_appointment_id: conversation.praktika_appointment_id,
        },
      });

      const pendingResult = await findPendingConfirmationRequests(conversation.id);
      const pendingRequests = pendingResult.requests;

      await audit({
        conversationId: conversation.id,
        messageId: message.id,
        action: "yes_confirmation_pending_requests_checked",
        details: {
          error: pendingResult.error,
          selected_pending_count: pendingRequests.length,
          all_request_count: pendingResult.allRequests?.length || 0,
          selected_requests: pendingRequests.map((request: any) => ({
            id: request.id,
            praktika_appointment_id: request.praktika_appointment_id,
            confirmation_response_detected:
              request.confirmation_response_detected,
            created_at: request.created_at,
          })),
          all_requests: (pendingResult.allRequests || []).map((request: any) => ({
            id: request.id,
            praktika_appointment_id: request.praktika_appointment_id,
            confirmation_response_detected:
              request.confirmation_response_detected,
            created_at: request.created_at,
          })),
        },
      });

      if (pendingRequests.length === 1) {
        const pendingRequest = pendingRequests[0];

        await audit({
          conversationId: conversation.id,
          messageId: message.id,
          action: "appointment_confirmation_reply_detected",
          details: {
            from,
            body,
            confirmation_request_message_id: pendingRequest.id,
            confirmation_patient_name:
              pendingRequest.confirmation_patient_name,
            confirmation_appointment_label:
              pendingRequest.confirmation_appointment_label,
            praktika_appointment_id: pendingRequest.praktika_appointment_id,
            note: "Safe confirmation. One pending confirmation request existed.",
          },
        });

        await markConfirmationAsConfirmed({
          conversationId: conversation.id,
          inboundMessageId: message.id,
          pendingRequest,
        });
      } else if (pendingRequests.length > 1) {
        await supabaseAdmin
          .from("reception_conversations")
          .update({
            appointment_confirmation_status: "ambiguous",
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation.id);

        await audit({
          conversationId: conversation.id,
          messageId: message.id,
          action: "ambiguous_confirmation_reply_received",
          details: {
            from,
            body,
            pending_confirmation_count: pendingRequests.length,
            pending_requests: pendingRequests.map((request: any) => ({
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
        await audit({
          conversationId: conversation.id,
          messageId: message.id,
          action: "yes_reply_received_without_pending_confirmation",
          details: {
            from,
            body,
            note: "YES was not treated as appointment confirmation because no pending confirmation request was found.",
          },
        });

        // Fallback safety:
        // If the conversation itself is linked to an appointment and currently
        // has confirmation_requested, allow YES to complete that appointment.
        if (
          conversation.praktika_appointment_id &&
          conversation.appointment_confirmation_status ===
            "confirmation_requested"
        ) {
          const fallbackRequest = {
            id: null,
            praktika_appointment_id: conversation.praktika_appointment_id,
          };

          await audit({
            conversationId: conversation.id,
            messageId: message.id,
            action: "yes_confirmation_fallback_to_linked_appointment",
            details: {
              praktika_appointment_id: conversation.praktika_appointment_id,
              reason:
                "No pending request row found, but conversation was linked and status was confirmation_requested.",
            },
          });

          await markConfirmationAsConfirmed({
            conversationId: conversation.id,
            inboundMessageId: message.id,
            pendingRequest: fallbackRequest,
          });
        }
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

      await audit({
        conversationId: conversation.id,
        messageId: message.id,
        action: "patient_unsubscribed",
        details: {
          from,
          body,
          source: "twilio_inbound_webhook",
        },
      });
    }

    if (isStartMessage(body)) {
      await supabaseAdmin.from("reception_sms_consent").upsert(
        {
          phone_number: from,
          praktika_patient_id: conversation.praktika_patient_id,
          status: "subscribed",
          source: "patient_sms_reply",
          reason: `Patient replied: ${body}`,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "phone_number",
        }
      );

      await audit({
        conversationId: conversation.id,
        messageId: message.id,
        action: "patient_resubscribed",
        details: {
          from,
          body,
          source: "twilio_inbound_webhook",
        },
      });
    }

    if (isHelpMessage(body)) {
      await audit({
        conversationId: conversation.id,
        messageId: message.id,
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
