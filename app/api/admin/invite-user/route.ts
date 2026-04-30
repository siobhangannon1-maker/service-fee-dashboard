import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type Role =
  | "admin"
  | "practice_manager"
  | "billing_staff"
  | "provider_readonly";

function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

export async function POST(request: Request) {
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
        { error: "Only admins can invite users." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const email = body.email?.trim().toLowerCase();
    const fullName = body.full_name?.trim() || "";
    const role = body.role as Role;

    if (!email) {
      return NextResponse.json({ error: "Missing email." }, { status: 400 });
    }

    if (!role) {
      return NextResponse.json({ error: "Missing role." }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const redirectTo = `${getBaseUrl()}/auth/callback?next=/update-password`;

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          full_name: fullName,
          role,
        },
        redirectTo,
      }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const invitedUser = data.user;

    if (invitedUser) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: invitedUser.id,
            full_name: fullName,
          },
          {
            onConflict: "id",
          }
        );

      if (profileError) {
        return NextResponse.json(
          { error: profileError.message },
          { status: 500 }
        );
      }

      const { error: roleUpsertError } = await supabaseAdmin
        .from("user_roles")
        .upsert(
          {
            user_id: invitedUser.id,
            role,
          },
          {
            onConflict: "user_id",
          }
        );

      if (roleUpsertError) {
        return NextResponse.json(
          { error: roleUpsertError.message },
          { status: 500 }
        );
      }

      const { error: statusUpsertError } = await supabaseAdmin
        .from("user_status")
        .upsert(
          {
            user_id: invitedUser.id,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id",
          }
        );

      if (statusUpsertError) {
        return NextResponse.json(
          { error: statusUpsertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      redirectTo,
      user: invitedUser ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to invite user.",
      },
      { status: 500 }
    );
  }
}