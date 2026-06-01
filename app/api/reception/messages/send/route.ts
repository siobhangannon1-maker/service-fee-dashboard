import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

async function sendTwilioSms(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error(
      "Twilio environment variables are missing. Please check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID in .env.local, then restart your dev server."
    );
  }

  const params = new URLSearchParams();
  params.append("To", to);
  params.append("MessagingServiceSid", messagingServiceSid);
  params.append("Body", body);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Twilio send failed.");
  }

  return result;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversationId, body } = await request.json();

    if (!conversationId || !body?.trim()) {
      return NextResponse.json(
        { error: "Conversation and message body are required." },
        { status: 400 }
      );
    }

    const { data: conversation, error: conversationError } =
      await supabaseAdmin
        .from("reception_conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

    if (conversationError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 }
      );
    }

    const { data: consent } = await supabaseAdmin
      .from("reception_sms_consent")
      .select("*")
      .eq("phone_number", conversation.patient_mobile)
      .maybeSingle();

    if (consent?.status === "unsubscribed") {
      return NextResponse.json(
        { error: "This patient has unsubscribed from SMS." },
        { status: 403 }
      );
    }

    const staff = await getStaffDisplayInfo(user.id);

    const cleanBody = body.trim();

    const twilio = await sendTwilioSms(conversation.patient_mobile, cleanBody);

    const { data: message, error } = await supabaseAdmin
      .from("reception_messages")
      .insert({
        conversation_id: conversationId,
        direction: "outbound",
        body: cleanBody,
        twilio_message_sid: twilio.sid,
        twilio_status: twilio.status,
        sent_by_user_id: user.id,
        sent_by_display_name: staff.displayName,
        staff_display_name: staff.displayName,
        staff_initials: staff.initials,
        message_source: "manual",
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin
      .from("reception_conversations")
      .update({
        status: "open",
        last_message_preview: cleanBody.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      message_id: message.id,
      actor_user_id: user.id,
      actor_display_name: staff.displayName,
      action: "message_sent",
      details: {
  twilio_sid: twilio.sid,
  twilio_status: twilio.status,
  body: cleanBody,
},
    });

    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not send message.",
      },
      { status: 500 }
    );
  }
}