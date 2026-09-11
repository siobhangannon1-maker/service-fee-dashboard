import type { SupabaseClient } from "@supabase/supabase-js";
import { derivePraktikaConnection } from "../praktika/authentication";

export const praktikaConnectionRequired = "Praktika connection required. Please connect to Praktika and try again.";

// Read only: never creates a session or falls back to another user's helper.
export async function isUserPraktikaReady(db: SupabaseClient, appUserId: string) {
  if (!appUserId) return false;
  const { data, error } = await db.from("praktika_sessions")
    .select("status,authenticated_at,helper_heartbeat_at,helper_instance_id,current_url,app_user_id,experimental_auth_status,experimental_auth_at,experimental_helper_instance_id")
    .eq("scope", "user").eq("app_user_id", appUserId)
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  return !error && !!data && derivePraktikaConnection(data).connected;
}

// Queue acceptance is distinct from write readiness. It cannot authorize a request.
export async function canQueueUserPraktikaWorkflow(db: SupabaseClient, appUserId: string, throwOnLookupFailure = false) {
  if (!appUserId) return false;
  const { data, error } = await db.from("praktika_sessions")
    .select("status,authenticated_at,helper_heartbeat_at,helper_instance_id,current_url,app_user_id,experimental_auth_status,experimental_auth_at,experimental_helper_instance_id")
    .eq("scope", "user").eq("app_user_id", appUserId)
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (error && throwOnLookupFailure) throw new Error("Session lookup unavailable");
  if (error || !data || !["connected", "refreshing"].includes(data.status)) return false;
  const state = derivePraktikaConnection(data);
  return state.helperAlive && ["connected", "checking_connection", "refreshing"].includes(state.status);
}
