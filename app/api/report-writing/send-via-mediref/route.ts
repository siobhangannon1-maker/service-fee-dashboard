import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSendMedirefLetterJob } from "@/lib/mediref/helper-job-client";
import {
  createReportAuditEvent,
  getAuditActor,
} from "@/lib/report-writing/audit";
import { generatePeriodontalChartPdf } from "@/lib/praktika/periodontal-chart";

export const runtime = "nodejs";

const HELPER_UPLOAD_BUCKET =
  process.env.MEDIREF_HELPER_UPLOAD_BUCKET || "report-assets";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function safeFileName(name: string | null | undefined) {
  return String(name || "Patient")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
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
  return String(value || "")
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

async function getAppointmentDateForDraft(draftId: string) {
  const { data } = await supabase
    .from("report_letter_queue")
    .select("appointment_time")
    .eq("report_draft_id", draftId)
    .order("appointment_time", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.appointment_time
    ? String(data.appointment_time).slice(0, 10)
    : null;
}

async function updatePerioStatus(params: {
  draftId: string;
  attachedAt?: string | null;
  attachmentName?: string | null;
  error?: string | null;
}) {
  await supabase
    .from("report_drafts")
    .update({
      periodontal_chart_attached_at: params.attachedAt || null,
      periodontal_chart_attachment_name: params.attachmentName || null,
      periodontal_chart_attachment_error: params.error || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.draftId);
}

async function stagePdf(params: {
  buffer: Buffer;
  draftId: string;
  fileName: string;
  folder: string;
}) {
  const storagePath = `${params.folder}/${params.draftId}/${Date.now()}-${
    params.fileName
  }`;

  const { error } = await supabase.storage
    .from(HELPER_UPLOAD_BUCKET)
    .upload(storagePath, params.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (error) {
    throw new Error(`Could not stage PDF for MediRef: ${error.message}`);
  }

  return {
    bucket: HELPER_UPLOAD_BUCKET,
    storagePath,
    fileName: params.fileName,
    contentType: "application/pdf" as const,
  };
}

export async function POST(req: Request) {
  const stagedPaths: string[] = [];

  try {
    const body = await req.json();
    const actor = await getAuditActor();

    const draftId = String(body.draftId || "").trim();
    const referrerName = String(body.referrerName || "").trim();
    const referrerEmail = String(body.referrerEmail || "").trim();
    const referrerProviderNumber = String(
      body.referrerProviderNumber || "",
    ).trim();
    const cc = String(body.cc || body.ccEmails || "").trim();
    const message = String(body.message || "").trim();
    const attachPeriodontalChart = Boolean(body.attachPeriodontalChart);
    const requestedPraktikaPatientId = String(
      body.praktikaPatientId ||
        body.praktika_patient_id ||
        body.patientId ||
        "",
    ).trim();

    if (!draftId) {
      return NextResponse.json(
        { success: false, error: "Missing draftId." },
        { status: 400 },
      );
    }

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
      referrerName || String(draft.referrer_name || "").trim();

    if (!finalReferrerName && !referrerEmail && !referrerProviderNumber) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Please enter a MediRef recipient name, email, or provider number.",
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

    const patientName = String(draft.patient_name || "Patient").trim();
    const splitName = splitPatientName(patientName);

    const letterFileName = `${new Date().toISOString().slice(0, 10)} ${safeFileName(
      patientName,
    )} Letter.pdf`;

    const letterAttachment = await stagePdf({
      buffer: Buffer.from(await pdfResponse.arrayBuffer()),
      draftId,
      fileName: letterFileName,
      folder: "mediref-uploads",
    });

    stagedPaths.push(letterAttachment.storagePath);

    const attachments = [letterAttachment];

    let periodontalChartAttached = false;
    let periodontalChartAttachmentName: string | null = null;
    let periodontalChartError: string | null = null;

    if (attachPeriodontalChart) {
      const finalPraktikaPatientId =
        requestedPraktikaPatientId ||
        String(draft.praktika_patient_id || "").trim();

      if (!finalPraktikaPatientId) {
        periodontalChartError =
          "Periodontal chart was requested, but no Praktika patient ID is linked.";

        await updatePerioStatus({
          draftId,
          attachedAt: null,
          attachmentName: null,
          error: periodontalChartError,
        });
      } else {
        try {
          const appointmentDate = await getAppointmentDateForDraft(draftId);

          let perioChart = await generatePeriodontalChartPdf({
            patientId: finalPraktikaPatientId,
            appointmentDate,
            patientName,
            providerName: actor.actorFullName || null,
          });

          if (!perioChart && appointmentDate) {
            perioChart = await generatePeriodontalChartPdf({
              patientId: finalPraktikaPatientId,
              appointmentDate: null,
              patientName,
              providerName: actor.actorFullName || null,
            });
          }

          if (perioChart) {
            const perioAttachment = await stagePdf({
              buffer: perioChart.buffer,
              draftId,
              fileName: perioChart.fileName,
              folder: "mediref-uploads",
            });

            stagedPaths.push(perioAttachment.storagePath);
            attachments.push(perioAttachment);

            periodontalChartAttached = true;
            periodontalChartAttachmentName = perioChart.fileName;

            await updatePerioStatus({
              draftId,
              attachedAt: new Date().toISOString(),
              attachmentName: perioChart.fileName,
              error: null,
            });
          } else {
            periodontalChartError =
              "Periodontal chart was requested, but no periodontal chart was found.";

            await updatePerioStatus({
              draftId,
              attachedAt: null,
              attachmentName: null,
              error: periodontalChartError,
            });
          }
        } catch (error) {
          periodontalChartError =
            error instanceof Error
              ? error.message
              : "Failed to generate periodontal chart.";

          await updatePerioStatus({
            draftId,
            attachedAt: null,
            attachmentName: null,
            error: periodontalChartError,
          });
        }
      }
    } else {
      await updatePerioStatus({
        draftId,
        attachedAt: null,
        attachmentName: null,
        error: null,
      });
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
          email: referrerEmail || null,
          providerNumber: referrerProviderNumber || null,
        },
        cc: parseCc(cc),
        attachments,
        message:
          message ||
          `Specialist correspondence for ${patientName || "patient"}.`,
      },
      priority: 20,
    });

    await supabase
      .from("report_drafts")
      .update({
        emailed_to_referrer_at: new Date().toISOString(),
        emailed_to_referrer_email: referrerEmail || finalReferrerName || null,
        emailed_to_referrer_resend_id: `mediref:${job.id}`,
        emailed_by_initials: actor.actorInitials,
        emailed_by_name: actor.actorFullName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId);

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
        attachments: attachments.map((item) => ({
          fileName: item.fileName,
          storagePath: item.storagePath,
        })),
        periodontalChartAttached,
        periodontalChartAttachmentName,
        periodontalChartError,
        actorInitials: actor.actorInitials,
        actorFullName: actor.actorFullName,
      },
    });

    return NextResponse.json({
      success: true,
      jobId: job.id,
      recipient: referrerEmail || finalReferrerName,
      periodontalChartAttached,
      periodontalChartAttachmentName,
      periodontalChartError,
      message:
        "MediRef send has been queued. The Mac Mini helper will process it.",
    });
  } catch (error) {
    console.error("Failed to queue MediRef send:", error);

    if (stagedPaths.length > 0) {
      await supabase.storage
        .from(HELPER_UPLOAD_BUCKET)
        .remove(stagedPaths)
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