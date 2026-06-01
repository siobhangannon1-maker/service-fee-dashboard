import { supabaseAdmin } from "@/lib/supabase/admin";

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

type ProfileRow = {
  id: string;
  full_name: string | null;
  email?: string | null;
};

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

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

export async function getStaffDisplayInfo(userId: string | null | undefined) {
  if (!userId) {
    return {
      userId: null,
      displayName: "Unknown User",
      initials: "?",
    };
  }

  const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();

  const authUser = ((authUsers?.users || []) as AdminUserRow[]).find(
    (user) => user.id === userId
  );

  const linkedProfileId =
    isHiddenSmsLoginUser(authUser) && getLinkedProfileId(authUser)
      ? getLinkedProfileId(authUser)
      : null;

  const profileLookupId = linkedProfileId || userId;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", profileLookupId)
    .maybeSingle();

  const typedProfile = profile as ProfileRow | null;
  const metadata = authUser?.user_metadata;

  const displayName =
    typedProfile?.full_name?.trim() ||
    metadata?.full_name?.trim() ||
    typedProfile?.email?.trim() ||
    authUser?.email?.trim() ||
    metadata?.linked_email?.trim() ||
    "Unknown User";

  return {
    userId,
    displayName,
    initials: getInitials(displayName),
  };
}