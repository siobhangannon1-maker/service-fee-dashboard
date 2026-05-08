import { NextResponse } from "next/server";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

type Role =
  | "admin"
  | "super_admin"
  | "practice_manager"
  | "billing_staff"
  | "provider_readonly";

type InviteMethod = "email" | "sms";

function getBaseUrl() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (siteUrl) return siteUrl.replace(/\/$/, "");

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`.replace(
      /\/$/,
      ""
    );
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  throw new Error("Missing NEXT_PUBLIC_SITE_URL.");
}

function normaliseAustralianPhone(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  const cleaned = raw.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+61")) return cleaned;
  if (cleaned.startsWith("61")) return `+${cleaned}`;
  if (cleaned.startsWith("04")) return `+61${cleaned.slice(1)}`;
  if (cleaned.startsWith("4") && cleaned.length === 9) return `+61${cleaned}`;

  return cleaned;
}

async function sendTwilioSms(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    throw new Error(
      "Missing Twilio env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID."
    );
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const params = new URLSearchParams();
  params.append("To", to);
  params.append("MessagingServiceSid", messagingServiceSid);
  params.append("Body", body);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Failed to send SMS invite.");
  }

  return result;
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

    if (
      roleError ||
      !roleRow ||
      !["admin", "super_admin"].includes(roleRow.role)
    ) {
      return NextResponse.json(
        { error: "Only admins can resend invites." },
        { status: 403 }
      );
    }

    const body = await request.json();

    const inviteMethod = (body.invite_method || "email") as InviteMethod;
    const email = String(body.email || "").trim().toLowerCase();
    const phone = normaliseAustralianPhone(body.phone || "");
    const fullName = String(body.full_name || "").trim();
    const role = body.role as Role;

    if (!role) {
      return NextResponse.json({ error: "Missing role." }, { status: 400 });
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

    if (inviteMethod === "sms") {
      if (!phone) {
        return NextResponse.json(
          { error: "Missing phone number." },
          { status: 400 }
        );
      }

      const firstName = fullName.split(/\s+/)[0] || "there";
      const loginUrl = `${getBaseUrl()}/login`;

      const smsBody = `Hi ${firstName}, Focus Dental Specialists has enabled secure mobile access for your dashboard.

Sign in using your mobile number here:
${loginUrl}

You will receive a one-time SMS code.`;

      await sendTwilioSms(phone, smsBody);

      return NextResponse.json({
        success: true,
        invite_method: "sms",
        phone,
      });
    }

    if (!email) {
      return NextResponse.json({ error: "Missing email." }, { status: 400 });
    }

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

    return NextResponse.json({
      success: true,
      invite_method: "email",
      user: data.user ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resend invite.",
      },
      { status: 500 }
    );
  }
}