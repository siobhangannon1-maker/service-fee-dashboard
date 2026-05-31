import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole =
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

  console.log("AUTH USER ID:", user.id);
  console.log("AUTH USER EMAIL:", user.email);
  console.log("AUTH USER PHONE:", user.phone);
  console.log("ROLE DATA:", data);
  console.log("ROLE ERROR:", error);
  console.log("ALLOWED ROLES:", allowedRoles);

  if (error) {
    console.error("Role lookup error:", error);
    redirect("/unauthorized");
  }

  if (!data) {
    console.error("No role found for user:", user.id);
    redirect("/unauthorized");
  }

  const userRole = data.role as AppRole;

  if (!allowedRoles.includes(userRole)) {
    console.error("User role not allowed:", {
      userRole,
      allowedRoles,
    });

    redirect("/unauthorized");
  }

  return { supabase, user, role: userRole };
}