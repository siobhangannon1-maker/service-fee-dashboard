import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type AuditRow = {
  entity_id: string | null;
  actor_user_id: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

type AdminUserRow = {
  id: string;
  email?: string | null;
};

function getInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "?";

  if (parts.length === 1) {
    const first = parts[0].replace(/[^a-zA-Z]/g, "");
    return first ? first.slice(0, 2).toUpperCase() : "?";
  }

  const first = parts[0].replace(/[^a-zA-Z]/g, "");
  const second = parts[1].replace(/[^a-zA-Z]/g, "");

  if (!first && !second) return "?";
  if (!first) return second.slice(0, 2).toUpperCase() || "?";
  if (!second) return first.slice(0, 2).toUpperCase() || "?";

  return `${first[0]}${second[0]}`.toUpperCase();
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const entryIds = Array.isArray(body.entryIds)
      ? body.entryIds.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      : [];

    if (entryIds.length === 0) {
      return NextResponse.json({ creators: {} });
    }

    const { data: auditRows, error: auditError } = await supabaseAdmin
      .from("audit_log")
      .select("entity_id, actor_user_id, created_at")
      .eq("entity_type", "patient_financial_entry")
      .eq("action", "patient_entry_created")
      .in("entity_id", entryIds)
      .order("created_at", { ascending: true });

    if (auditError) {
      return NextResponse.json({ error: auditError.message }, { status: 500 });
    }

    const firstCreatorByEntryId = new Map<string, string>();

    for (const row of (auditRows || []) as AuditRow[]) {
      if (!row.entity_id || !row.actor_user_id) continue;

      if (!firstCreatorByEntryId.has(row.entity_id)) {
        firstCreatorByEntryId.set(row.entity_id, row.actor_user_id);
      }
    }

    const actorIds = Array.from(new Set(firstCreatorByEntryId.values()));

    if (actorIds.length === 0) {
      return NextResponse.json({ creators: {} });
    }

    const { data: authUsers, error: usersError } =
      await supabaseAdmin.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);

    if (profilesError) {
      return NextResponse.json({ error: profilesError.message }, { status: 500 });
    }

    const profilesById = new Map(
      ((profiles || []) as ProfileRow[]).map((profile) => [
        profile.id,
        profile.full_name,
      ])
    );

    const authUsersById = new Map(
      ((authUsers.users || []) as AdminUserRow[]).map((authUser) => [
        authUser.id,
        authUser.email ?? null,
      ])
    );

    const creators: Record<
      string,
      { userId: string; displayName: string; initials: string }
    > = {};

    for (const [entryId, actorUserId] of firstCreatorByEntryId.entries()) {
      const fullName = profilesById.get(actorUserId)?.trim();
      const email = authUsersById.get(actorUserId) ?? null;
      const displayName = fullName || email || actorUserId;

      creators[entryId] = {
        userId: actorUserId,
        displayName,
        initials: getInitials(displayName),
      };
    }

    return NextResponse.json({ creators });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load creators.",
      },
      { status: 500 }
    );
  }
}