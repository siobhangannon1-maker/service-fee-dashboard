import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole =
  | "staff"
  | "admin"
  | "super_admin"
  | "practice_manager"
  | "billing_staff"
  | "typist"
  | "provider_readonly";

export async function requireUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

export async function requireRole(allowedRoles: AppRole[]) {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    redirect("/unauthorized");
  }

  if (!data) {
    redirect("/unauthorized");
  }

  const userRole = data.role as AppRole;

  if (!allowedRoles.includes(userRole)) {
    redirect("/unauthorized");
  }

  return { supabase, user, role: userRole };
}

// Route handlers need JSON errors, rather than the page helpers' redirects.
// Identity and roles use the same verified server client/database as requireRole.
export class ApiAuthorizationError extends Error {
  constructor(public status: 401 | 403, message: string) { super(message); }
}

export async function requireApiUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new ApiAuthorizationError(401, "Authentication required.");
  return { supabase, user };
}

export async function requireApiRole(allowedRoles: AppRole[]) {
  const { supabase, user } = await requireApiUser();
  const { data, error } = await supabase.from("user_roles").select("role")
    .eq("user_id", user.id).maybeSingle();
  if (error || !data || !allowedRoles.includes(data.role as AppRole)) {
    throw new ApiAuthorizationError(403, "Access denied.");
  }
  return { supabase, user, role: data.role as AppRole };
}

// Batch 1: retain the established missing-status-row compatibility, but never
// accept a failed status lookup. This does not change legacy page authentication.
export async function requireActiveApiUser(allowedRoles?: AppRole[]) {
  let identity: Awaited<ReturnType<typeof requireApiUser>>;
  try { identity = await requireApiUser(); }
  catch { throw new ApiAuthorizationError(401, "Authentication required."); }
  const { getUserStatus } = await import("@/lib/getUserStatus");
  let active = false;
  try { active = await getUserStatus(identity.user.id, { failClosed: true }); }
  catch { /* Verification unavailable: deny without exposing upstream errors. */ }
  if (!active) throw new ApiAuthorizationError(403, "An active account is required.");
  if (allowedRoles) {
    try {
      const { data, error } = await identity.supabase.from("user_roles").select("role")
        .eq("user_id", identity.user.id).maybeSingle();
      if (error || !data || !allowedRoles.includes(data.role as AppRole)) throw new Error();
    } catch { throw new ApiAuthorizationError(403, "Access denied."); }
  }
  return identity;
}

// Return denials before entering route-specific catches (which may expose errors).
// Call sites supply a fixed action name, never a request URL or request body.
export async function sensitiveApiAccess(action: string, allowedRoles?: AppRole[]): Promise<Response | null> {
  try {
    await requireActiveApiUser(allowedRoles);
    return null;
  } catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 403;
    const message = status === 401 ? "Authentication required." : "Access denied. An active authorized account is required.";
    try { console.warn("[security]", { action, outcome: status === 401 ? "unauthenticated" : "forbidden" }); }
    catch { /* Audit logging must not affect access-control results. */ }
    return Response.json({ success: false, error: message }, { status });
  }
}
