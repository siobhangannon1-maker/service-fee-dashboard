import { NextResponse } from "next/server";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

    if (
      roleError ||
      !roleRow ||
      !["admin", "super_admin"].includes(roleRow.role)
    ) {
      return NextResponse.json(
        { error: "Only admins can delete users." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const userId = body.user_id?.trim();

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id." }, { status: 400 });
    }

    if (userId === user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own user account from here." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseJsClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    await supabaseAdmin.from("user_status").delete().eq("user_id", userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    await supabaseAdmin.from("profiles").delete().eq("id", userId);

    const { error: deleteAuthError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteAuthError) {
      const message = deleteAuthError.message.toLowerCase();

      if (!message.includes("not found") && !message.includes("user not found")) {
        return NextResponse.json(
          { error: deleteAuthError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete user.",
      },
      { status: 500 }
    );
  }
}