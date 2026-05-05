import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET;

    if (!baseUrl) throw new Error("Missing NEXT_PUBLIC_APP_URL");
    if (!clientId) throw new Error("Missing GOOGLE_BUSINESS_CLIENT_ID");
    if (!clientSecret) throw new Error("Missing GOOGLE_BUSINESS_CLIENT_SECRET");

    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const error = requestUrl.searchParams.get("error");

    if (error) throw new Error(`Google OAuth error: ${error}`);
    if (!code) throw new Error("Missing Google OAuth code");

    const redirectUri = `${baseUrl}/api/google-business/callback`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(
        tokenData?.error_description ||
          tokenData?.error ||
          "Failed to exchange Google OAuth code"
      );
    }

    if (!tokenData.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Try reconnecting again, or revoke app access in your Google Account first."
      );
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    const { error: saveError } = await supabaseAdmin
      .from("google_business_tokens")
      .upsert({
        id: "main",
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token || null,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      });

    if (saveError) throw saveError;

    return NextResponse.redirect(`${baseUrl}/benchmark/expense-reports?google=connected`);
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown Google OAuth callback error",
      },
      { status: 500 }
    );
  }
}