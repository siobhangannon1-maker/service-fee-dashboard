import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/reception/phone";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

function formatDateDdMmYyyy(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

async function sendTwilioSms(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error("Twilio environment variables are missing.");
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        MessagingServiceSid: messagingServiceSid,
        Body: body,
      }),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Twilio send failed.");
  }

  return result;
}

async function sendConfirmationForAppointment({
  appointment,
  userId,
  staffDisplayName,
  staffInitials,
  forceResend,
}: {
  appointment: any;
  userId: string;
  staffDisplayName: string;
  staffInitials: string;
  forceResend: boolean;
}) {
  const mobile = normalizePhone(appointment.patient_mobile || "");

  if (!mobile) {
    return {
      appointmentId: appointment.praktika_appointment_id,
      ok: false,
      error: "No mobile number.",
    };
  }

  const { data: consent } = await supabaseAdmin
    .from("reception_sms_consent")
    .select("*")
    .eq("phone_number", mobile)
    .maybeSingle();

  if (consent?.status === "unsubscribed") {
    return {
      appointmentId: appointment.praktika_appointment_id,
      ok: false,
      error: "Patient is unsubscribed.",
    };
  }

  const { data: existingRequests } = await supabaseAdmin
    .from("reception_messages")
    .select("*")
    .eq("confirmation_intent", "appointment_confirmation_request")
    .eq("praktika_appointment_id", String(appointment.praktika_appointment_id))
    .eq("confirmation_response_detected", false)
    .order("created_at", { ascending: false });

  if ((existingRequests || []).length > 0 && !forceResend) {
    return {
      appointmentId: appointment.praktika_appointment_id,
      ok: false,
      error: "Confirmation already sent.",
    };
  }

  if ((existingRequests || []).length > 0 && forceResend) {
    await supabaseAdmin
      .from("reception_messages")
      .update({
        confirmation_response_detected: true,
        confirmation_response_at: new Date().toISOString(),
      })
      .in(
        "id",
        (existingRequests || []).map((item) => item.id)
      );
  }

  const firstName = appointment.patient_first_name || "";
  const patientName = [appointment.patient_first_name, appointment.patient_last_name]
    .filter(Boolean)
    .join(" ");

  const dateText = formatDateDdMmYyyy(appointment.appointment_date);
  const timeText = appointment.appointment_time || "";
  const location = appointment.mapped_location || "Focus Dental Specialists";

  const smsBody = `Hi ${firstName},

This is a reminder of your appointment on ${dateText} at ${timeText} at ${location}.

Please reply YES to confirm.`;

  let { data: conversation } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("patient_mobile", mobile)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) {
    const { data: createdConversation, error: createError } = await supabaseAdmin
      .from("reception_conversations")
      .insert({
        status: "open",
        workflow_status: "general",
        is_urgent: false,
        unread_count: 0,
        praktika_patient_id: String(appointment.praktika_patient_id),
        praktika_appointment_id: String(appointment.praktika_appointment_id),
        patient_first_name: appointment.patient_first_name || null,
        patient_last_name: appointment.patient_last_name || null,
        patient_mobile: mobile,
        assigned_user_id: userId,
        assigned_display_name: staffDisplayName,
        appointment_confirmation_status: "confirmation_requested",
        last_message_preview: "Conversation started",
        last_message_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (createError || !createdConversation) {
      return {
        appointmentId: appointment.praktika_appointment_id,
        ok: false,
        error: createError?.message || "Could not create conversation.",
      };
    }

    conversation = createdConversation;
  }

  const twilio = await sendTwilioSms(mobile, smsBody);

  const { data: message, error: messageError } = await supabaseAdmin
    .from("reception_messages")
    .insert({
      conversation_id: conversation.id,
      direction: "outbound",
      body: smsBody,
      twilio_message_sid: twilio.sid,
      twilio_status: twilio.status,
      sent_by_user_id: userId,
      sent_by_display_name: staffDisplayName,
      staff_display_name: staffDisplayName,
      staff_initials: staffInitials,
      message_source: "manual",
      confirmation_intent: "appointment_confirmation_request",
      praktika_appointment_id: String(appointment.praktika_appointment_id),
      confirmation_patient_name: patientName,
      confirmation_appointment_label: `${appointment.appointment_day || ""} ${dateText} at ${timeText}`.trim(),
    })
    .select("*")
    .single();

  if (messageError || !message) {
    return {
      appointmentId: appointment.praktika_appointment_id,
      ok: false,
      error: messageError?.message || "Could not save message.",
    };
  }

  await supabaseAdmin
    .from("reception_conversations")
    .update({
      status: "open",
      praktika_patient_id:
        conversation.praktika_patient_id || String(appointment.praktika_patient_id),
      praktika_appointment_id:
        conversation.praktika_appointment_id || String(appointment.praktika_appointment_id),
      appointment_confirmation_status: "confirmation_requested",
      appointment_confirmed_at: null,
      last_message_preview: smsBody.slice(0, 160),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: conversation.id,
    message_id: message.id,
    actor_user_id: userId,
    actor_display_name: staffDisplayName,
    action: forceResend
      ? "appointment_confirmation_request_resent"
      : "appointment_confirmation_request_sent_from_queue",
    details: {
      praktika_appointment_id: appointment.praktika_appointment_id,
      patient_name: patientName,
      appointment_date: appointment.appointment_date,
      appointment_time: appointment.appointment_time,
      location,
      twilio_sid: twilio.sid,
    },
  });

  return {
    appointmentId: appointment.praktika_appointment_id,
    ok: true,
    conversationId: conversation.id,
    messageId: message.id,
  };
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "Date is required." }, { status: 400 });
  }

  const { data: appointments, error } = await supabaseAdmin
    .from("praktika_appointments")
    .select("*")
    .eq("appointment_date", date)
    .order("appointment_datetime", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const appointmentIds = (appointments || []).map((item) =>
    String(item.praktika_appointment_id)
  );

  const { data: sentMessages } =
    appointmentIds.length > 0
      ? await supabaseAdmin
          .from("reception_messages")
          .select("id, praktika_appointment_id, confirmation_response_detected, created_at, confirmation_response_at")
          .eq("confirmation_intent", "appointment_confirmation_request")
          .in("praktika_appointment_id", appointmentIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  const sentMap = new Map<string, any[]>();

  for (const item of sentMessages || []) {
    const key = String(item.praktika_appointment_id);
    const current = sentMap.get(key) || [];
    current.push(item);
    sentMap.set(key, current);
  }

  const rows = (appointments || []).map((appointment) => {
    const sentItems =
      sentMap.get(String(appointment.praktika_appointment_id)) || [];

    const latest = sentItems[0] || null;
    const confirmed = sentItems.some(
      (item) => item.confirmation_response_detected && item.confirmation_response_at
    );

    return {
      ...appointment,
      has_mobile: Boolean(normalizePhone(appointment.patient_mobile || "")),
      confirmation_already_sent: sentItems.length > 0,
      confirmation_sent_at: latest?.created_at || null,
      confirmation_already_confirmed: confirmed,
      confirmation_confirmed_at:
        sentItems.find((item) => item.confirmation_response_at)
          ?.confirmation_response_at || null,
    };
  });

  return NextResponse.json({ appointments: rows });
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

  const appointmentIds: string[] = body.appointmentIds || [];
  const forceResend = Boolean(body.forceResend);

  if (appointmentIds.length === 0) {
    return NextResponse.json(
      { error: "Please select at least one appointment." },
      { status: 400 }
    );
  }

  const { data: appointments, error } = await supabaseAdmin
    .from("praktika_appointments")
    .select("*")
    .in("praktika_appointment_id", appointmentIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];

  for (const appointment of appointments || []) {
    const result = await sendConfirmationForAppointment({
      appointment,
      userId: user.id,
      staffDisplayName: staff.displayName,
      staffInitials: staff.initials,
      forceResend,
    });

    results.push(result);
  }

  return NextResponse.json({
    ok: true,
    sentCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  });
}
