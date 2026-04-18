import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit";

type Role =
  | "admin"
  | "practice_manager"
  | "billing_staff"
  | "provider_readonly";

type InviteRequestBody = {
  email?: string;
  role?: Role;
  full_name?: string;
};

const allowedRoles: Role[] = [
  "admin",
  "practice_manager",
  "billing_staff",
  "provider_readonly",
];

export async function POST(request: Request) {
  try {
    await requireRole(["admin"]);

    const body = (await request.json()) as InviteRequestBody;

    const email = body.email?.trim().toLowerCase() || "";
    const role = body.role;
    const fullName = body.full_name?.trim() || "";

    if (!email) {
      return NextResponse.json(
        { error: "Email is required." },
        { status: 400 }
      );
    }

    if (!role || !allowedRoles.includes(role)) {
      return NextResponse.json(
        { error: "A valid role is required." },
        { status: 400 }
      );
    }

    const redirectTo = process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/login`
      : undefined;

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo,
        data: {
          full_name: fullName || null,
        },
      }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const userId = data.user?.id;

    if (!userId) {
      return NextResponse.json(
        { error: "Invite sent but no user ID was returned." },
        { status: 500 }
      );
    }

    const supabase = await createServerClient();

    const { error: roleError } = await supabase.from("user_roles").upsert({
      user_id: userId,
      role,
    });

    if (roleError) {
      return NextResponse.json(
        { error: roleError.message },
        { status: 400 }
      );
    }

    await writeAuditLog({
      action: "user_invited",
      entityType: "user_role",
      entityId: userId,
      metadata: {
        email,
        role,
        full_name: fullName || null,
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        user_id: userId,
        email: data.user?.email ?? email,
        full_name: fullName || null,
        role,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}