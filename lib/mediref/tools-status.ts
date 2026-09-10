import { MEDIREF_AUTH_FRESHNESS_MS, MEDIREF_LEASE_MS } from "./helper-generation";
// Explicit projection: raw messages/errors/URLs can contain patient data or browser diagnostics.
const sessionMessages: Record<string, string> = {
  connected: "The current practice MediRef helper is authenticated.",
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
function connectionEvidence(session: Row, now: number) {
  const expiry = timestamp(session?.helper_expires_at);
  const heartbeat = timestamp(session?.helper_heartbeat_at);
  const authenticated = timestamp(session?.authenticated_at);
  const owner = session?.helper_instance_id;
  const live = typeof owner === "string" && !!owner && !session?.helper_stopping_at && !!expiry && !!heartbeat &&
    Date.parse(heartbeat) <= now && now - Date.parse(heartbeat) < MEDIREF_LEASE_MS && Date.parse(expiry) > now;
  const proof = live && session?.authenticated_instance_id === owner && !!authenticated && Date.parse(authenticated) <= now;
  const validForMs = proof ? Math.max(0, Math.min(Date.parse(expiry!) - now, Date.parse(heartbeat!) + MEDIREF_LEASE_MS - now, Date.parse(authenticated!) + MEDIREF_AUTH_FRESHNESS_MS - now)) : 0;
  return { live, validForMs: session?.status === "connected" ? validForMs : 0 };
}
export function hasRecentMedirefAuthentication(session: Row, now = Date.now()) {
  return connectionEvidence(session, now).validForMs > 0;
}
export function safeToolsStatus(session: Row, job: Row, now = Date.now()) {
  const storedStatus = typeof session?.status === "string" && Object.hasOwn(sessionMessages, session.status) ? session.status : "unknown";
  const evidence = connectionEvidence(session, now);
  const status = storedStatus === "connected" && !hasRecentMedirefAuthentication(session, now) ? "ready" :
    storedStatus === "refreshing" && !evidence.live ? "not_started" : storedStatus === "ready" ? "sleeping" : storedStatus;
  const jobStatus = typeof job?.status === "string" && ["pending", "processing", "completed", "failed"].includes(job.status) ? job.status : "unknown";
  return {
    ok: true,
    session: { status, validForMs: evidence.validForMs, helperAlive: evidence.live, message: sessionMessages[status] || "MediRef connection status is unknown.",
      refreshedAt: timestamp(session?.refreshed_at), lastUsedAt: timestamp(session?.last_used_at), updatedAt: timestamp(session?.updated_at) },
    latestJob: job ? { status: jobStatus, jobType: job.job_type === "send_mediref_letter" ? "send_mediref_letter" : "unknown",
      error: jobStatus === "failed" ? (job.error === "Unable to enter patient DOB in MediRef date control" ? "Unable to enter patient DOB in MediRef date control" : "MediRef job failed. Detailed diagnostics are available in Render.") : null,
      createdAt: timestamp(job.created_at), updatedAt: timestamp(job.updated_at) } : null,
    // The worker currently stores only a generic DOB error, not the detailed failure stage.
    failureStage: null,
  };
}
export type ToolsStatus = ReturnType<typeof safeToolsStatus>;
