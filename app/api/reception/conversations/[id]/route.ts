import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data: conversation, error } = await supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !conversation) {
    return NextResponse.json(
      { error: error?.message || "Conversation not found." },
      { status: 404 }
    );
  }

  const [{ data: messages }, { data: audits }, { data: consent }, { data: patient }, { data: appointments }] =
    await Promise.all([
      supabaseAdmin
        .from("reception_messages")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true }),

      supabaseAdmin
        .from("reception_audit_logs")
        .select("*")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true }),

      supabaseAdmin
        .from("reception_sms_consent")
        .select("*")
        .eq("phone_number", conversation.patient_mobile)
        .maybeSingle(),

      conversation.praktika_patient_id
        ? supabaseAdmin
            .from("praktika_patients")
            .select("*")
            .eq("praktika_patient_id", conversation.praktika_patient_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),

      conversation.praktika_patient_id
        ? supabaseAdmin
            .from("praktika_appointments")
            .select("*")
            .eq("praktika_patient_id", conversation.praktika_patient_id)
            .order("appointment_datetime", { ascending: true })
            .limit(10)
        : Promise.resolve({ data: [] }),
    ]);

  return NextResponse.json({
    conversation,
    messages: messages || [],
    audits: audits || [],
    consent,
    patient,
    appointments: appointments || [],
  });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const staff = await getStaffDisplayInfo(user.id);
  const body = await request.json();

  const updatePayload: any = {
    updated_at: new Date().toISOString(),
  };

  if (body.status === "open" || body.status === "closed") {
    updatePayload.status = body.status;

    if (body.status === "closed") {
      updatePayload.closed_by_user_id = user.id;
      updatePayload.closed_at = new Date().toISOString();
      updatePayload.close_summary = body.closeSummary || null;
    }
  }

  if (body.praktikaAppointmentId !== undefined) {
    updatePayload.praktika_appointment_id = body.praktikaAppointmentId || null;
  }

  const { data: conversation, error } = await supabaseAdmin
    .from("reception_conversations")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabaseAdmin.from("reception_audit_logs").insert({
    conversation_id: id,
    actor_user_id: user.id,
    actor_display_name: staff.displayName,
    action:
      body.status === "closed"
        ? "conversation_closed"
        : body.status === "open"
        ? "conversation_opened"
        : "conversation_updated",
    details: body,
  });

  return NextResponse.json({ conversation });
}