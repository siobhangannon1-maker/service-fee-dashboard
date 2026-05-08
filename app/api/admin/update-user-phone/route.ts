import { NextResponse } from "next/server";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type AppRole = "admin" | "super_admin";

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

    const currentRole = roleRow?.role as AppRole | undefined;

    if (
      roleError ||
      !currentRole ||
      !["admin", "super_admin"].includes(currentRole)
    ) {
      return NextResponse.json(
        { error: "Only admins can update phone numbers." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const userId = String(body.user_id || "");
    const phone = normaliseAustralianPhone(body.phone || "");

    if (!userId) {
      return NextResponse.json({ error: "Missing user_id." }, { status: 400 });
    }

    if (!phone || !phone.startsWith("+")) {
      return NextResponse.json(
        {
          error:
            "Phone number must be valid, for example 0412345678 or +61412345678.",
        },
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

    const { data: duplicateProfile, error: duplicateError } =
      await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("phone", phone)
        .neq("id", userId)
        .maybeSingle();

    if (duplicateError) {
      return NextResponse.json({ error: duplicateError.message }, { status: 500 });
    }

    if (duplicateProfile) {
      return NextResponse.json(
        { error: "This phone number is already assigned to another user." },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        phone,
        phone_verified: true,
      })
      .eq("id", userId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      phone,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update phone number.",
      },
      { status: 500 }
    );
  }
}