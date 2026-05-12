import { NextResponse } from "next/server";
import {
  uploadPatientCommunicationFile,
  uploadPatientImageFile,
  createPatientClinicalNote,
} from "@/lib/praktika/patient-filing";

export const runtime = "nodejs";

function isImage(file: File) {
  return ["image/jpeg", "image/png"].includes(file.type);
}

function isPdf(file: File) {
  return file.type === "application/pdf";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const patientId = String(formData.get("patientId") ?? "").trim();
    const noteText = String(formData.get("noteText") ?? "").trim();
    const files = formData.getAll("files").filter((item): item is File => item instanceof File);

    if (!patientId) {
      return NextResponse.json(
        { ok: false, error: "Missing patientId." },
        { status: 400 }
      );
    }

    const results: any[] = [];

    for (const file of files) {
      if (isPdf(file)) {
        const result = await uploadPatientCommunicationFile({
          patientId,
          file,
          fileName: file.name,
          notes: "Filed by DocuDental assisted filing.",
        });

        results.push({
          fileName: file.name,
          type: "communication_pdf",
          result,
        });
      } else if (isImage(file)) {
        const result = await uploadPatientImageFile({
          patientId,
          file,
          fileName: file.name,
          notes: "Filed by DocuDental assisted filing.",
        });

        results.push({
          fileName: file.name,
          type: "patient_image",
          result,
        });
      } else {
        results.push({
          fileName: file.name,
          type: "unsupported",
          error: `Unsupported file type: ${file.type}`,
        });
      }
    }

    let noteResult = null;

    if (noteText) {
      noteResult = await createPatientClinicalNote({
        patientId,
        text: noteText,
        author: "AI",
      });
    }

    return NextResponse.json({
      ok: true,
      patientId,
      fileResults: results,
      noteResult,
    });
  } catch (error: any) {
    console.error("Praktika assisted filing failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Praktika assisted filing failed.",
      },
      { status: 500 }
    );
  }
}