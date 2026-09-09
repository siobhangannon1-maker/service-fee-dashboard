import type { SupabaseClient } from "@supabase/supabase-js";

export async function claimWorkflowStart(db: SupabaseClient, draftId: string, update: Record<string, unknown>) {
  return await db.from("report_drafts").update(update).eq("id", draftId)
    .is("deleted_at", null).in("status", ["approved", "uploaded_to_praktika"])
    .or("workflow_status.is.null,workflow_status.neq.running").select("*").maybeSingle();
}

export async function performQueuedIconAction<T>(actions: {
  deadlineMs?: number;
  enqueue: () => Promise<{ id: string }>;
  markRunning: () => Promise<void>;
  wait: (id: string) => Promise<T>;
}) {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const job = await actions.enqueue();
        if (expired) throw new Error("Appointment icon job creation timed out.");
        await actions.markRunning();
        return await actions.wait(job.id);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error("Appointment icon job did not finish within the allowed time."));
        }, actions.deadlineMs ?? 30000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function runCompleteWorkflowIconStep(
  draftId: string,
  target: { queueId: string | null; praktikaPatientId: string },
  request: typeof fetch = fetch,
) {
  async function status(values: Record<string, unknown>) {
    const response = await request("/api/report-writing/workflow-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, ...values }), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error("Could not save icon workflow status.");
  }
  try {
    await status({ praktikaUploadStatus: "completed", iconUpdateStatus: "pending",
      message: "PDF uploaded to Praktika. Checking for an appointment icon to update." });
    const response = await request("/api/report-writing/update-praktika-letter-icons", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId, ...target }), signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    if (!response.ok || !data.success || data.error) throw new Error("Appointment icon update failed or timed out.");
    const skipped = data.skipped === true || data.iconUpdated === false;
    if (!skipped && data.iconUpdated !== true) throw new Error("Appointment icon result could not be confirmed.");
    await status({ iconUpdateStatus: skipped ? "skipped" : "completed",
      message: skipped ? "No eligible appointment icon found. Queuing MediRef." : "Praktika icon updated. Queuing MediRef." });
  } catch {
    await status({ workflowStatus: "failed", iconUpdateStatus: "failed",
      workflowError: "Appointment icon update could not be completed. Check the helper queue before retrying.",
      message: "PDF uploaded to Praktika, but the appointment icon step failed." });
    throw new Error("Appointment icon update could not be completed. Check the helper queue before retrying.");
  }
}
