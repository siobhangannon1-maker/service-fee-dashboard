import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function checkAccess() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { supabase, allowed: false, status: 401, error: "Not logged in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "practice_manager"].includes(profile.role)) {
    return { supabase, allowed: false, status: 403, error: "Not allowed" };
  }

  return { supabase, allowed: true, status: 200, error: null };
}

export async function GET(req: Request) {
  const access = await checkAccess();

  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "open";

  let query = access.supabase
    .from("practice_manager_tasks")
    .select(`
      id,
      title,
      description,
      task_type,
      status,
      referral_received_date,
      source_referrer_id,
      source_upload_id,
      completed_at,
      archived_at,
      created_at,
      referrers:source_referrer_id (
        clinic_name,
        address,
        suburb,
        post_code,
        state
      )
    `)
    .order("created_at", { ascending: false });

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tasks: data || [] });
}
