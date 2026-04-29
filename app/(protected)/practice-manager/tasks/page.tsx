import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PracticeManagerTasksClient from "./PracticeManagerTasksClient";

export default async function PracticeManagerTasksPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "practice_manager"].includes(profile.role)) {
    redirect("/dashboard");
  }

  return <PracticeManagerTasksClient />;
}
