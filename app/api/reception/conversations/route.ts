import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  findOrCreatePatientConversation,
  normalizeReceptionPhone,
} from "@/lib/reception/conversation-threading";
import { getStaffDisplayInfo } from "@/lib/reception/staff-display";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status") || "open";
  const search = request.nextUrl.searchParams.get("search") || "";

  let query = supabaseAdmin
    .from("reception_conversations")
    .select("*")
    .eq("status", status)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(100);

  const cleanSearch = search.trim();

  if (cleanSearch) {
    const normalisedPhone = normalizeReceptionPhone(cleanSearch);

    query = query.or(
      [
        `patient_first_name.ilike.%${cleanSearch}%`,
        `patient_last_name.ilike.%${cleanSearch}%`,
        `patient_mobile.ilike.%${cleanSearch}%`,
        normalisedPhone ? `patient_mobile.ilike.%${normalisedPhone}%` : "",
      ]
        .filter(Boolean)
        .join(",")
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    conversations: data || [],
  });
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

  let patient: any = null;

  if (body.praktikaPatientId) {
    const { data, error } = await supabaseAdmin
      .from("praktika_patients")
      .select("*")
      .eq("praktika_patient_id", String(body.praktikaPatientId))
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    patient = data;
  }

  const patientMobile =
    patient?.mobile ||
    patient?.patient_mobile ||
    body.patientMobile ||
    body.mobile ||
    "";

  if (!patientMobile) {
    return NextResponse.json(
      { error: "Patient mobile is required." },
      { status: 400 }
    );
  }

  const patientFirstName =
    patient?.first_name ||
    patient?.preferred_name ||
    body.patientFirstName ||
    body.firstName ||
    null;

  const patientLastName =
    patient?.last_name || body.patientLastName || body.lastName || null;

  const praktikaPatientId =
    patient?.praktika_patient_id ||
    body.praktikaPatientId ||
    body.praktikaPatientID ||
    null;

  const { conversation, created } = await findOrCreatePatientConversation({
    patientMobile,
    patientFirstName,
    patientLastName,
    praktikaPatientId,
    praktikaAppointmentId: body.praktikaAppointmentId || null,
    assignedUserId: user.id,
    assignedDisplayName: staff.displayName,
    workflowStatus: "general",
    lastMessagePreview: created ? "Conversation started" : "Conversation reopened",
  });

  if (!created) {
    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversation.id,
      actor_user_id: user.id,
      actor_display_name: staff.displayName,
      action: "existing_patient_thread_reused",
      details: {
        reason: "Matched by Praktika patient ID or patient name/mobile.",
        praktika_patient_id: praktikaPatientId,
        patient_first_name: patientFirstName,
        patient_last_name: patientLastName,
        patient_mobile: normalizeReceptionPhone(patientMobile),
      },
    });
  }

  return NextResponse.json({
    conversation,
    created,
  });
}
