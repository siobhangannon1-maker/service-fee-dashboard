import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSendMedirefLetterJob } from "@/lib/mediref/helper-job-client";
import {
  createReportAuditEvent,
  getAuditActor,
} from "@/lib/report-writing/audit";

export const runtime = "nodejs";

const HELPER_UPLOAD_BUCKET =
  process.env.MEDIREF_HELPER_UPLOAD_BUCKET || "report-assets";

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

function splitPatientName(name: string | null | undefined) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function parseCc(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return { email: item.trim() };
        }

        return {
          name: item?.name ? String(item.name).trim() : null,
          email: item?.email ? String(item.email).trim() : null,
          providerNumber: item?.providerNumber
            ? String(item.providerNumber).trim()
            : null,
        };
      })
      .filter((item) => item.email || item.providerNumber || item.name);
  }

  return String(value || "")
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

export async function POST(req: Request) {
  let storagePath: string | null = null;

  try {
    const body = await req.json();

    const {
      draftId,
      referrerName,
      referrerEmail,
      referrerProviderNumber,
      cc,
      message,
    } = body;

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
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
          error: "Only approved reports can be sent through MediRef.",
        },
        { status: 400 },
      );
    }

    const finalReferrerName =
      String(referrerName || "").trim() ||
      String(draft.referrer_name || "").trim();

    if (!finalReferrerName && !referrerEmail && !referrerProviderNumber) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Please select a MediRef referrer or enter recipient details before sending.",
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
          error: "Failed to generate PDF before MediRef send.",
          details: errorText.slice(0, 1000),
        },
        { status: 500 },
      );
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfBuffer = Buffer.from(await pdfBlob.arrayBuffer());

    const patientName = String(draft.patient_name || "").trim();
    const splitName = splitPatientName(patientName);

    const fileName = `${getFileDate()} ${getSafePatientName(
      patientName,
    )} Letter.pdf`;

    storagePath = `mediref-uploads/${draftId}/${Date.now()}-${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(HELPER_UPLOAD_BUCKET)
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(
        `Could not stage PDF for MediRef helper: ${uploadError.message}`,
      );
    }

    const job = await createSendMedirefLetterJob({
      request: {
        action: "send_letter",
        draftId,
        patient: {
          firstName: splitName.firstName,
          lastName: splitName.lastName,
          dob: draft.patient_dob || null,
        },
        recipient: {
          name: finalReferrerName,
          email: referrerEmail ? String(referrerEmail).trim() : null,
          providerNumber: referrerProviderNumber
            ? String(referrerProviderNumber).trim()
            : null,
        },
        cc: parseCc(cc),
        attachment: {
          bucket: HELPER_UPLOAD_BUCKET,
          storagePath,
          fileName,
          contentType: "application/pdf",
        },
        message:
          String(message || "").trim() ||
          `Specialist correspondence for ${patientName || "patient"}.`,
      },
      priority: 20,
    });

    await createReportAuditEvent({
      reportDraftId: draft.id,
      providerId: draft.provider_id,
      patientName: draft.patient_name,
      action: "Queued MediRef send",
      details: {
        jobId: job.id,
        recipient: {
          name: finalReferrerName,
          email: referrerEmail || null,
          providerNumber: referrerProviderNumber || null,
        },
        cc: parseCc(cc),
        fileName,
        stagedStoragePath: storagePath,
        queuedByInitials: actor.actorInitials,
        queuedByName: actor.actorFullName,
      },
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message:
        "MediRef send has been queued. The Mac Mini helper will process it.",
    });
  } catch (error) {
    console.error("Failed to queue MediRef send:", error);

    if (storagePath) {
      await supabase.storage
        .from(HELPER_UPLOAD_BUCKET)
        .remove([storagePath])
        .catch(() => null);
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to queue MediRef send.",
      },
      { status: 500 },
    );
  }
}