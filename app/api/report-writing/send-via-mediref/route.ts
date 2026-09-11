import { currentWorkflowExecution } from "@/lib/report-writing/workflow-execution-context";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSendMedirefLetterJob } from "@/lib/mediref/helper-job-client";
import {
  createReportAuditEvent,
  getAuditActor,
} from "@/lib/report-writing/audit";
import { enqueueMedirefTransition, enqueueFailure, EnqueueBusy, createEnqueueDiagnostics, type EnqueueDiagnostics } from "@/lib/mediref/enqueue-transition";
import { getUserStatus } from "@/lib/getUserStatus";
import type { MedirefHelperRequest } from "@/lib/mediref/helper-jobs";
import { generatePeriodontalChartPdf } from "@/lib/praktika/periodontal-chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELPER_UPLOAD_BUCKET =
  process.env.MEDIREF_HELPER_UPLOAD_BUCKET || "report-assets";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

type StagedPdfAttachment = {
  bucket: string;
  storagePath: string;
  fileName: string;
  contentType: "application/pdf";
};

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

function getSafeFilePart(
  value: string | null | undefined,
  fallback: string,
) {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ");
}

function formatReportTypeForFileName(
  value: string | null | undefined,
) {
  return String(value || "Letter")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function getDraftAppointmentDate(draft: any) {
  const rawJson = draft?.raw_json || {};
  const rawLetterText =
    draft?.edited_text || draft?.ai_generated_text || "";

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

  const patientFirstName = getSafeFilePart(
    patientNameParts[0],
    "Patient",
  );

  const patientLastName = getSafeFilePart(
    patientNameParts.slice(1).join(" "),
    "",
  );

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
  const contentDisposition =
    response.headers.get("content-disposition") || "";

  const utf8Match = contentDisposition.match(
    /filename\*=UTF-8''([^;]+)/i,
  );

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const quotedMatch = contentDisposition.match(
    /filename="([^"]+)"/i,
  );

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
        item?.practiceName ||
          item?.practice_name ||
          item?.practice ||
          "",
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

      if (seen.has(key)) {
        return false;
      }

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
  const { error } = await supabase
    .from("report_drafts")
    .update({
      periodontal_chart_attached_at: params.attachedAt || null,
      periodontal_chart_attachment_name:
        params.attachmentName || null,
      periodontal_chart_attachment_error: params.error || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.draftId);

  if (error) {
    console.error("[MediRef enqueue] periodontal_status_update_failed");
  }
}

/**
 * Uploads a PDF into the dedicated MediRef staging folder.
 *
 * All PDFs required by the MediRef worker should ultimately be stored at:
 *
 * report-assets/mediref-uploads/{draftId}/...
 *
 * This prevents MediRef from depending on Praktika's temporary files.
 */
