import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function normaliseAustralianPhone(input: string) {
  const raw = String(input || "").trim();

  if (!raw) return "";

  const cleaned = raw.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) return cleaned;

  if (cleaned.startsWith("04")) {
    return `+61${cleaned.slice(1)}`;
  }

  if (cleaned.startsWith("4") && cleaned.length === 9) {
    return `+61${cleaned}`;
  }

  if (cleaned.startsWith("61")) {
    return `+${cleaned}`;
  }

  return cleaned;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const phone = normaliseAustralianPhone(body.phone || "");

    if (!phone) {
      return NextResponse.json(
        { error: "Missing phone number." },
        { status: 400 }
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

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, phone")
      .eq("phone", phone)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 }
      );
    }

    if (profile) {
      return NextResponse.json({
        exists: true,
        source: "profiles",
      });
    }

    const { data: authUsers, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json(
        { error: usersError.message },
        { status: 500 }
      );
    }

    const matchedAuthUser = authUsers.users.find(
      (user) => user.phone === phone
    );

    if (matchedAuthUser) {
      await supabaseAdmin.from("profiles").upsert(
        {
          id: matchedAuthUser.id,
          phone,
          phone_verified: true,
        },
        { onConflict: "id" }
      );

      return NextResponse.json({
        exists: true,
        source: "auth",
      });
    }

    return NextResponse.json({
      exists: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check phone number.",
      },
      { status: 500 }
    );
  }
}