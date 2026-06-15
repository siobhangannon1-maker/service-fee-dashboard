import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type MedirefSessionScope = "practice" | "user";

export type MedirefSessionStatus =
  | "not_started"
  | "connected"
  | "refreshing"
  | "waiting_for_credentials"
  | "waiting_for_mfa"
  | "refresh_requested"
  | "expired"
  | "error";

export type MedirefSessionMode =
  | { scope: "practice" }
  | { scope: "user"; appUserId: string };

export type MedirefSessionRow = {
  id: string;
  scope: MedirefSessionScope;
  app_user_id: string | null;
  provider_id: string | null;
  label: string | null;
  mediref_email: string | null;
  pending_mediref_email: string | null;
  pending_mediref_password: string | null;
  credentials_updated_at: string | null;
  cookie: string | null;
  status: MedirefSessionStatus;
  message: string | null;
  current_url: string | null;
  mfa_code: string | null;
  mfa_code_updated_at: string | null;
  refresh_requested_at: string | null;
  refreshed_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

async function getCurrentAppUserId() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Readonly cookie context.
          }
        },
      },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error(
      "You must be logged in to use your individual MediRef session.",
    );
  }

  return user.id;
}

export async function getCurrentUserMedirefSessionMode(): Promise<MedirefSessionMode> {
  return { scope: "user", appUserId: await getCurrentAppUserId() };
}

function sessionOwnershipFilters(mode: MedirefSessionMode) {
  if (mode.scope === "practice") {
    return { scope: "practice" as const, app_user_id: null };
  }

  return { scope: "user" as const, app_user_id: mode.appUserId };
}

export async function getMedirefSession(
  mode: MedirefSessionMode = { scope: "practice" },
) {
  const filters = sessionOwnershipFilters(mode);

  let query = supabaseAdmin.from("mediref_sessions").select("*");

  if (filters.scope === "practice") {
    query = query.eq("scope", "practice").is("app_user_id", null);
  } else {
    query = query.eq("scope", "user").eq("app_user_id", filters.app_user_id);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Could not load MediRef session: ${error.message}`);
  }

  if (data) return data as MedirefSessionRow;

 const insertPayload: {
  scope: MedirefSessionScope;
  app_user_id: string | null;
  label: string;
  status: MedirefSessionStatus;
  message: string;
} =
  mode.scope === "practice"
    ? {
        scope: "practice",
        app_user_id: null,
        label: "Practice MediRef integration account",
        status: "not_started",
        message: "Practice MediRef session not started.",
      }
    : {
        scope: "user",
        app_user_id: mode.appUserId,
        label: "Individual MediRef session",
        status: "not_started",
        message: "Individual MediRef session not connected.",
      };

  const { data: created, error: createError } = await supabaseAdmin
    .from("mediref_sessions")
    .insert(insertPayload)
    .select("*")
    .single();

  if (createError || !created) {
    throw new Error(
      `Could not create MediRef session: ${
        createError?.message || "No row returned."
      }`,
    );
  }

  return created as MedirefSessionRow;
}

export async function updateMedirefSession(
  mode: MedirefSessionMode,
  values: Partial<
    Omit<
      MedirefSessionRow,
      "id" | "scope" | "app_user_id" | "created_at" | "updated_at"
    >
  >,
) {
  const current = await getMedirefSession(mode);

  let query = supabaseAdmin
    .from("mediref_sessions")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", current.id)
    .eq("scope", current.scope);

  if (current.scope === "practice") {
    query = query.is("app_user_id", null);
  } else {
    query = query.eq("app_user_id", current.app_user_id);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Could not update MediRef session: ${error.message}`);
  }
}

export async function getMedirefCookie(
  mode: MedirefSessionMode = { scope: "practice" },
) {
  const session = await getMedirefSession(mode);

  if (!session.cookie) {
    throw new Error("No MediRef cookie is saved for this session.");
  }

  await updateMedirefSession(mode, { last_used_at: new Date().toISOString() });

  return session.cookie;
}

export async function saveMedirefCookie({
  mode,
  cookie,
  email,
  currentUrl,
}: {
  mode: MedirefSessionMode;
  cookie: string;
  email?: string | null;
  currentUrl?: string | null;
}) {
  await updateMedirefSession(mode, {
    cookie,
    mediref_email: email || undefined,
    pending_mediref_email: null,
    pending_mediref_password: null,
    current_url: currentUrl || null,
    status: "connected",
    message: "MediRef connection is active.",
    mfa_code: null,
    mfa_code_updated_at: null,
    refresh_requested_at: null,
    refreshed_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
  });
}

export async function markMedirefRefreshRequested(
  mode: MedirefSessionMode = { scope: "practice" },
) {
  await updateMedirefSession(mode, {
    status: "refresh_requested",
    message:
      mode.scope === "practice"
        ? "Practice MediRef refresh requested. Waiting for cloud helper."
        : "Your MediRef refresh was requested. Waiting for cloud helper.",
    refresh_requested_at: new Date().toISOString(),
  });
}

export async function saveMedirefMfaCode({
  mode,
  code,
}: {
  mode: MedirefSessionMode;
  code: string;
}) {
  const now = new Date().toISOString();

  await updateMedirefSession(mode, {
    mfa_code: code.replace(/\D/g, "").trim(),
    mfa_code_updated_at: now,
    status: "refresh_requested",
    message:
      "MFA code received. Waiting for the local MediRef helper to finish signing in.",
    refresh_requested_at: now,
  });
}

export async function clearTemporaryMedirefCredentials(
  mode: MedirefSessionMode,
  options: {
    clearEmail?: boolean;
    message?: string;
    status?: MedirefSessionStatus;
  } = {},
) {
  await updateMedirefSession(mode, {
    pending_mediref_password: null,
    ...(options.clearEmail ? { pending_mediref_email: null } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.message ? { message: options.message } : {}),
  });
}
