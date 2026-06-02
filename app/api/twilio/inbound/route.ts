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

  return ["Y", "YES", "CONFIRM", "CONFIRMED"].includes(clean);
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("pdf")) return "pdf";
  return "file";
}

async function downloadTwilioMedia(mediaUrl: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("Missing Twilio credentials for inbound media download.");
  }

  const response = await fetch(mediaUrl, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
    },
  });

  if (!response.ok) {
    throw new Error(`Could not download Twilio media: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

    console.log("Inbound SMS/MMS", {
      from,
      body,
      messageSid,
      numMedia,
    });

    if (!from || (!body && numMedia === 0)) {
      return twimlEmptyResponse();
    }

    let { data: conversation, error: conversationError } = await supabaseAdmin
      .from("reception_conversations")
      .select("*")
      .eq("patient_mobile", from)
      .eq("status", "open")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conversationError) {
      console.error("Could not find open conversation", {
        error: conversationError,
        from,
      });

      return twimlEmptyResponse();
    }

    if (!conversation) {
      const { data: createdConversation, error: createError } =
        await supabaseAdmin
          .from("reception_conversations")
          .insert({
            status: "open",
            patient_first_name: null,
            patient_last_name: null,
            patient_mobile: from,
            praktika_patient_id: null,
            praktika_appointment_id: null,
            assigned_user_id: null,
            assigned_display_name: null,
            last_message_preview: body || "Message received",
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          })
          .select("*")
          .single();

      if (createError || !createdConversation) {
        console.error("Could not create conversation for unknown inbound SMS", {
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

    const messageBody = body || (numMedia > 0 ? "Attachment received" : "");
    const stopRequested = isStopMessage(body);
    const helpRequested = isHelpMessage(body);
    const yesConfirmation = isYesConfirmation(body);

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

    const savedAttachments: any[] = [];

    for (let index = 0; index < numMedia; index++) {
      const mediaUrl = String(formData.get(`MediaUrl${index}`) || "");
      const mediaContentType = String(
        formData.get(`MediaContentType${index}`) || "application/octet-stream"
      );

      if (!mediaUrl) continue;

      try {
        const fileBuffer = await downloadTwilioMedia(mediaUrl);
        const extension = extensionFromContentType(mediaContentType);
        const fileName = `incoming-${messageSid}-${index}.${extension}`;
        const storagePath = `${conversation.id}/${Date.now()}-${fileName}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from("reception-message-attachments")
          .upload(storagePath, fileBuffer, {
            contentType: mediaContentType,
            upsert: false,
          });

        if (uploadError) {
          console.error("Could not upload inbound media to Supabase", {
            uploadError,
            mediaUrl,
            mediaContentType,
          });
          continue;
        }

        const { data: publicUrlData } = supabaseAdmin.storage
          .from("reception-message-attachments")
          .getPublicUrl(storagePath);

        const publicUrl = publicUrlData.publicUrl;

        const attachmentPayload = {
          message_id: message.id,
          conversation_id: conversation.id,
          file_name: fileName,
          file_type: mediaContentType,
          file_size: fileBuffer.length,
          storage_path: storagePath,
          public_url: publicUrl,
        };

        const { data: savedAttachment, error: attachmentError } =
          await supabaseAdmin
            .from("reception_message_attachments")
            .insert(attachmentPayload)
            .select("*")
            .single();

        if (attachmentError) {
          console.error("Could not save inbound attachment row", {
            attachmentError,
            attachmentPayload,
          });
          continue;
        }

        savedAttachments.push(savedAttachment);
      } catch (mediaError) {
        console.error("Inbound media processing failed", {
          mediaError,
          index,
          messageSid,
        });
      }
    }

    await supabaseAdmin
      .from("reception_conversations")
      .update({
        status: "open",
        last_message_preview:
          body.slice(0, 160) ||
          (savedAttachments.length > 0
            ? "Attachment received"
            : "Message received"),
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
        saved_attachments: savedAttachments,
      },
    });

    if (stopRequested) {
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

    if (helpRequested) {
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

    if (yesConfirmation) {
      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: conversation.id,
        message_id: message.id,
        action: "appointment_confirmation_reply_detected",
        details: {
          from,
          body,
          praktika_appointment_id: conversation.praktika_appointment_id,
          note: "Next step: connect this to Praktika appointment response update.",
        },
      });
    }

    return twimlEmptyResponse();
  } catch (error) {
    console.error("Twilio inbound webhook failed", error);
    return twimlEmptyResponse();
  }
}