import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

type OutboundAttachment = {
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  publicUrl: string;
};

function getAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.focusdentalspecialists.com.au"
  ).replace(/\/$/, "");
}

function isMmsFriendlyImage(attachment: OutboundAttachment) {
  const type = attachment.fileType || "";

  return (
    type === "image/jpeg" ||
    type === "image/jpg" ||
    type === "image/png" ||
    type === "image/gif"
  );
}

function isAppointmentConfirmationRequest(body: string) {
  const clean = body.toLowerCase();

  const mentionsAppointment =
    clean.includes("appointment") ||
    clean.includes("appt") ||
    clean.includes("booking");

  const asksToConfirm =
    clean.includes("confirm") ||
    clean.includes("confirmation") ||
    clean.includes("reply y") ||
    clean.includes("reply yes");

  return mentionsAppointment && asksToConfirm;
}

async function sendTwilioSms({
  to,
  body,
  mediaUrls = [],
}: {
  to: string;
  body: string;
  mediaUrls?: string[];
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

  for (const mediaUrl of mediaUrls) {
    params.append("MediaUrl", mediaUrl);
  }

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
    },
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

    const {
      conversationId,
      body,
      attachments = [],
    }: {
      conversationId: string;
      body?: string;
      attachments?: OutboundAttachment[];
    } = await request.json();

    const cleanBody = body?.trim() || "";

    if (!conversationId || (!cleanBody && attachments.length === 0)) {
      return NextResponse.json(
        { error: "Message body or attachment is required." },
        { status: 400 },
      );
    }

    const { data: conversation, error: conversationError } = await supabaseAdmin
      .from("reception_conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (conversationError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found." },
        { status: 404 },
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
        { status: 403 },
      );
    }

    const { data: linkedAppointment } = conversation.praktika_appointment_id
      ? await supabaseAdmin
          .from("praktika_appointments")
          .select("*")
          .eq("praktika_appointment_id", conversation.praktika_appointment_id)
          .maybeSingle()
      : { data: null };

    const staff = await getStaffDisplayInfo(user.id);

    const imageAttachments = attachments.filter(isMmsFriendlyImage);
    const linkAttachments = attachments.filter(
      (attachment) => !isMmsFriendlyImage(attachment),
    );

    const mediaUrls = imageAttachments
      .map((attachment) => attachment.publicUrl)
      .filter(Boolean);

    const firstMessageBody = cleanBody || "Attachment";

    const isConfirmationRequest =
      Boolean(conversation.praktika_appointment_id) &&
      isAppointmentConfirmationRequest(firstMessageBody);

    const patientName = [
      conversation.patient_first_name,
      conversation.patient_last_name,
    ]
      .filter(Boolean)
      .join(" ");

    const appointmentLabel = linkedAppointment
      ? `${linkedAppointment.appointment_day || ""} ${
          linkedAppointment.appointment_date || ""
        } at ${linkedAppointment.appointment_time || ""}`.trim()
      : null;

    const twilio = await sendTwilioSms({
      to: conversation.patient_mobile,
      body: firstMessageBody,
      mediaUrls,
    });

    const { data: message, error } = await supabaseAdmin
      .from("reception_messages")
      .insert({
        conversation_id: conversationId,
        direction: "outbound",
        body: firstMessageBody,
        twilio_message_sid: twilio.sid,
        twilio_status: twilio.status,
        sent_by_user_id: user.id,
        sent_by_display_name: staff.displayName,
        staff_display_name: staff.displayName,
        staff_initials: staff.initials,
        message_source: "manual",
        confirmation_intent: isConfirmationRequest
          ? "appointment_confirmation_request"
          : null,
        praktika_appointment_id: isConfirmationRequest
          ? conversation.praktika_appointment_id
          : null,
        confirmation_code: null,
        confirmation_patient_name: isConfirmationRequest ? patientName : null,
        confirmation_appointment_label: isConfirmationRequest
          ? appointmentLabel
          : null,
      })
      .select("*")
      .single();

    if (error || !message) {
      return NextResponse.json(
        { error: error?.message || "Could not save message." },
        { status: 500 },
      );
    }

    let savedAttachments: any[] = [];

    if (attachments.length > 0) {
      const { data: insertedAttachments, error: attachmentError } =
        await supabaseAdmin
          .from("reception_message_attachments")
          .insert(
            attachments.map((attachment) => ({
              message_id: message.id,
              conversation_id: conversationId,
              file_name: attachment.fileName,
              file_type: attachment.fileType,
              file_size: attachment.fileSize,
              storage_path: attachment.storagePath,
              public_url: attachment.publicUrl,
            })),
          )
          .select("*");

      if (attachmentError) {
        console.error("Could not save message attachments", attachmentError);
      }

      savedAttachments = insertedAttachments || [];
    }

    const brandedLinks = savedAttachments
      .filter((attachment) => {
        const original = linkAttachments.find(
          (item) => item.storagePath === attachment.storage_path,
        );

        return Boolean(original);
      })
      .map(
        (attachment) =>
          `${attachment.file_name}: ${getAppBaseUrl()}/reception/file/${
            attachment.id
          }`,
      );

    let finalMessageBody = firstMessageBody;

    if (brandedLinks.length > 0) {
      finalMessageBody = `${cleanBody || "Please view the attached file below."}

Attachments:
${brandedLinks.join("\n")}`;

      await sendTwilioSms({
        to: conversation.patient_mobile,
        body: finalMessageBody,
      });

      await supabaseAdmin
        .from("reception_messages")
        .update({
          body: finalMessageBody,
        })
        .eq("id", message.id);
    }

    await supabaseAdmin
      .from("reception_conversations")
      .update({
        status: "open",
        appointment_confirmation_status: isConfirmationRequest
          ? "confirmation_requested"
          : conversation.appointment_confirmation_status || null,
        last_message_preview: finalMessageBody.slice(0, 160),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      message_id: message.id,
      actor_user_id: user.id,
      actor_display_name: staff.displayName,
      action: isConfirmationRequest
        ? "appointment_confirmation_request_sent"
        : "message_sent",
      details: {
        twilio_sid: twilio.sid,
        twilio_status: twilio.status,
        body: finalMessageBody,
        praktika_appointment_id: isConfirmationRequest
          ? conversation.praktika_appointment_id
          : null,
        patient_name: patientName,
        appointment_label: appointmentLabel,
      },
    });

    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not send message.",
      },
      { status: 500 },
    );
  }
}
