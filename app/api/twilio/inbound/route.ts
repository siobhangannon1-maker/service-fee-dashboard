import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function normalizePhone(value: string) {
  return value.replace(/\s+/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const from = normalizePhone(
      String(formData.get("From") || "")
    );

    const body = String(
      formData.get("Body") || ""
    ).trim();

    const messageSid = String(
      formData.get("MessageSid") || ""
    );

    console.log("Inbound SMS", {
      from,
      body,
      messageSid,
    });

    const { data: conversation } = await supabaseAdmin
      .from("reception_conversations")
      .select("*")
      .eq("patient_mobile", from)
      .maybeSingle();

    if (!conversation) {
      console.log(
        "No conversation found for",
        from
      );

      return new Response(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>",
        {
          status: 200,
          headers: {
            "Content-Type": "text/xml",
          },
        }
      );
    }

 const { data: message, error: messageError } = await supabaseAdmin
  .from("reception_messages")
  .insert({
    conversation_id: conversation.id,
    direction: "inbound",
    body,
    twilio_message_sid: messageSid,
    twilio_status: "received",
    message_source: "sms",
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

  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    }
  );
}

    await supabaseAdmin
      .from("reception_conversations")
      .update({
        status: "open",
        last_message_preview: body.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    await supabaseAdmin
      .from("reception_audit_logs")
      .insert({
        conversation_id: conversation.id,
        message_id: message.id,
        action: "message_received",
        details: {
          from,
          body,
        },
      });

    return new Response(
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>",
      {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
        },
      }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>",
      {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
        },
      }
    );
  }
}