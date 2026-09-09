import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PraktikaSessionMode } from "./hybrid-session-store";

export class PraktikaSessionAuthorizationError extends Error {
  constructor(public status: 400 | 401 | 403, message: string) { super(message); }
}

// Reuses the existing server auth client and user_roles pattern. Never accepts a
// session row ID or uses client identity to select a privileged session.
export async function authorizePraktikaSession(input: unknown = {}): Promise<PraktikaSessionMode> {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new PraktikaSessionAuthorizationError(401, "Authentication required.");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PraktikaSessionAuthorizationError(400, "Invalid session request.");
  }
  const values = input as Record<string, unknown>;
  const scope = values.scope === undefined ? "user" : values.scope;
  if (scope !== "user" && scope !== "practice") {
    throw new PraktikaSessionAuthorizationError(400, "Invalid session scope.");
  }
  for (const key of ["sessionId", "session_id"]) {
    if (key in values) throw new PraktikaSessionAuthorizationError(400, "Session identifiers are resolved server-side.");
  }
  for (const key of ["appUserId", "app_user_id"]) {
    if (!(key in values)) continue;
    if (typeof values[key] !== "string" || !values[key]) {
      throw new PraktikaSessionAuthorizationError(400, "Invalid user identifier.");
    }
    if (values[key] !== user.id || scope !== "user") {
      throw new PraktikaSessionAuthorizationError(403, "Session access denied.");
    }
  }
  if (scope === "practice") {
    const { data, error: roleError } = await client.from("user_roles").select("role")
      .eq("user_id", user.id).maybeSingle();
    if (roleError || data?.role !== "super_admin") {
      throw new PraktikaSessionAuthorizationError(403, "Practice session administration requires super_admin.");
    }
    return { scope: "practice" };
  }
  return { scope: "user", appUserId: user.id };
}
