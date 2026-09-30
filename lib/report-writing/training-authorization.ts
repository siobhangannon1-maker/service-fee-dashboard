import "server-only";
import { ApiAuthorizationError, requireActiveApiUser, type AppRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const crossProviderTrainingRoles: AppRole[] = ["admin", "super_admin", "practice_manager", "typist"];
export type TrainingActor = { userId: string; role: AppRole; canTrainAcrossProviders: boolean };
type Access<T> = { value: T; denied: null } | { value: null; denied: Response };

function denial(status: number): Response {
  return Response.json({ success: false, error: status === 401 ? "Authentication required."
    : status === 400 ? "Invalid training target."
    : status === 503 ? "Training access could not be verified. Please try again."
    : "Access denied. An active authorized account and provider are required." }, { status });
}

export async function trainingAccess(crossProviderOnly = false): Promise<Access<TrainingActor>> {
  try {
    const { user, supabase } = await requireActiveApiUser();
    // The legacy active-user helper permits missing status rows. Training must
    // establish a positive active record rather than inherit that compatibility.
    const status = await supabaseAdmin.from("user_status").select("is_active")
      .eq("user_id", user.id).maybeSingle();
    if (status.error || status.data?.is_active !== true) return { value: null, denied: denial(403) };
    const { data, error } = await supabase.from("user_roles").select("role")
      .eq("user_id", user.id).maybeSingle();
    if (error || !data || ![...crossProviderTrainingRoles, "provider_readonly", "staff", "billing_staff"].includes(data.role))
      return { value: null, denied: denial(403) };
    const role = data.role as AppRole;
    const canTrainAcrossProviders = crossProviderTrainingRoles.includes(role);
    if (crossProviderOnly && !canTrainAcrossProviders) return { value: null, denied: denial(403) };
    return { value: { userId: user.id, role, canTrainAcrossProviders }, denied: null };
  } catch (error) {
    return { value: null, denied: denial(error instanceof ApiAuthorizationError ? error.status : 503) };
  }
}

const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function trainingProviderAccess(actor: TrainingActor, providerId: unknown): Promise<Response | null> {
  if (!uuid(providerId)) return denial(400);
  try {
    const { data, error } = await supabaseAdmin.from("providers").select("id,user_id")
      .eq("id", providerId).eq("is_active", true).maybeSingle();
    if (error) return denial(503);
    // Capability is independent of provider identity. No email/profile/metadata fallback.
    if (!data || (!actor.canTrainAcrossProviders && data.user_id !== actor.userId)) return denial(403);
    return null;
  } catch { return denial(503); }
}

const itemTables = ["provider_report_examples", "provider_report_rules", "provider_terminology_rules",
  "provider_report_edit_examples", "provider_knowledge", "provider_training_cases"] as const;

export async function trainingItemAccess(actor: TrainingActor, table: string, itemId: unknown): Promise<Access<string>> {
  if (!uuid(itemId) || !itemTables.some(value => value === table)) return { value: null, denied: denial(400) };
  try {
    const { data, error } = await supabaseAdmin.from(table).select("provider_id").eq("id", itemId).maybeSingle();
    if (error) return { value: null, denied: denial(503) };
    if (!data) return { value: null, denied: denial(403) };
    const denied = await trainingProviderAccess(actor, data.provider_id);
    return denied ? { value: null, denied } : { value: data.provider_id, denied: null };
  } catch { return { value: null, denied: denial(503) }; }
}
