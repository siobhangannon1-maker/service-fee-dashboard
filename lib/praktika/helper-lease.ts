import type { SupabaseClient } from "@supabase/supabase-js";

export const PRAKTIKA_HELPER_HEARTBEAT_MS = 15_000;
// Must match the database-clock lease in 202609090001_praktika_helper_lease.sql.
export const PRAKTIKA_HELPER_LEASE_MS = 90_000;
export const PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS = 5_000;
export class PraktikaOwnershipLost extends Error {
  constructor() { super("Praktika helper ownership is unavailable or expired."); }
}
export type HelperHealth = import("./authentication").ExperimentalEvidence & { helper_instance_id?: string | null; helper_heartbeat_at?: string | null; authenticated_at?: string | null };
export function hasLivePraktikaHelper(row: HelperHealth, now = Date.now()) {
  const time = Date.parse(row.helper_heartbeat_at || "");
  return Boolean(row.helper_instance_id && Number.isFinite(time) && time <= now && now - time < PRAKTIKA_HELPER_LEASE_MS);
}
export async function claimPraktikaHelper(db: SupabaseClient, sessionId: string): Promise<string | null> {
  const { data, error } = await db.rpc("claim_praktika_helper", { p_session_id: sessionId })
    .abortSignal(AbortSignal.timeout(PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS));
  if (error) throw new Error("Could not claim Praktika helper ownership.");
  return data as string | null;
}
export async function writePraktikaHelper(db: SupabaseClient, sessionId: string, instanceId: string,
  action: "check" | "heartbeat" | "update" | "release" | "authenticate" | "authentication_failed", values: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc("praktika_helper_write", {
    p_session_id: sessionId, p_instance_id: instanceId, p_action: action, p_values: values,
  }).abortSignal(AbortSignal.timeout(PRAKTIKA_BROWSER_LIVENESS_TIMEOUT_MS));
  if (error || data !== true) throw new PraktikaOwnershipLost();
}
export interface PraktikaJobOwnership {
  isShuttingDown?(): boolean;
  assertOwned(): Promise<void>;
  ensureAuthenticated(): Promise<void>;
  updateSession(values: Record<string, unknown>): Promise<void>;
}
