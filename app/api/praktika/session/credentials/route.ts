import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "Username and password are required." },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();

    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {},
        },
      },
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseAuth.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: "You must be logged in." },
        { status: 401 },
      );
    }

    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("praktika_sessions")
      .select("id")
      .eq("scope", "user")
      .eq("app_user_id", user.id)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("praktika_sessions")
        .update({
          pending_praktika_username: username,
          pending_praktika_password: password,
          praktika_username: username,
          status: "refresh_requested",
          message:
            "Praktika credentials were submitted. Local helper will continue login.",
          refresh_requested_at: now,
          updated_at: now,
        })
        .eq("id", existing.id);

      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("praktika_sessions").insert({
        scope: "user",
        app_user_id: user.id,
        pending_praktika_username: username,
        pending_praktika_password: password,
        praktika_username: username,
        status: "refresh_requested",
        message:
          "Praktika credentials were submitted. Local helper will continue login.",
        refresh_requested_at: now,
        updated_at: now,
      });

      if (error) throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      message: "Credentials submitted.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not submit Praktika credentials.",
      },
      { status: 500 },
    );
  }
}