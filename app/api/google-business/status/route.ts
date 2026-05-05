import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("google_business_tokens")
      .select("id, refresh_token, access_token, expires_at, updated_at")
      .eq("id", "main")
      .maybeSingle();

    if (error) throw error;

    const connected = Boolean(data?.refresh_token);

    return NextResponse.json({
      success: true,
      connected,
      has_access_token: Boolean(data?.access_token),
      expires_at: data?.expires_at || null,
      updated_at: data?.updated_at || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: error?.message || "Failed to check Google Business status",
      },
      { status: 500 }
    );
  }
}