import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { addPraktikaClinicalNote } from "@/lib/praktika/clinical-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const sessionId = cleanString(body.sessionId);
    const praktikaPatientId = cleanString(body.praktikaPatientId);
    const editedNote = cleanString(body.editedNote);
    const practiceId =
      typeof body.practiceId === "number" ? body.practiceId : 1181;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "Missing sessionId." },
        { status: 400 },
      );
    }

    if (!praktikaPatientId) {
      return NextResponse.json(
        { success: false, error: "Missing Praktika patient ID." },
        { status: 400 },
      );
    }

    if (!editedNote) {
      return NextResponse.json(
        { success: false, error: "Clinical note is empty." },
        { status: 400 },
      );
    }

    const uploadResult = await addPraktikaClinicalNote({
      praktikaPatientId,
      noteText: editedNote,
      practiceId,
    });

    const updateResult = await supabase
      .from("clinical_scribe_sessions")
      .update({
        praktika_patient_id: praktikaPatientId,
        edited_note: editedNote,
        status: "uploaded_to_praktika",
        uploaded_to_praktika: true,
        uploaded_to_praktika_at: new Date().toISOString(),
        praktika_note_id: uploadResult.praktikaNoteId
          ? String(uploadResult.praktikaNoteId)
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (updateResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: updateResult.error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      praktikaNoteId: uploadResult.praktikaNoteId || null,
    });
  } catch (error) {
    console.error("Upload clinical note to Praktika error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload clinical note to Praktika.",
      },
      { status: 500 },
    );
  }
}