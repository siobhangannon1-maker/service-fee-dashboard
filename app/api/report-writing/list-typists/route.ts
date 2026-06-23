import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("role", "typist");

    if (roleError) {
      return NextResponse.json(
        { success: false, error: roleError.message, typists: [] },
        { status: 500 }
      );
    }

    const userIds = (roleRows || []).map((row) => row.user_id);

    if (userIds.length === 0) {
      return NextResponse.json({ success: true, typists: [] });
    }

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", userIds);

    if (profileError) {
      return NextResponse.json(
        { success: false, error: profileError.message, typists: [] },
        { status: 500 }
      );
    }

    const typists = (profiles || [])
      .filter((profile) => Boolean(profile.phone))
      .map((profile) => ({
        user_id: profile.id,
        id: profile.id,
        full_name: profile.full_name || profile.email || "Unnamed typist",
        name: profile.full_name || profile.email || "Unnamed typist",
        email: profile.email,
        phone: profile.phone,
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    return NextResponse.json({ success: true, typists });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to load typists.",
        typists: [],
      },
      { status: 500 }
    );
  }
}