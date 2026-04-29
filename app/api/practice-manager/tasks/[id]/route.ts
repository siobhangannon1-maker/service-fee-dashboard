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

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await checkAccess();

  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { action } = await req.json();

  let updatePayload: any = {};

  if (action === "complete") {
    updatePayload = { status: "completed", completed_at: new Date().toISOString(), archived_at: null };
  } else if (action === "archive") {
    updatePayload = { status: "archived", archived_at: new Date().toISOString() };
  } else if (action === "reopen") {
    updatePayload = { status: "open", completed_at: null, archived_at: null };
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { data, error } = await access.supabase
    .from("practice_manager_tasks")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ task: data });
}
