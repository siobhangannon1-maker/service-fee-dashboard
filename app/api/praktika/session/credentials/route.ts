import { authorizePraktikaSession, PraktikaSessionAuthorizationError } from "@/lib/praktika/session-authorization";
import { NextResponse } from "next/server";
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

    const mode = await authorizePraktikaSession(body);
    if (mode.scope !== "user") throw new PraktikaSessionAuthorizationError(400, "Credentials require user scope.");
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: "Username and password are required." },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("praktika_sessions")
      .select("id")
      .eq("scope", "user")
      .eq("app_user_id", mode.appUserId)
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
        .eq("id", existing.id)
        .eq("scope", "user")
        .eq("app_user_id", mode.appUserId);

      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("praktika_sessions").insert({
        scope: "user",
        app_user_id: mode.appUserId,
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
    if (error instanceof PraktikaSessionAuthorizationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
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