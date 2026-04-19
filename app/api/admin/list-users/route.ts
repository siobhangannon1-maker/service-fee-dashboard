import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const { data: roleRow, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (roleError || !roleRow || roleRow.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can view users." },
        { status: 403 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: authUsers, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json(
        { error: usersError.message },
        { status: 500 }
      );
    }

    const userIds = authUsers.users.map((u) => u.id);

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    if (profilesError) {
      return NextResponse.json(
        { error: profilesError.message },
        { status: 500 }
      );
    }

    const { data: statuses, error: statusesError } = await supabaseAdmin
      .from("user_status")
      .select("user_id, is_active")
      .in("user_id", userIds);

    if (statusesError) {
      return NextResponse.json(
        { error: statusesError.message },
        { status: 500 }
      );
    }

    const profilesById = new Map<string, string | null>(
      (profiles || []).map((profile) => [profile.id, profile.full_name])
    );

    const statusById = new Map<string, boolean>(
      (statuses || []).map((status) => [status.user_id, status.is_active])
    );

    const users = authUsers.users.map((authUser) => ({
      user_id: authUser.id,
      email: authUser.email ?? null,
      full_name: profilesById.get(authUser.id) ?? null,
      is_active: statusById.get(authUser.id) ?? true,
    }));

    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load users.",
      },
      { status: 500 }
    );
  }
}