import type { MedirefHelperRequest } from "./helper-jobs";

export type RetryDraft = {
  id: string; status: string; deleted_at: string | null; updated_at: string;
  patient_name: string | null; patient_dob: string | null;
  workflow_status: string | null; workflow_mediref_status: string | null;
  emailed_to_referrer_at: string | null;
  periodontal_chart_attachment_name?: string | null;
  periodontal_chart_attachment_error?: string | null;
  periodontal_chart_attached_at?: string | null;
  workflow_periodontal_chart_status?: string | null;
};
export type RetryJob = { status: string; payload: unknown };
export class RetryError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const retryWarning = "This earlier MediRef attempt may already have attached the PDF in MediRef. Check MediRef first to avoid a duplicate attachment.\n\nRetry MediRef anyway? This will retry MediRef only. It will not re-upload the report to Praktika.";
export const activeRetryMessage = "A MediRef retry is already queued or in progress.";
export function retryDraftEligible(draft: RetryDraft) {
  return !draft.deleted_at && ["approved", "uploaded_to_praktika"].includes(draft.status) &&
    draft.workflow_status !== "running" && draft.workflow_mediref_status === "failed" &&
    !draft.emailed_to_referrer_at;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
export function buildRetryRequest(draft: RetryDraft, job: RetryJob | null, bucket: string): MedirefHelperRequest {
  if (!retryDraftEligible(draft)) throw new RetryError("This report is not eligible for MediRef retry.");
  const names = (draft.patient_name || "").trim().split(/\s+/).filter(Boolean);
  if (names.length < 2) throw new RetryError("Unable to retry MediRef: patient name is incomplete.");
  const dob = (draft.patient_dob || "").trim();
  if (!dob) throw new RetryError("Unable to retry MediRef: patient DOB is missing.");
  const payload = record(job?.payload);
  if (job?.status !== "failed" || payload.draftId !== draft.id || payload.action !== "send_letter") {
    throw new RetryError("Unable to retry MediRef: no matching failed attempt was found.");
  }
  const raw = payload.attachments;
  if (!Array.isArray(raw) || !raw.length) throw new RetryError("Unable to retry MediRef: no stored PDF attachment was found.");
  const attachments = raw.map((item) => {
    const a = record(item);
    if (a.bucket !== bucket || typeof a.storagePath !== "string" ||
      !a.storagePath.startsWith(`mediref-uploads/${draft.id}/`) || a.storagePath.split("/").includes("..") ||
      typeof a.fileName !== "string" || !a.fileName.toLowerCase().endsWith(".pdf") || /[\\/\x00-\x1f]/.test(a.fileName) ||
      a.contentType !== "application/pdf") {
      throw new RetryError("Unable to retry MediRef: stored PDF metadata is unavailable or unsupported.");
    }
    return { bucket, storagePath: a.storagePath, fileName: a.fileName, contentType: "application/pdf" as const };
  });
  const chartName = draft.periodontal_chart_attachment_name;
  const chartRequired = Boolean(chartName || draft.periodontal_chart_attachment_error ||
    draft.periodontal_chart_attached_at ||
    ["pending", "running", "completed", "failed"].includes(draft.workflow_periodontal_chart_status || ""));
  if (new Set(attachments.map(a => a.storagePath)).size !== attachments.length) {
    throw new RetryError("Unable to retry MediRef: duplicate stored PDF references.");
  }
  if (chartRequired && (!chartName || attachments.length < 2 ||
    attachments.filter(a => a.fileName === chartName).length !== 1)) {
    throw new RetryError("Unable to retry MediRef: the required periodontal chart is missing from the saved attachment package. Prepare the complete package before retrying.");
  }
  return {
    action: "send_letter", draftId: draft.id, retryMediref: true,
    patient: { firstName: names[0], lastName: names.slice(1).join(" "), dob },
    recipient: { name: "", practiceName: "", email: "", providerNumber: "" },
    medirefAutoMatchRecipient: false, attachments,
    message: typeof payload.message === "string" ? payload.message : `Specialist correspondence for ${draft.patient_name}.`,
  };
}
export const retryDraftUpdate = () => ({
  workflow_status: "running", workflow_mediref_status: "pending",
  workflow_started_at: new Date().toISOString(), workflow_completed_at: null,
  workflow_error: null, workflow_last_message: "MediRef retry queued.", updated_at: new Date().toISOString(),
});
export interface RetryStore {
  draft(id: string): Promise<RetryDraft | null>;
  active(id: string): Promise<boolean>;
  latest(id: string): Promise<RetryJob | null>;
  attachmentExists(attachment: MedirefHelperRequest["attachments"][number]): Promise<boolean>;
  claim(draft: RetryDraft, update: ReturnType<typeof retryDraftUpdate>): Promise<boolean>;
  enqueue(request: MedirefHelperRequest): Promise<{ id: string }>;
  markQueued(id: string): Promise<void>;
}
export async function prepareRetry(store: RetryStore, id: string, bucket: string) {
  const draft = await store.draft(id);
  if (!draft || draft.deleted_at) throw new RetryError("Report not found.", 404);
  if (await store.active(id)) throw new RetryError(activeRetryMessage);
  const request = buildRetryRequest(draft, await store.latest(id), bucket);
  for (const attachment of request.attachments) {
    if (!await store.attachmentExists(attachment)) throw new RetryError("Unable to retry MediRef: no stored PDF attachment was found.");
  }
  console.log("[MediRef retry] attachment_set_resolved", {
    attachmentCount: request.attachments.length,
    includesPeriodontalChart: Boolean(draft.periodontal_chart_attachment_name &&
      request.attachments.some(a => a.fileName === draft.periodontal_chart_attachment_name)),
  });
  return { draft, request };
}
export async function queueRetry(store: RetryStore, id: string, bucket: string) {
  const { draft, request } = await prepareRetry(store, id, bucket);
  // Compare-and-set in the database, not a process-local lock: only one retry can claim this failed state.
  if (!await store.claim(draft, retryDraftUpdate())) throw new RetryError(activeRetryMessage);
  // Fail closed after claiming. An insertion/network error can have an ambiguous commit outcome;
  // restoring 'failed' would allow another click to create a duplicate job.
  try {
    if (await store.active(id)) throw new RetryError(activeRetryMessage);
    console.log("[MediRef retry] job_payload_ready", { attachmentCount: request.attachments.length, includesPeriodontalChart: Boolean(draft.periodontal_chart_attachment_name && request.attachments.some(a => a.fileName === draft.periodontal_chart_attachment_name)) });
    const job = await store.enqueue(request);
    await store.markQueued(id);
    console.log("[MediRef retry] helper_job_created", { jobId: job.id, attachmentCount: request.attachments.length });
    return { ok: true, message: "MediRef retry queued.", jobId: job.id };
  } catch {
    throw new RetryError("MediRef retry could not be confirmed. Check the queue before trying again; further retries are blocked to prevent duplicates.", 503);
  }
}
