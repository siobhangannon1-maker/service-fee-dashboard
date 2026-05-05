import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const clientId = process.env.GOOGLE_BUSINESS_CLIENT_ID;

  if (!baseUrl) throw new Error("Missing NEXT_PUBLIC_APP_URL");
  if (!clientId) throw new Error("Missing GOOGLE_BUSINESS_CLIENT_ID");

  const redirectUri = `${baseUrl}/api/google-business/callback`;

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/business.manage");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return NextResponse.redirect(url.toString());
}