import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/reception/phone";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") || "open";
  const search = request.nextUrl.searchParams.get("search") || "";

  let query = supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("status", status)
    .order("is_urgent", { ascending: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });

  if (search.trim()) {
    query = query.or(
      `patient_first_name.ilike.%${search}%,patient_last_name.ilike.%${search}%,patient_mobile.ilike.%${search}%`
    );
  }

  const { data, error } = await query.limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const praktikaPatientId = body.praktikaPatientId
    ? String(body.praktikaPatientId)
    : null;

  const praktikaAppointmentId = body.praktikaAppointmentId
    ? String(body.praktikaAppointmentId)
    : null;

  if (!praktikaPatientId && !body.patientMobile) {
    return NextResponse.json(
      { error: "Patient or mobile number is required." },
      { status: 400 }
    );
  }

  let patient: any = null;
  let appointment: any = null;

  if (praktikaPatientId) {
    const { data } = await supabaseAdmin
      .from("praktika_patients")
      .select("*")
      .eq("praktika_patient_id", praktikaPatientId)
      .maybeSingle();

    patient = data;
  }

  if (praktikaAppointmentId) {
    const { data } = await supabaseAdmin
      .from("praktika_appointments")
      .select("*")
      .eq("praktika_appointment_id", praktikaAppointmentId)
      .maybeSingle();

    appointment = data;
  }

  const patientMobile = normalizePhone(
    patient?.mobile || appointment?.patient_mobile || body.patientMobile
  );

  if (!patientMobile) {
    return NextResponse.json(
      { error: "Patient does not have a usable mobile number." },
      { status: 400 }
    );
  }

  const firstName =
    patient?.preferred_name ||
    patient?.first_name ||
    appointment?.patient_first_name ||
    "";

  const lastName = patient?.last_name || appointment?.patient_last_name || "";

  const staff = await getStaffDisplayInfo(user.id);

  const { data: existing } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("patient_mobile", patientMobile)
    .eq("status", "open")
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ conversation: existing });
  }

  const { data: conversation, error } = await supabaseAdmin
    .from("reception_conversations")
    .insert({
      status: "open",
      workflow_status: "general",
      is_urgent: false,
      unread_count: 0,
      praktika_patient_id: praktikaPatientId,
      praktika_appointment_id: praktikaAppointmentId,
      patient_first_name: firstName,
      patient_last_name: lastName,
      patient_mobile: patientMobile,
      assigned_user_id: user.id,
      assigned_display_name: staff.displayName,
      last_message_preview: "Conversation started",
      last_message_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: conversation.id,
    actor_user_id: user.id,
    actor_display_name: staff.displayName,
    action: "conversation_created",
    details: {
      praktika_patient_id: praktikaPatientId,
      praktika_appointment_id: praktikaAppointmentId,
    },
  });

  await supabaseAdmin.from("reception_sms_consent").upsert(
    {
      phone_number: patientMobile,
      praktika_patient_id: praktikaPatientId,
      status: "subscribed",
      source: "system",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone_number" }
  );

  return NextResponse.json({ conversation });
}