async function stagePdf(params: {
  buffer: Buffer;
  draftId: string;
  fileName: string;
  folder: string;
  diagnostics: EnqueueDiagnostics;
}): Promise<StagedPdfAttachment> {
  params.diagnostics.setStage("pdf_validation");
  if (!params.buffer.length || params.buffer.length < 1000) {
    throw new Error(
      `Could not stage PDF for MediRef because the PDF looks empty or invalid. Size: ${params.buffer.length} bytes.`,
    );
  }

  const storagePath = `${params.folder}/${params.draftId}/${Date.now()}-${
    params.fileName
  }`;


  params.diagnostics.setStage("storage_upload");
  const { error: uploadError } = await supabase.storage
    .from(HELPER_UPLOAD_BUCKET)
    .upload(storagePath, params.buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Could not stage PDF for MediRef: ${uploadError.message}`,
    );
  }

  /*
   * Read the file back immediately.
   *
   * This ensures the MediRef helper job is never created with a path
   * that does not actually exist in Supabase Storage.
   */
  params.diagnostics.setStage("storage_verification");
  const { data: storedPdf, error: verifyError } =
    await supabase.storage
      .from(HELPER_UPLOAD_BUCKET)
      .download(storagePath);

  if (verifyError || !storedPdf) {
    await supabase.storage
      .from(HELPER_UPLOAD_BUCKET)
      .remove([storagePath])
      .catch(() => null);

    throw new Error(
      `PDF was uploaded for MediRef but could not be read back: ${
        verifyError?.message || "No file returned."
      }`,
    );
  }

  if (!storedPdf.size || storedPdf.size < 1000) {
    await supabase.storage
      .from(HELPER_UPLOAD_BUCKET)
      .remove([storagePath])
      .catch(() => null);

    throw new Error(
      `PDF was uploaded for MediRef but the stored file looks invalid. Size: ${
        storedPdf.size || 0
      } bytes.`,
    );
  }

  return {
    bucket: HELPER_UPLOAD_BUCKET,
    storagePath,
    fileName: params.fileName,
    contentType: "application/pdf",
  };
}

async function generateAndStageLetterPdf(params: {
  origin: string;
  draftId: string;
  draft: any;
  signal: AbortSignal;
  diagnostics: EnqueueDiagnostics;
}): Promise<StagedPdfAttachment> {
  params.diagnostics.setStage("pdf_generation");
  const pdfResponse = await fetch(
    `${params.origin}/api/report-writing/generate-pdf`,
    {
      signal: params.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        draftId: params.draftId,
      }),
    },
  );

  if (!pdfResponse.ok) {
    const errorText = await pdfResponse.text();

    throw new Error(
      `Failed to generate PDF before MediRef send: ${errorText.slice(
        0,
        1000,
      )}`,
    );
  }

  params.diagnostics.setStage("pdf_validation");
  const pdfBuffer = Buffer.from(
    await pdfResponse.arrayBuffer(),
  );

  if (!pdfBuffer.length || pdfBuffer.length < 1000) {
    throw new Error(
      `Generated MediRef letter PDF looks empty or invalid. Size: ${pdfBuffer.length} bytes.`,
    );
  }

  const fallbackFileName = getReportPdfFileName(params.draft);

  const letterFileName = getPdfFileNameFromResponse(
    pdfResponse,
    fallbackFileName,
  );

  return await stagePdf({
    diagnostics: params.diagnostics,
    buffer: pdfBuffer,
    draftId: params.draftId,
    fileName: letterFileName,
    folder: "mediref-uploads",
  });
}

export async function POST(req: Request) {
  const totalStartedAt = nowMs();

  /*
   * These paths contain only PDFs created in the MediRef staging bucket
   * during this request.
   *
   * They are removed only if the request fails before the helper job
   * is successfully created.
   */
  const stagedPaths: string[] = [];

  const diagnostics = createEnqueueDiagnostics();
  let draftIdPresent = false;
  let medirefJobCreated = false;
  let insertionAttempted = false;

  try {
    const body = await req.json();
    draftIdPresent = Boolean(body?.draftId);
    const actor = await getAuditActor();
    if (!actor.actorUserId || !await getUserStatus(actor.actorUserId)) {
      return NextResponse.json({ success: false, error: "An active login is required." }, { status: 403 });
    }

    const draftId = String(body.draftId || "").trim();

    const referrerName = String(
      body.referrerName || "",
    ).trim();

    const referrerPracticeName = String(
      body.referrerPracticeName ||
        body.referrerPractice ||
        body.practiceName ||
        "",
    ).trim();

    const medirefAutoMatchRecipient =
      body.medirefAutoMatchRecipient !== false;

    const referrerEmail = String(
      body.referrerEmail || "",
    ).trim();

    const referrerProviderNumber = String(
      body.referrerProviderNumber || "",
    ).trim();

    const patientEmail = String(
      body.patientEmail || body.patient_email || "",
    ).trim();

    const additionalRecipients =
      normaliseAdditionalRecipients(
        body.additionalRecipients,
      );

    const additionalRecipientsText = String(
      body.additionalRecipientsText || "",
    ).trim();

    const message = String(body.message || "").trim();

    const attachPeriodontalChart = Boolean(
      body.attachPeriodontalChart,
    );

    const requestedPraktikaPatientId = String(
      body.praktikaPatientId ||
        body.praktika_patient_id ||
        body.patientId ||
        "",
    ).trim();

    if (!draftId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing draftId.",
        },
        {
          status: 400,
        },
      );
    }

    const draftLoadStartedAt = nowMs();

    const { data: draft, error: draftError } =
      await supabase
        .from("report_drafts")
        .select("*")
        .eq("id", draftId)
        .is("deleted_at", null)
        .single();

    logStep("Loaded draft", draftLoadStartedAt);

    if (draftError || !draft) {
      return NextResponse.json(
        {
          success: false,
          error: "Draft not found.",
        },
        {
          status: 404,
        },
      );
    }

    if (
      draft.status !== "approved" &&
      draft.status !== "uploaded_to_praktika"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only approved reports can be sent through MediRef.",
        },
        {
          status: 400,
        },
      );
    }

    const finalReferrerName =
      referrerName ||
      String(draft.referrer_name || "").trim();

    const patientName = String(
      draft.patient_name || "Patient",
    ).trim();

    const splitName = splitPatientName(patientName);

    const claimId = `mediref:preparing:${crypto.randomUUID()}`;
    async function activeJob() {
      const { data, error } = await supabase.from("mediref_helper_jobs").select("id")
        .eq("job_type", "send_mediref_letter").eq("payload->>draftId", draftId)
        .in("status", ["pending", "processing"]).order("created_at", { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(10000)).maybeSingle();
      if (error) throw new Error(enqueueFailure);
      return data;
    }
    const transition = await enqueueMedirefTransition({
      diagnostics,
      active: activeJob,
      claim: async () => {
        const { data, error } = await supabase.from("report_drafts").update({
          workflow_status: "running", workflow_mediref_status: "pending",
          workflow_last_message: "Preparing MediRef send.", workflow_error: null,
          emailed_to_referrer_resend_id: claimId, updated_at: new Date().toISOString(),
        }).eq("id", draftId).eq("updated_at", draft.updated_at).is("deleted_at", null)
          .in("status", ["approved", "uploaded_to_praktika"])
          .or("emailed_to_referrer_resend_id.is.null,emailed_to_referrer_resend_id.not.like.mediref:preparing:%")
          .select("id").abortSignal(AbortSignal.timeout(10000)).maybeSingle();
        if (error) throw new Error(enqueueFailure);
        return Boolean(data);
      },
      prepare: async (signal) => {
        diagnostics.setStage("patient_validation");
        if (!splitName.firstName || !splitName.lastName || !draft.patient_dob) throw new Error(enqueueFailure);
        const letterStartedAt = nowMs();

        /*
         * MediRef always generates and stages its own PDF in report-assets.
         *
         * Do not reuse Praktika's temporary staged file. The Praktika helper may
         * remove that object as soon as its upload finishes, which can leave the
         * MediRef workflow pointing to a path that no longer exists.
         */
        const origin = new URL(req.url).origin;

        const letterAttachment =
          await generateAndStageLetterPdf({
            diagnostics,
            origin,
            draftId,
            draft,
            signal,
          });

        stagedPaths.push(letterAttachment.storagePath);
        signal.throwIfAborted();

        const usedExistingStagedPdf = false;

        logStep(
          "Prepared letter attachment",
          letterStartedAt,
        );

        const attachments: StagedPdfAttachment[] = [
          letterAttachment,
        ];

        diagnostics.setStage("periodontal_preparation");
        let periodontalChartStaged = false;

        let periodontalChartAttachmentName:
          | string
          | null = null;

        let periodontalChartError: string | null =
          null;

        if (attachPeriodontalChart) {
          const perioStartedAt = nowMs();

          const finalPraktikaPatientId =
            requestedPraktikaPatientId ||
            String(
              draft.praktika_patient_id || "",
            ).trim();

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
              const perioChart =
                await generatePeriodontalChartPdf({
                  freshness: "prefer_cached", // Existing completed exams are permitted for this attachment.
                  patientId: finalPraktikaPatientId,
                  appointmentDate: null,
                  patientName,
                  providerName:
                    actor.actorFullName || null,
                });

              if (perioChart) {
                const perioAttachment =
                  await stagePdf({
                    diagnostics,
                    buffer: perioChart.buffer,
                    draftId,
                    fileName: perioChart.fileName,
                    folder: "mediref-uploads",
                  });

                stagedPaths.push(
                  perioAttachment.storagePath,
                );

                attachments.push(perioAttachment);

                periodontalChartStaged = true;

                periodontalChartAttachmentName =
                  perioChart.fileName;

                await updatePerioStatus({
                  draftId,
                  // Staging is not confirmation that MediRef saved the chart.
                  attachedAt: null,
                  attachmentName:
                    perioChart.fileName,
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
              // Queued Complete Workflow must retain a requested attachment on read uncertainty.
              // Existing non-continuation preparation behavior remains unchanged.
              if (currentWorkflowExecution()) throw new Error("Periodontal chart is temporarily unavailable.");
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

          logStep(
            "Prepared periodontal chart attachment",
            perioStartedAt,
          );
        } else {
          await updatePerioStatus({
            draftId,
            attachedAt: null,
            attachmentName: null,
            error: null,
          });
        }


        if (currentWorkflowExecution() && attachPeriodontalChart && !periodontalChartStaged) {
          throw new Error("Periodontal chart is temporarily unavailable.");
        }
        signal.throwIfAborted();
        return { request: {
          action: "send_letter",
          ...(currentWorkflowExecution() ? { workflowContinuationId: currentWorkflowExecution()!.intentId } : {}),
          draftId,
          patient: {
            firstName: splitName.firstName,
            lastName: splitName.lastName,
            dob: draft.patient_dob || null,
          },
          recipient: {
            // The helper-job request type requires strings here.
            // Empty strings explicitly mean that recipient matching is disabled.
            name: "",
            practiceName: "",
            email: "",
            providerNumber: "",
          },
          medirefAutoMatchRecipient: false,
          attachments,
          message:
            message ||
            `Specialist correspondence for ${
              patientName || "patient"
            }.`,
        } satisfies MedirefHelperRequest,
          letterAttachment, usedExistingStagedPdf, attachments, periodontalChartStaged,
          periodontalChartAttachmentName, periodontalChartError };
      },
      insert: async (request) => {
        const jobStartedAt = nowMs();
        insertionAttempted = true;
        const job = await createSendMedirefLetterJob({ request, priority: 20 });
        medirefJobCreated = true;
        logStep("Created MediRef helper job", jobStartedAt);
        return job;
      },
      running: async (job) => {
        // The worker may already have completed/failed. Never overwrite its terminal status.
        const active = await activeJob();
        if (!active || active.id !== job.id) return;
        const { error } = await supabase.from("report_drafts").update({
          emailed_to_referrer_at: null, emailed_to_referrer_email: referrerEmail || finalReferrerName || null,
          emailed_to_referrer_resend_id: `mediref:${job.id}`,
          emailed_by_initials: actor.actorInitials, emailed_by_name: actor.actorFullName,
          workflow_mediref_status: "running", workflow_completed_at: null, workflow_error: null,
          workflow_last_message: "MediRef helper job queued. Waiting for the helper.", updated_at: new Date().toISOString(),
        }).eq("id", draftId).eq("emailed_to_referrer_resend_id", claimId)
          .eq("workflow_status", "running").eq("workflow_mediref_status", "pending")
          .abortSignal(AbortSignal.timeout(10000));
        if (error) throw new Error(enqueueFailure);
      },
      failed: async (attempted) => {
        const active = await activeJob();
        if (active) return; // An insert may have committed despite a lost HTTP response.
        const { error } = await supabase.from("report_drafts").update({
          workflow_status: "failed", workflow_mediref_status: "failed", workflow_error: enqueueFailure,
          workflow_last_message: "MediRef preparation or queueing failed.", updated_at: new Date().toISOString(),
          // Retain an uncertain insert claim to prevent duplicate jobs after a lost response.
          ...(!attempted ? { emailed_to_referrer_resend_id: draft.emailed_to_referrer_resend_id || null } : {}),
        }).eq("id", draftId).eq("emailed_to_referrer_resend_id", claimId)
          .eq("workflow_mediref_status", "pending").abortSignal(AbortSignal.timeout(10000));
        if (error) throw new Error(enqueueFailure);
      },
    });
    const { job } = transition;
    if (!transition.prepared) return NextResponse.json({ success: true, jobId: job.id, reused: true, message: "MediRef helper job is already queued or processing." });
    const { letterAttachment, usedExistingStagedPdf, attachments, periodontalChartStaged,
      periodontalChartAttachmentName, periodontalChartError } = transition.prepared;
    const updateStartedAt = nowMs();

    await createReportAuditEvent({
      reportDraftId: draft.id,
      providerId: draft.provider_id,
      patientName: draft.patient_name,
      action: "Queued MediRef send",
      details: {
        jobId: job.id,
        usedExistingStagedPdf,
        originalStagedPdf: null,
        recipient: null,
        recipientMatchingSkipped: true,
        patientEmail: patientEmail || null,
        additionalRecipients,
        additionalRecipientsText,
        attachments: attachments.map(
          (item) => ({
            bucket: item.bucket,
            fileName: item.fileName,
            storagePath: item.storagePath,
          }),
        ),
        periodontalChartAttached: false,
        periodontalChartStaged,
        periodontalChartAttachmentName,
        periodontalChartError,
        actorInitials:
          actor.actorInitials,
        actorFullName:
          actor.actorFullName,
      },
    });

    logStep(
      "Updated draft and audit",
      updateStartedAt,
    );

    logStep("TOTAL", totalStartedAt);

    return NextResponse.json({
      success: true,
      jobId: job.id,
      recipient:
        referrerEmail || finalReferrerName,
      periodontalChartAttached: false,
      periodontalChartStaged,
      periodontalChartAttachmentName,
      periodontalChartError,
      usedExistingStagedPdf,
      letterAttachment: {
        bucket: letterAttachment.bucket,
        storagePath:
          letterAttachment.storagePath,
        fileName: letterAttachment.fileName,
      },
      message:
        "MediRef send has been queued. The Cloud helper will process it.",
    });
  } catch (error) {
    const failure = diagnostics.failure();
    const insertionOutcome = insertionAttempted ? "unconfirmed" : "not_attempted";
    console.error("[MediRef enqueue] failed", { draftIdPresent, ...failure, insertionOutcome });

    logStep("FAILED TOTAL", totalStartedAt);

    /*
     * Delete MediRef staging files only when no helper job was created.
     *
     * Once a helper job exists, the worker still needs these PDFs.
     */
    if (
      !medirefJobCreated && !insertionAttempted &&
      stagedPaths.length > 0
    ) {
      const { error: cleanupError } =
        await supabase.storage
          .from(HELPER_UPLOAD_BUCKET)
          .remove(stagedPaths);

      if (cleanupError) {
        console.error("[MediRef enqueue] staging_cleanup_failed");
      }
    }

    return NextResponse.json(
      {
        success: false,
        ...failure,
        insertionOutcome,
        error: error instanceof EnqueueBusy ? "Another preparation for this letter is already in progress." : failure.message,
        message: error instanceof EnqueueBusy ? "Another preparation for this letter is already in progress." : failure.message,
      },
      {
        status: error instanceof EnqueueBusy ? 409 : !failure.deadlineExceeded && (failure.stage === "patient_validation" || failure.stage === "attachment_validation") ? 400 : 500,
      },
    );
  }
}