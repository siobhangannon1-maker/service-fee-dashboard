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

type UpdateUserRequestBody = {
  user_id?: string;
  email?: string;
  full_name?: string;
  role?: Role;
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

    const body = (await request.json()) as UpdateUserRequestBody;

    const userId = body.user_id?.trim() || "";
    const email = body.email?.trim().toLowerCase() || "";
    const fullName = body.full_name?.trim() || "";
    const role = body.role;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required." },
        { status: 400 }
      );
    }

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

    const { error: updateAuthError } =
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        email,
        user_metadata: {
          full_name: fullName || null,
        },
      });

    if (updateAuthError) {
      return NextResponse.json(
        { error: updateAuthError.message },
        { status: 400 }
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
      action: "user_updated",
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
        email,
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