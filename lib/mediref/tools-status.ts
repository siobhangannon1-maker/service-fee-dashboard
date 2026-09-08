// Explicit projection: raw messages/errors/URLs can contain patient data or browser diagnostics.
const sessionMessages: Record<string, string> = {
  connected: "Practice MediRef session is connected.",
  refreshing: "MediRef connection is refreshing.", refresh_requested: "MediRef reconnect requested.",
  waiting_for_credentials: "MediRef needs sign-in through the existing connection tools.",
  waiting_for_mfa: "MediRef needs verification through the existing connection tools.",
  expired: "MediRef needs reconnecting.", not_started: "MediRef session has not started.",
  error: "MediRef connection reported an error.",
};
type Row = Record<string, unknown> | null;
function timestamp(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}
export function safeToolsStatus(session: Row, job: Row) {
  const status = typeof session?.status === "string" && Object.hasOwn(sessionMessages, session.status) ? session.status : "unknown";
  const jobStatus = typeof job?.status === "string" && ["pending", "processing", "completed", "failed"].includes(job.status) ? job.status : "unknown";
  return {
    ok: true,
    session: { status, message: sessionMessages[status] || "MediRef connection status is unknown.",
      refreshedAt: timestamp(session?.refreshed_at), lastUsedAt: timestamp(session?.last_used_at), updatedAt: timestamp(session?.updated_at) },
    latestJob: job ? { status: jobStatus, jobType: job.job_type === "send_mediref_letter" ? "send_mediref_letter" : "unknown",
      error: jobStatus === "failed" ? (job.error === "Unable to enter patient DOB in MediRef date control" ? "Unable to enter patient DOB in MediRef date control" : "MediRef job failed. Detailed diagnostics are available in Render.") : null,
      createdAt: timestamp(job.created_at), updatedAt: timestamp(job.updated_at) } : null,
    // The worker currently stores only a generic DOB error, not the detailed failure stage.
    failureStage: null,
  };
}
export type ToolsStatus = ReturnType<typeof safeToolsStatus>;
