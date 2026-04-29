import { createClient } from "@supabase/supabase-js";

export async function getUserStatus(userId: string) {
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
    console.error("getUserStatus error:", error);
    return true;
  }

  return data?.is_active ?? true;
}