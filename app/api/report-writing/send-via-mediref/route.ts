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

function nowMs() {
  return Date.now();
}

function logStep(label: string, startedAt: number) {
  console.log(`[send-via-mediref] ${label}: ${Date.now() - startedAt}ms`);
}

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

function extractPdfDateText(text: string) {
  const match = String(text || "").match(/\[\[PDF_DATE:([\s\S]*?)\]\]/);
  return match?.[1]?.trim() || "";
}

function formatPdfFileDate(value: string | null | undefined) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    const today = new Date();

    return [
      String(today.getDate()).padStart(2, "0"),
      String(today.getMonth() + 1).padStart(2, "0"),
      today.getFullYear(),
    ].join(".");
  }

  const date = new Date(`${cleanValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return cleanValue.replace(/\//g, ".");
  }

  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join(".");
}

function getSafeFilePart(value: string | null | undefined, fallback: string) {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ");
}

function formatReportTypeForFileName(value: string | null | undefined) {
  return String(value || "Letter")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function getDraftAppointmentDate(draft: any) {
  const rawJson = draft?.raw_json || {};
  const rawLetterText = draft?.edited_text || draft?.ai_generated_text || "";

  return (
    draft?.appointment_date ||
    draft?.appointment_at ||
    draft?.appointment_start ||
    rawJson?.appointment_date ||
    rawJson?.appointmentDate ||
    rawJson?.appointment_at ||
    rawJson?.appointmentStart ||
    extractPdfDateText(rawLetterText)
  );
}

function getReportPdfFileName(draft: any) {
  const fileDate = formatPdfFileDate(getDraftAppointmentDate(draft));

  const patientNameParts = String(draft?.patient_name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const patientFirstName = getSafeFilePart(patientNameParts[0], "Patient");
  const patientLastName = getSafeFilePart(patientNameParts.slice(1).join(" "), "");

  const patientFileName = [patientFirstName, patientLastName]
    .filter(Boolean)
    .join(" ");

  const reportTypeFileName = getSafeFilePart(
    formatReportTypeForFileName(draft?.report_type),
    "Letter",
  );

  return `${fileDate} ${patientFileName} - ${reportTypeFileName}.pdf`;
}

function getPdfFileNameFromResponse(
  response: Response,
  fallbackFileName: string,
) {
  const contentDisposition = response.headers.get("content-disposition") || "";

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);

  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);

  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return fallbackFileName;
}

function normaliseAdditionalRecipients(value: unknown) {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();

  return value
    .map((item) => ({
      name: String(item?.name || "").trim(),
      practiceName: String(
        item?.practiceName || item?.practice_name || item?.practice || "",
      ).trim(),
      address: String(item?.address || "").trim(),
      email: String(item?.email || "").trim(),
      providerNumber: String(
        item?.providerNumber || item?.provider_number || "",
      ).trim(),
    }))
    .filter(
      (item) =>
        item.name ||
        item.practiceName ||
        item.address ||
        item.email ||
        item.providerNumber,
    )
    .filter((item) => {
      const key = [
        item.name.toLowerCase(),
        item.practiceName.toLowerCase(),
        item.email.toLowerCase(),
        item.providerNumber.toLowerCase(),
      ].join("|");

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

async function generateAndStageLetterPdf(params: {
  origin: string;
  draftId: string;
  draft: any;
}) {
  const pdfResponse = await fetch(
    `${params.origin}/api/report-writing/generate-pdf`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: params.draftId }),
    },
  );

  if (!pdfResponse.ok) {
    const errorText = await pdfResponse.text();

    throw new Error(
      `Failed to generate PDF before MediRef send: ${errorText.slice(0, 1000)}`,
    );
  }

  const fallbackFileName = getReportPdfFileName(params.draft);
  const letterFileName = getPdfFileNameFromResponse(
    pdfResponse,
    fallbackFileName,
  );

  return await stagePdf({
    buffer: Buffer.from(await pdfResponse.arrayBuffer()),
    draftId: params.draftId,
    fileName: letterFileName,
    folder: "mediref-uploads",
  });
}

export async function POST(req: Request) {
  const totalStartedAt = nowMs();
  const stagedPaths: string[] = [];

  try {
    const body = await req.json();
    const actor = await getAuditActor();

    const draftId = String(body.draftId || "").trim();
    const stagedPdf = body.stagedPdf || null;

    const referrerName = String(body.referrerName || "").trim();
    const referrerPracticeName = String(
      body.referrerPracticeName ||
        body.referrerPractice ||
        body.practiceName ||
        "",
    ).trim();

    const medirefAutoMatchRecipient = body.medirefAutoMatchRecipient !== false;
    const referrerEmail = String(body.referrerEmail || "").trim();
    const referrerProviderNumber = String(
      body.referrerProviderNumber || "",
    ).trim();
    const patientEmail = String(
      body.patientEmail || body.patient_email || "",
    ).trim();

    const additionalRecipients = normaliseAdditionalRecipients(
      body.additionalRecipients,
    );
    const additionalRecipientsText = String(
      body.additionalRecipientsText || "",
    ).trim();

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

    const draftLoadStartedAt = nowMs();

    const { data: draft, error: draftError } = await supabase
      .from("report_drafts")
      .select("*")
      .eq("id", draftId)
      .single();

    logStep("Loaded draft", draftLoadStartedAt);

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

    const patientName = String(draft.patient_name || "Patient").trim();
    const splitName = splitPatientName(patientName);

    let letterAttachment;

    const letterStartedAt = nowMs();

    const expectedLetterFileName = getReportPdfFileName(draft);

    if (stagedPdf?.bucket && stagedPdf?.storagePath) {
      letterAttachment = {
        bucket: String(stagedPdf.bucket),
        storagePath: String(stagedPdf.storagePath),
        // Keep the displayed/uploaded MediRef attachment name consistent with the
        // generate-pdf and Praktika filename, even if the staged storage path came
        // from an older filename.
        fileName: expectedLetterFileName,
        contentType: "application/pdf" as const,
      };
    } else {
      const origin = new URL(req.url).origin;

      letterAttachment = await generateAndStageLetterPdf({
        origin,
        draftId,
        draft,
      });

      stagedPaths.push(letterAttachment.storagePath);
    }

    logStep("Prepared letter attachment", letterStartedAt);

    const attachments = [letterAttachment];

    let periodontalChartAttached = false;
    let periodontalChartAttachmentName: string | null = null;
    let periodontalChartError: string | null = null;

    if (attachPeriodontalChart) {
      const perioStartedAt = nowMs();

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
          /*
            Speed optimisation:
            Generate the latest periodontal chart once only.

            Previous code tried exact appointment date first, then generated again
            without appointmentDate if no exact match was found. That can double
            the Praktika helper calls.

            This keeps Praktika and MediRef separate:
            - this route prepares the attachment
            - MediRef worker only sends PDFs
          */
          const perioChart = await generatePeriodontalChartPdf({
            patientId: finalPraktikaPatientId,
            appointmentDate: null,
            patientName,
            providerName: actor.actorFullName || null,
          });

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

      logStep("Prepared periodontal chart attachment", perioStartedAt);
    } else {
      await updatePerioStatus({
        draftId,
        attachedAt: null,
        attachmentName: null,
        error: null,
      });
    }

    const jobStartedAt = nowMs();

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
          practiceName: referrerPracticeName || null,
          email: referrerEmail || null,
          providerNumber: referrerProviderNumber || null,
        },
        medirefAutoMatchRecipient,
        attachments,
        message:
          message || `Specialist correspondence for ${patientName || "patient"}.`,
      },
      priority: 20,
    });

    logStep("Created MediRef helper job", jobStartedAt);

    const updateStartedAt = nowMs();

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
        usedExistingStagedPdf: Boolean(
          stagedPdf?.bucket && stagedPdf?.storagePath,
        ),
        recipient: {
          name: finalReferrerName,
          practiceName: referrerPracticeName || null,
          email: referrerEmail || null,
          providerNumber: referrerProviderNumber || null,
        },
        patientEmail: patientEmail || null,
        additionalRecipients,
        additionalRecipientsText,
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

    logStep("Updated draft and audit", updateStartedAt);
    logStep("TOTAL", totalStartedAt);

    return NextResponse.json({
      success: true,
      jobId: job.id,
      recipient: referrerEmail || finalReferrerName,
      periodontalChartAttached,
      periodontalChartAttachmentName,
      periodontalChartError,
      usedExistingStagedPdf: Boolean(
        stagedPdf?.bucket && stagedPdf?.storagePath,
      ),
      message: "MediRef send has been queued. The Cloud helper will process it.",
    });
  } catch (error) {
    console.error("Failed to queue MediRef send:", error);
    logStep("FAILED TOTAL", totalStartedAt);

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
          error instanceof Error ? error.message : "Failed to queue MediRef send.",
      },
      { status: 500 },
    );
  }
}