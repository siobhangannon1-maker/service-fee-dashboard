import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type Role =
  | "admin"
  | "practice_manager"
  | "billing_staff"
  | "provider_readonly";

type UserRoleRow = {
  user_id: string;
  role: Role;
};

export async function GET() {
  try {
    await requireRole(["admin"]);

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      );
    }

    const supabase = await createServerClient();

    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("user_id, role");

    if (roleError) {
      return NextResponse.json(
        { error: roleError.message },
        { status: 400 }
      );
    }

    const rolesByUserId = new Map<string, Role>();

    for (const row of (roleData || []) as UserRoleRow[]) {
      rolesByUserId.set(row.user_id, row.role);
    }

    const users =
      authData.users?.map((user) => ({
        user_id: user.id,
        email: user.email ?? null,
        full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
        role: rolesByUserId.get(user.id) ?? "billing_staff",
      })) || [];

    return NextResponse.json({ users });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}