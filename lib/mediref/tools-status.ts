// Explicit projection: raw messages/errors/URLs can contain patient data or browser diagnostics.
const sessionMessages: Record<string, string> = {
  connected: "Practice MediRef authentication was verified within the last five minutes. This does not guarantee the browser is still running.",
  ready: "MediRef session is configured, but authentication has not been verified recently. The helper may need to sign in when work arrives.",
  sleeping: "MediRef helper stopped cleanly and can restart when work arrives.",
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
// Use authentication refresh evidence, never generic activity or stored credentials/cookies.
export function hasRecentMedirefAuthentication(session: Row, now = Date.now()) {
  const refreshed = timestamp(session?.refreshed_at);
  const age = refreshed ? now - Date.parse(refreshed) : Infinity;
  return session?.status === "connected" && age >= 0 && age < 5 * 60 * 1000;
}
export function safeToolsStatus(session: Row, job: Row, now = Date.now()) {
  const storedStatus = typeof session?.status === "string" && Object.hasOwn(sessionMessages, session.status) ? session.status : "unknown";
  const status = storedStatus === "connected" && !hasRecentMedirefAuthentication(session, now) ? "ready" :
    storedStatus === "ready" ? "sleeping" : storedStatus;
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
