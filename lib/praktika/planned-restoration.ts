import type { SupabaseClient } from "@supabase/supabase-js";
import { PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS } from "./helper-lease";

export type RestorationClaim = { instance_id: string; idle_remaining_ms: number };
export async function claimPlannedRestoration(db: SupabaseClient, sessionId: string, source: string): Promise<RestorationClaim | null> {
  const started = performance.now();
  const { data, error } = await db.rpc("claim_praktika_restoration", {
    p_session_id: sessionId, p_source_instance_id: source,
  }).abortSignal(AbortSignal.timeout(PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS));
  if (error) throw new Error("Restoration claim unavailable");
  if (!data) return null;
  return { instance_id: data.instance_id, idle_remaining_ms: Math.max(0, Number(data.idle_remaining_ms) - (performance.now() - started)) };
}

export async function requestPlannedRestoration(db: SupabaseClient, sessionId: string, owner: string, remainingMs: number) {
  const { data, error } = await db.rpc("request_praktika_restoration", {
    p_session_id: sessionId, p_instance_id: owner, p_idle_remaining_ms: Math.floor(remainingMs),
  }).abortSignal(AbortSignal.timeout(PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS));
  if (error) throw new Error("Restoration request unavailable");
  return data === true;
}

// Positive operational history is established by this running helper, never
// reconstructed from a historical row by the watcher.
export function mayRestoreAfterShutdown(planned: boolean, operational: boolean, unresolved: boolean, remainingMs: number) {
  return planned && operational && !unresolved && Number.isFinite(remainingMs) && remainingMs > 0;
}
