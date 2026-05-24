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
  email?: string | null;
};

type AuthUserMetadata = {
  full_name?: string;
  linked_email?: string;
  linked_email_user_id?: string;
  hidden_sms_login_user?: boolean;
};

type AdminUserRow = {
  id: string;
  email?: string | null;
  phone?: string | null;
  user_metadata?: AuthUserMetadata;
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

function isHiddenSmsLoginUser(user: AdminUserRow | undefined) {
  return user?.user_metadata?.hidden_sms_login_user === true;
}

function getLinkedProfileId(user: AdminUserRow | undefined) {
  return user?.user_metadata?.linked_email_user_id || null;
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
          (value: unknown): value is string =>
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

    const authUsersById = new Map<string, AdminUserRow>(
      ((authUsers.users || []) as AdminUserRow[]).map((authUser) => [
        authUser.id,
        authUser,
      ])
    );

    const profileIdsToLoad = new Set<string>();

    for (const actorId of actorIds) {
      profileIdsToLoad.add(actorId);

      const authUser = authUsersById.get(actorId);
      const linkedProfileId = getLinkedProfileId(authUser);

      if (isHiddenSmsLoginUser(authUser) && linkedProfileId) {
        profileIdsToLoad.add(linkedProfileId);
      }
    }

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(profileIdsToLoad));

    if (profilesError) {
      return NextResponse.json(
        { error: profilesError.message },
        { status: 500 }
      );
    }

    const profilesById = new Map(
      ((profiles || []) as ProfileRow[]).map((profile) => [
        profile.id,
        profile,
      ])
    );

    const creators: Record<
      string,
      { userId: string; displayName: string; initials: string }
    > = {};

    for (const [entryId, actorUserId] of firstCreatorByEntryId.entries()) {
      const authUser = authUsersById.get(actorUserId);

      const linkedProfileId =
        isHiddenSmsLoginUser(authUser) && getLinkedProfileId(authUser)
          ? getLinkedProfileId(authUser)
          : null;

      const profileLookupId = linkedProfileId || actorUserId;
      const profile = profilesById.get(profileLookupId);

      const metadata = authUser?.user_metadata;

      const displayName =
        profile?.full_name?.trim() ||
        metadata?.full_name?.trim() ||
        profile?.email?.trim() ||
        authUser?.email?.trim() ||
        metadata?.linked_email?.trim() ||
        "Unknown User";

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