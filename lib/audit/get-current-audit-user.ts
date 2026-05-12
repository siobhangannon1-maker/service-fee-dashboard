import { createClient } from "@/lib/supabase/server";

function initialsFromName(name?: string | null, email?: string | null) {
  const cleanName = String(name || "").trim();

  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }

  const cleanEmail = String(email || "").trim();

  if (cleanEmail) {
    return cleanEmail.slice(0, 2).toUpperCase();
  }

  return "??";
}

export async function getCurrentAuditUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = user?.email ?? null;
  const fullName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    email ||
    null;

  return {
    userId: user?.id ?? null,
    email,
    fullName,
    initials: initialsFromName(fullName, email),
  };
}