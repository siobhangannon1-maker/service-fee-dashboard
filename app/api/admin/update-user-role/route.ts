import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    const { data: actor, error: roleError } = await client.from("user_roles")
      .select("role").eq("user_id", user.id).single();
    // Match existing invite/delete administration. Never authorize from request metadata.
    if (roleError || !actor || !["admin", "super_admin"].includes(actor.role)) {
      return NextResponse.json({ error: "Only admins can update roles." }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.user_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.user_id) ||
        !["admin", "super_admin", "practice_manager", "billing_staff", "provider_readonly", "typist", "staff"].includes(body.role)) {
      return NextResponse.json({ error: "Invalid user or role." }, { status: 400 });
    }
    const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from("user_roles").upsert(
      { user_id: body.user_id, role: body.role }, { onConflict: "user_id" });
    if (error) return NextResponse.json({ error: "Failed to update role." }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update role." }, { status: 500 });
  }
}
