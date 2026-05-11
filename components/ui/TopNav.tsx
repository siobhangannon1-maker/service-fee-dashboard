import { NextResponse } from "next/server";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

export async function POST() {
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
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "No signed-in user found." },
        { status: 401 }
      );
    }

    const phone = normaliseAustralianPhone(user.phone || "");

    if (!phone) {
      return NextResponse.json(
        { error: "Signed-in user does not have a phone number." },
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

    // CASE 1:
    // This is a direct SMS-auth user with its own profile.
    const { data: ownProfile, error: ownProfileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, phone")
      .eq("id", user.id)
      .maybeSingle();

    if (ownProfileError) {
      return NextResponse.json(
        { error: ownProfileError.message },
        { status: 500 }
      );
    }

    if (ownProfile?.phone === phone) {
      const { data: ownRole, error: ownRoleError } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (ownRoleError || !ownRole) {
        return NextResponse.json(
          { error: "This SMS user does not have an assigned role." },
          { status: 403 }
        );
      }

      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...user.user_metadata,
          full_name: ownProfile.full_name ?? "",
          invited_by_sms: true,
        },
      });

      return NextResponse.json({
        success: true,
        mode: "direct_sms_user",
        user_id: user.id,
      });
    }

    // CASE 2:
    // This is a newly-created phone auth user that should link back
    // to an existing email user profile with the same phone number.
    const { data: originalProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, phone")
      .eq("phone", phone)
      .neq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (!originalProfile) {
      return NextResponse.json(
        { error: "No user with this phone number." },
        { status: 403 }
      );
    }

    const { data: originalRole, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", originalProfile.id)
      .single();

    if (roleError || !originalRole) {
      return NextResponse.json(
        { error: "Could not find role for linked user." },
        { status: 500 }
      );
    }

    const { data: originalStatus } = await supabaseAdmin
      .from("user_status")
      .select("is_active")
      .eq("user_id", originalProfile.id)
      .maybeSingle();

    const isActive = originalStatus?.is_active ?? true;

    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        full_name: originalProfile.full_name ?? "",
        linked_email_user_id: originalProfile.id,
        linked_email: originalProfile.email ?? null,
        hidden_sms_login_user: true,
      },
    });

    const { error: roleUpsertError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        {
          user_id: user.id,
          role: originalRole.role,
        },
        { onConflict: "user_id" }
      );

    if (roleUpsertError) {
      return NextResponse.json(
        { error: roleUpsertError.message },
        { status: 500 }
      );
    }

    const { error: statusUpsertError } = await supabaseAdmin
      .from("user_status")
      .upsert(
        {
          user_id: user.id,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (statusUpsertError) {
      return NextResponse.json(
        { error: statusUpsertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      mode: "linked_sms_user",
      linked_email_user_id: originalProfile.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message : "Failed to link phone session.",
      },
      { status: 500 }
    );
  }
}