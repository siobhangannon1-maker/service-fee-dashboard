import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/reception/phone";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

function getAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.focusdentalspecialists.com.au"
  ).replace(/\/$/, "");
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function appointmentText(appointment: any) {
  return [
    appointment.tx_type,
    appointment.tx_label,
    appointment.appointment_notes,
    appointment.resource_name,
    appointment.provider_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesTemplate(appointment: any, template: any) {
  const text = appointmentText(appointment);
  const keywords: string[] = template.trigger_keywords || [];

  return keywords.some((keyword) =>
    text.includes(String(keyword).toLowerCase())
  );
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

async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function GET(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date");
  const status = request.nextUrl.searchParams.get("status") || "all";

  if (!date) {
    return NextResponse.json({ error: "Date is required." }, { status: 400 });
  }

  const { data: templates, error: templateError } = await supabaseAdmin
    .from("reception_questionnaire_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (templateError) {
    return NextResponse.json({ error: templateError.message }, { status: 500 });
  }

  const { data: appointments, error: appointmentError } = await supabaseAdmin
    .from("praktika_appointments")
    .select("*")
    .eq("appointment_date", date)
    .order("appointment_datetime", { ascending: true });

  if (appointmentError) {
    return NextResponse.json({ error: appointmentError.message }, { status: 500 });
  }

  const appointmentIds = (appointments || []).map((appointment) =>
    String(appointment.praktika_appointment_id)
  );

  const { data: existingQueue } =
    appointmentIds.length > 0
      ? await supabaseAdmin
          .from("reception_questionnaire_queue")
          .select("*")
          .in("praktika_appointment_id", appointmentIds)
      : { data: [] };

  const queueByAppointmentId = new Map<string, any>();

  for (const item of existingQueue || []) {
    queueByAppointmentId.set(String(item.praktika_appointment_id), item);
  }

  const rows = [];

  for (const appointment of appointments || []) {
    const matchedTemplate = (templates || []).find((template) =>
      matchesTemplate(appointment, template)
    );

    if (!matchedTemplate) continue;

    const existing = queueByAppointmentId.get(
      String(appointment.praktika_appointment_id)
    );

    const rowStatus = existing?.status || "not_created";

    if (status !== "all" && rowStatus !== status) continue;

    rows.push({
      appointment,
      template: matchedTemplate,
      queueItem: existing || null,
      status: rowStatus,
      has_mobile: Boolean(normalizePhone(appointment.patient_mobile || "")),
    });
  }

  return NextResponse.json({
    rows,
    templates: templates || [],
  });
}

export async function POST(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const date = body.date ? String(body.date) : "";
  const appointmentIds: string[] = body.appointmentIds || [];
  const mode = body.mode || "create";

  if (!date && appointmentIds.length === 0) {
    return NextResponse.json(
      { error: "Date or appointment IDs are required." },
      { status: 400 }
    );
  }

  const { data: templates, error: templateError } = await supabaseAdmin
    .from("reception_questionnaire_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (templateError) {
    return NextResponse.json({ error: templateError.message }, { status: 500 });
  }

  let appointmentQuery = supabaseAdmin.from("praktika_appointments").select("*");

  if (appointmentIds.length > 0) {
    appointmentQuery = appointmentQuery.in("praktika_appointment_id", appointmentIds);
  } else {
    appointmentQuery = appointmentQuery.eq("appointment_date", date);
  }

  const { data: appointments, error: appointmentError } = await appointmentQuery;

  if (appointmentError) {
    return NextResponse.json({ error: appointmentError.message }, { status: 500 });
  }

  const createdOrExisting = [];

  for (const appointment of appointments || []) {
    const template = (templates || []).find((item) =>
      matchesTemplate(appointment, item)
    );

    if (!template) continue;

    const { data: existing } = await supabaseAdmin
      .from("reception_questionnaire_queue")
      .select("*")
      .eq("praktika_appointment_id", String(appointment.praktika_appointment_id))
      .maybeSingle();

    if (existing) {
      createdOrExisting.push(existing);
      continue;
    }

    const { data: queueItem, error: queueError } = await supabaseAdmin
      .from("reception_questionnaire_queue")
      .insert({
        template_id: template.id,
        praktika_appointment_id: String(appointment.praktika_appointment_id),
        praktika_patient_id: appointment.praktika_patient_id
          ? String(appointment.praktika_patient_id)
          : null,
        patient_first_name: appointment.patient_first_name || null,
        patient_last_name: appointment.patient_last_name || null,
        patient_mobile: normalizePhone(appointment.patient_mobile || ""),
        appointment_date: appointment.appointment_date || null,
        appointment_time: appointment.appointment_time || null,
        appointment_type: appointment.tx_label || appointment.tx_type || null,
        provider_name: appointment.provider_name || null,
        mapped_location: appointment.mapped_location || null,
        status: "queued",
        token: makeToken(),
      })
      .select("*")
      .single();

    if (queueError) {
      console.error("Could not create questionnaire queue item", {
        error: queueError,
        appointmentId: appointment.praktika_appointment_id,
      });
      continue;
    }

    createdOrExisting.push(queueItem);
  }

  if (mode !== "send") {
    return NextResponse.json({
      ok: true,
      createdCount: createdOrExisting.length,
      sentCount: 0,
    });
  }

  const staff = await getStaffDisplayInfo(user.id);
  const results = [];

  for (const queueItem of createdOrExisting) {
    try {
      if (queueItem.status === "completed") {
        results.push({
          id: queueItem.id,
          ok: false,
          error: "Questionnaire already completed.",
        });
        continue;
      }

      const mobile = normalizePhone(queueItem.patient_mobile || "");

      if (!mobile) {
        results.push({
          id: queueItem.id,
          ok: false,
          error: "No mobile number.",
        });
        continue;
      }

      const { data: template } = await supabaseAdmin
        .from("reception_questionnaire_templates")
        .select("*")
        .eq("id", queueItem.template_id)
        .single();

      const questionnaireLink = `${getAppBaseUrl()}/questionnaire/${queueItem.token}`;

      const smsBody = String(template.sms_body || "")
        .replaceAll("{{first_name}}", queueItem.patient_first_name || "")
        .replaceAll("{{questionnaire_link}}", questionnaireLink);

      let { data: conversation } = await supabaseAdmin
        .from("reception_conversations")
        .select("*")
        .eq("patient_mobile", mobile)
        .eq("status", "open")
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!conversation) {
        const { data: createdConversation, error: createConversationError } =
          await supabaseAdmin
            .from("reception_conversations")
            .insert({
              status: "open",
              workflow_status: "waiting_on_patient",
              is_urgent: false,
              unread_count: 0,
              praktika_patient_id: queueItem.praktika_patient_id,
              praktika_appointment_id: queueItem.praktika_appointment_id,
              patient_first_name: queueItem.patient_first_name,
              patient_last_name: queueItem.patient_last_name,
              patient_mobile: mobile,
              assigned_user_id: user.id,
              assigned_display_name: staff.displayName,
              last_message_preview: smsBody.slice(0, 160),
              last_message_at: new Date().toISOString(),
            })
            .select("*")
            .single();

        if (createConversationError || !createdConversation) {
          results.push({
            id: queueItem.id,
            ok: false,
            error:
              createConversationError?.message || "Could not create conversation.",
          });
          continue;
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
          sent_by_user_id: user.id,
          sent_by_display_name: staff.displayName,
          staff_display_name: staff.displayName,
          staff_initials: staff.initials,
          message_source: "manual",
        })
        .select("*")
        .single();

      if (messageError || !message) {
        results.push({
          id: queueItem.id,
          ok: false,
          error: messageError?.message || "Could not save message.",
        });
        continue;
      }

      await supabaseAdmin
        .from("reception_questionnaire_queue")
        .update({
          conversation_id: conversation.id,
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", queueItem.id);

      await supabaseAdmin
        .from("reception_conversations")
        .update({
          workflow_status: "waiting_on_patient",
          last_message_preview: smsBody.slice(0, 160),
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id);

      await supabaseAdmin.from("reception_audit_logs").insert({
        conversation_id: conversation.id,
        message_id: message.id,
        actor_user_id: user.id,
        actor_display_name: staff.displayName,
        action: "post_op_questionnaire_sent",
        details: {
          questionnaire_queue_id: queueItem.id,
          praktika_appointment_id: queueItem.praktika_appointment_id,
          questionnaire_link: questionnaireLink,
          twilio_sid: twilio.sid,
        },
      });

      results.push({
        id: queueItem.id,
        ok: true,
      });
    } catch (error) {
      results.push({
        id: queueItem.id,
        ok: false,
        error: error instanceof Error ? error.message : "Could not send.",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    createdCount: createdOrExisting.length,
    sentCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  });
}
