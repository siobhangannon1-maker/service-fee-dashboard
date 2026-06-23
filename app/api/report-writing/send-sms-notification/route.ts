import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function sendTwilioSms({
  to,
  body,
}: {
  to: string;
  body: string;
}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error("Twilio environment variables are missing.");
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

async function getProviderPhone(providerId: string) {
  const { data: provider, error: providerError } = await supabaseAdmin
    .from("providers")
    .select("id, name, user_id")
    .eq("id", providerId)
    .single();

  if (providerError || !provider) {
    throw new Error("Provider not found.");
  }

  if (!provider.user_id) {
    throw new Error(`${provider.name} is not linked to a user profile.`);
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("phone")
    .eq("id", provider.user_id)
    .single();

  if (profileError || !profile) {
    throw new Error("Provider profile not found.");
  }

  if (!profile.phone) {
    throw new Error(`${provider.name} does not have a mobile number saved.`);
  }

  return {
    phone: profile.phone,
    name: provider.name,
  };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    const body = await req.json();

    const message = String(body.message || "").trim();
    const providerId = String(body.providerId || "").trim();

    let recipientPhone = String(body.recipientPhone || "").trim();
    let recipientName = String(body.recipientName || "").trim();

    if (!message) {
      return NextResponse.json(
        { success: false, error: "Please type an SMS message." },
        { status: 400 }
      );
    }

    if (!recipientPhone && providerId) {
      const providerRecipient = await getProviderPhone(providerId);
      recipientPhone = providerRecipient.phone;
      recipientName = providerRecipient.name;
    }

    if (!recipientPhone) {
      return NextResponse.json(
        { success: false, error: "Missing recipient phone number." },
        { status: 400 }
      );
    }

    const twilio = await sendTwilioSms({
      to: recipientPhone,
      body: message,
    });

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: user.id,
      action: "report_writing_sms_sent",
      metadata: {
        source: body.source || "report_writing",
        recipientName: recipientName || null,
        recipientPhone,
        providerId: providerId || null,
        twilioSid: twilio.sid,
        twilioStatus: twilio.status,
        messagePreview: message.slice(0, 160),
      },
    });

    return NextResponse.json({
      success: true,
      sid: twilio.sid,
      status: twilio.status,
      recipientName: recipientName || null,
    });
  } catch (error) {
    console.error("Report writing SMS failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to send SMS.",
      },
      { status: 500 }
    );
  }
}