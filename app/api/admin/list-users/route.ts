import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type AppRole =
  | "admin"
  | "super_admin"
  | "practice_manager"
  | "billing_staff"
  | "typist"
  | "provider_readonly";

type AuthUserMetadata = {
  full_name?: string;
  invited_by_sms?: boolean;
  hidden_sms_login_user?: boolean;
  linked_email_user_id?: string;
  linked_email?: string;
};

function isHiddenSmsLoginUser(metadata: AuthUserMetadata | null | undefined) {
  return metadata?.hidden_sms_login_user === true;
}

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

    const currentUserRole = roleRow?.role as AppRole | undefined;

    if (
      roleError ||
      !currentUserRole ||
      !["admin", "super_admin"].includes(currentUserRole)
    ) {
      return NextResponse.json(
        { error: "Only admins can view users." },
        { status: 403 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: authUsers, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const visibleAuthUsers = (authUsers.users || []).filter((authUser) => {
      const metadata = authUser.user_metadata as AuthUserMetadata | undefined;
      return !isHiddenSmsLoginUser(metadata);
    });

    const userIds = visibleAuthUsers.map((user) => user.id);

    if (userIds.length === 0) {
      return NextResponse.json({ users: [] });
    }

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, phone, full_name, phone_verified, invited_by_sms")
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

    const profilesById = new Map(
      (profiles || []).map((profile) => [profile.id, profile])
    );

    const statusById = new Map<string, boolean>(
      (statuses || []).map((status) => [status.user_id, status.is_active])
    );

    const users = visibleAuthUsers.map((authUser) => {
      const metadata = authUser.user_metadata as AuthUserMetadata | undefined;
      const profile = profilesById.get(authUser.id);

      return {
        user_id: authUser.id,
        email: profile?.email ?? authUser.email ?? null,
        phone: profile?.phone ?? authUser.phone ?? null,
        full_name: profile?.full_name ?? metadata?.full_name ?? null,
        phone_verified:
          profile?.phone_verified ?? Boolean(authUser.phone_confirmed_at),
        invited_by_sms:
          profile?.invited_by_sms ?? Boolean(metadata?.invited_by_sms),
        is_active: statusById.get(authUser.id) ?? true,
      };
    });

    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load users.",
      },
      { status: 500 }
    );
  }
}