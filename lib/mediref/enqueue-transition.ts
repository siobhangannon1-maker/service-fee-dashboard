import type { MedirefHelperRequest } from "./helper-jobs";

export const enqueueFailure = "MediRef preparation or queueing failed. Check the helper queue before trying again.";
export class EnqueueBusy extends Error {}
export function validateMedirefRequest(request: MedirefHelperRequest) {
  if (!request.patient.firstName.trim() || !request.patient.lastName.trim() || !request.patient.dob?.trim()) throw new Error(enqueueFailure);
  const dob = request.patient.dob.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const au = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(dob);
  const date = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : au ? [Number(au[3]), Number(au[2]), Number(au[1])] : null;
  if (!date) throw new Error(enqueueFailure);
  const parsed = new Date(0); parsed.setUTCFullYear(date[0], date[1] - 1, date[2]);
  if (parsed.getUTCFullYear() !== date[0] || parsed.getUTCMonth() !== date[1] - 1 || parsed.getUTCDate() !== date[2]) throw new Error(enqueueFailure);
  if (!request.attachments.length || request.attachments.some((a) => !a.bucket || !a.storagePath || !a.fileName || a.contentType !== "application/pdf")) throw new Error(enqueueFailure);
}

export async function enqueueMedirefTransition<T extends { request: MedirefHelperRequest }>(actions: {
  active: () => Promise<{ id: string } | null>;
  claim: () => Promise<boolean>;
  prepare: (signal: AbortSignal) => Promise<T>;
  insert: (request: MedirefHelperRequest) => Promise<{ id: string }>;
  running: (job: { id: string }, prepared: T) => Promise<void>;
  failed: (insertionAttempted: boolean) => Promise<void>;
  deadlineMs?: number;
}) {
  const controller = new AbortController();
  let claimed = false; let insertionAttempted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const existing = await actions.active();
        controller.signal.throwIfAborted();
        if (existing) return { job: existing, prepared: null, reused: true };
        claimed = await actions.claim();
        if (!claimed) throw new EnqueueBusy("MediRef preparation is already in progress or the report changed. Refresh its status.");
        if (controller.signal.aborted) {
          await actions.failed(false);
          controller.signal.throwIfAborted();
        }
        const prepared = await actions.prepare(controller.signal);
        controller.signal.throwIfAborted();
        validateMedirefRequest(prepared.request);
        const active = await actions.active();
        controller.signal.throwIfAborted();
        if (active) {
          await actions.running(active, prepared);
          return { job: active, prepared: null, reused: true };
        }
        insertionAttempted = true;
        const job = await actions.insert(prepared.request);
        controller.signal.throwIfAborted();
        await actions.running(job, prepared);
        return { job, prepared, reused: false };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error(enqueueFailure)); }, actions.deadlineMs ?? 90000);
      }),
    ]);
  } catch (error) {
    controller.abort();
    if (claimed) await actions.failed(insertionAttempted);
    throw error instanceof EnqueueBusy ? error : new Error(enqueueFailure);
  } finally { clearTimeout(timer); }
}

export async function requestMedirefEnqueue(draftId: string, payload: Record<string, unknown>, request: typeof fetch = fetch) {
  try {
    const response = await request("/api/report-writing/send-via-mediref", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, draftId }), signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    if (response.status === 409) throw new EnqueueBusy("MediRef preparation is already in progress. Refresh its status.");
    if (!response.ok || !data.success || !data.jobId) throw new Error(enqueueFailure);
    return data;
  } catch (error) {
    if (error instanceof EnqueueBusy) throw error;
    // A lost response is not proof insertion failed. Reconcile against the trusted queue first.
    const response = await request("/api/report-writing/workflow-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, failMedirefEnqueue: true }), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (response.ok && data.success && data.jobId) return { success: true, jobId: data.jobId, reused: true };
    throw new Error(enqueueFailure);
  }
}
