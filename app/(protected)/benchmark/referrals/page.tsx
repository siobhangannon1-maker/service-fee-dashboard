import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReferralsClient from "./ReferralsClient";

export default async function ReferralsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    redirect("/dashboard");
  }

  const allowedRoles = ["admin", "practice_manager"];

  if (!allowedRoles.includes(profile.role)) {
    redirect("/dashboard");
  }

  return <ReferralsClient />;
}