import { createClient } from "@supabase/supabase-js";

export async function getUserStatus(userId: string, options: { failClosed?: boolean } = {}) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("user_status")
    .select("is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (options.failClosed) return false;
    console.error("getUserStatus error:", error);
    return true;
  }

  return data?.is_active ?? true;
}