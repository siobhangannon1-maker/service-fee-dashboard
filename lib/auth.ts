import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole =
  | "admin"
  | "practice_manager"
  | "billing_staff"
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
    .single();

  console.log("AUTH DEBUG user id:", user.id);
  console.log("AUTH DEBUG role row:", data);
  console.log("AUTH DEBUG role error:", error);
  console.log("AUTH DEBUG allowed roles:", allowedRoles);

  if (error || !data || !allowedRoles.includes(data.role as AppRole)) {
    redirect("/unauthorized");
  }

  return { supabase, user, role: data.role as AppRole };
}