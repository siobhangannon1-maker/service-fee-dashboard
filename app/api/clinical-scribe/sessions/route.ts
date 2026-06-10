import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerId = cleanString(url.searchParams.get("providerId"));

  if (!providerId) {
    return NextResponse.json(
      { success: false, error: "Missing providerId." },
      { status: 400 },
    );
  }

  const result = await supabase
    .from("clinical_scribe_sessions")
    .select("*")
    .eq("provider_id", providerId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    sessions: result.data || [],
  });
}

export async function POST(request: Request) {
  const body = await request.json();

  const providerId = cleanString(body.providerId);
  const sessionId = cleanString(body.sessionId);
  const patientFirstName = cleanString(body.patientFirstName);
  const patientLastName = cleanString(body.patientLastName);
  const patientDob = cleanString(body.patientDob);
  const praktikaPatientId = cleanString(body.praktikaPatientId);
  const appointmentType =
    cleanString(body.appointmentType) || "periodontal_consultation";
  const transcript = cleanString(body.transcript);
  const aiGeneratedNote = cleanString(body.aiGeneratedNote);
  const editedNote = cleanString(body.editedNote);
  const status = cleanString(body.status) || "draft";
  const structuredData = body.structuredData || {};

  if (!providerId) {
    return NextResponse.json(
      { success: false, error: "Missing providerId." },
      { status: 400 },
    );
  }

  if (!patientFirstName || !patientLastName) {
    return NextResponse.json(
      { success: false, error: "Patient first and last name are required." },
      { status: 400 },
    );
  }

  if (sessionId) {
    const result = await supabase
      .from("clinical_scribe_sessions")
      .update({
        patient_first_name: patientFirstName,
        patient_last_name: patientLastName,
        patient_dob: patientDob || null,
        praktika_patient_id: praktikaPatientId || null,
        appointment_type: appointmentType,
        transcript: null,
        transcript_stored: false,
        structured_data: structuredData,
        ai_generated_note: aiGeneratedNote || null,
        edited_note: editedNote || null,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("provider_id", providerId)
      .select("*")
      .single();

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      session: result.data,
    });
  }

  const result = await supabase
    .from("clinical_scribe_sessions")
    .insert({
      provider_id: providerId,
      patient_first_name: patientFirstName,
      patient_last_name: patientLastName,
      patient_dob: patientDob || null,
      praktika_patient_id: praktikaPatientId || null,
      appointment_type: appointmentType,
      transcript: null,
      transcript_stored: false,
      structured_data: structuredData,
      ai_generated_note: aiGeneratedNote || null,
      edited_note: editedNote || null,
      status,
    })
    .select("*")
    .single();

  if (result.error) {
    return NextResponse.json(
      { success: false, error: result.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    session: result.data,
  });
}