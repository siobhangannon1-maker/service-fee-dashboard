import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/reception/phone";

function getAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.focusdentalspecialists.com.au"
  ).replace(/\/$/, "");
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function POST(request: NextRequest) {
  const user = await requireUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const conversationId = body.conversationId ? String(body.conversationId) : "";
  const praktikaAppointmentId = body.praktikaAppointmentId
    ? String(body.praktikaAppointmentId)
    : null;

  if (!conversationId) {
    return NextResponse.json(
      { error: "Conversation ID is required." },
      { status: 400 }
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
      { status: 404 }
    );
  }

  const appointmentId =
    praktikaAppointmentId || conversation.praktika_appointment_id || null;

  const { data: appointment } = appointmentId
    ? await supabaseAdmin
        .from("praktika_appointments")
        .select("*")
        .eq("praktika_appointment_id", String(appointmentId))
        .maybeSingle()
    : { data: null };

  const { data: template, error: templateError } = await supabaseAdmin
    .from("reception_questionnaire_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (templateError || !template) {
    return NextResponse.json(
      { error: "No active questionnaire template found." },
      { status: 404 }
    );
  }

  const token = makeToken();
  const firstName =
    appointment?.patient_first_name || conversation.patient_first_name || "";
  const lastName =
    appointment?.patient_last_name || conversation.patient_last_name || "";
  const mobile = normalizePhone(
    appointment?.patient_mobile || conversation.patient_mobile || ""
  );

  const { data: queueItem, error: queueError } = await supabaseAdmin
    .from("reception_questionnaire_queue")
    .insert({
      template_id: template.id,
      praktika_appointment_id: appointmentId ? String(appointmentId) : null,
      praktika_patient_id:
        appointment?.praktika_patient_id ||
        conversation.praktika_patient_id ||
        null,
      conversation_id: conversation.id,
      patient_first_name: firstName || null,
      patient_last_name: lastName || null,
      patient_mobile: mobile,
      appointment_date: appointment?.appointment_date || null,
      appointment_time: appointment?.appointment_time || null,
      appointment_type: appointment?.tx_label || appointment?.tx_type || null,
      provider_name: appointment?.provider_name || null,
      mapped_location: appointment?.mapped_location || null,
      status: "queued",
      token,
    })
    .select("*")
    .single();

  if (queueError || !queueItem) {
    return NextResponse.json(
      { error: queueError?.message || "Could not create questionnaire link." },
      { status: 500 }
    );
  }

  const questionnaireLink = `${getAppBaseUrl()}/questionnaire/${token}`;

  const smsBody = String(template.sms_body || "")
    .replaceAll("{{first_name}}", firstName || "")
    .replaceAll("{{questionnaire_link}}", questionnaireLink);

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: conversation.id,
    actor_user_id: user.id,
    action: "post_op_questionnaire_link_created",
    details: {
      questionnaire_queue_id: queueItem.id,
      praktika_appointment_id: appointmentId,
      questionnaire_link: questionnaireLink,
    },
  });

  return NextResponse.json({
    ok: true,
    queueItem,
    url: questionnaireLink,
    smsBody,
  });
}
