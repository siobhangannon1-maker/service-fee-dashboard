import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { uploadPatientCommunicationFile } from "@/lib/praktika/patient-filing";
import { withPraktikaAutoRefresh } from "@/lib/praktika/seamless-request";
import {
  createReportAuditEvent,
  getAuditActor,
} from "@/lib/report-writing/audit";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function getSafePatientName(patientName: string | null | undefined) {
  return patientName
    ? String(patientName)
        .trim()
        .replace(/[^a-z0-9]+/gi, "_")
        .replace(/^_+|_+$/g, "")
    : "Patient";
}

function getFileDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { draftId, praktikaPatientId, notes } = body;

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 },
      );
    }

    if (!praktikaPatientId) {
      return NextResponse.json(
        { success: false, error: "Missing Praktika patient ID." },
        { status: 400 },
      );
    }

    const actor = await getAuditActor();

    const { data: draft, error: draftError } = await supabase
      .from("report_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return NextResponse.json(
        { success: false, error: "Draft not found." },
        { status: 404 },
      );
    }

    if (draft.status !== "approved" && draft.status !== "uploaded_to_praktika") {
      return NextResponse.json(
        {
          success: false,
          error: "Only approved reports can be uploaded to Praktika.",
        },
        { status: 400 },
      );
    }

    const origin = new URL(req.url).origin;

    const pdfResponse = await fetch(`${origin}/api/report-writing/generate-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    });

    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();

      return NextResponse.json(
        {
          success: false,
          error: "Failed to generate PDF before Praktika upload.",
          details: errorText.slice(0, 1000),
        },
        { status: 500 },
      );
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());

    const fileName = `${getFileDate()} ${getSafePatientName(
      draft.patient_name,
    )} Letter.pdf`;

    const file = new File([pdfBuffer], fileName, {
      type: "application/pdf",
    });

    await withPraktikaAutoRefresh(() =>
      uploadPatientCommunicationFile({
        patientId: praktikaPatientId,
        file,
        fileName,
        notes:
          notes ||
          `Specialist report uploaded from AI report-writing assistant for ${
            draft.patient_name || "patient"
          }.`,
      }),
    );

    const { data: updatedDraft, error: updateError } = await supabase
      .from("report_drafts")
      .update({
        uploaded_to_praktika: true,
        uploaded_to_praktika_at: new Date().toISOString(),
        uploaded_by_initials: actor.actorInitials,
        uploaded_by_name: actor.actorFullName,
        praktika_patient_id: String(praktikaPatientId),
        status: "uploaded_to_praktika",
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)
      .select()
      .single();

    if (updateError) {
      console.error(
        "PDF uploaded to Praktika, but failed to update report status:",
        updateError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "PDF uploaded to Praktika, but failed to update report status.",
          details: updateError.message,
        },
        { status: 500 },
      );
    }

    await createReportAuditEvent({
      reportDraftId: draft.id,
      providerId: draft.provider_id,
      patientName: draft.patient_name,
      action: "Uploaded report to Praktika",
      details: {
        praktikaPatientId,
        fileName,
        status: updatedDraft.status,
        uploadedByInitials: actor.actorInitials,
        uploadedByName: actor.actorFullName,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Report uploaded to Praktika communications.",
      fileName,
      uploadedByInitials: actor.actorInitials,
      uploadedByName: actor.actorFullName,
    });
  } catch (error) {
    console.error("Upload report to Praktika failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload report to Praktika.",
      },
      { status: 500 },
    );
  }
}
