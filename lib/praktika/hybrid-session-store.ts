import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PraktikaSessionScope = "practice" | "user";

export type PraktikaSessionStatus =
  | "not_started"
  | "connected"
  | "refreshing"
  | "waiting_for_credentials"
  | "waiting_for_mfa"
  | "refresh_requested"
  | "expired"
  | "error";

export type PraktikaSessionMode =
  | { scope: "practice" }
  | { scope: "user"; appUserId: string };

export type PraktikaSessionRow = {
  id: string;
  scope: PraktikaSessionScope;
  app_user_id: string | null;
  provider_id: string | null;
  label: string | null;
  praktika_username: string | null;
  pending_praktika_username: string | null;
  pending_praktika_password: string | null;
  credentials_updated_at: string | null;
  cookie: string | null;
  status: PraktikaSessionStatus;
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
      "You must be logged in to use your individual Praktika session.",
    );
  }

  return user.id;
}

export async function getCurrentUserPraktikaSessionMode(): Promise<PraktikaSessionMode> {
  return { scope: "user", appUserId: await getCurrentAppUserId() };
}

function sessionOwnershipFilters(mode: PraktikaSessionMode) {
  if (mode.scope === "practice") {
    return {
      scope: "practice" as const,
      app_user_id: null,
    };
  }

  return {
    scope: "user" as const,
    app_user_id: mode.appUserId,
  };
}

export async function getPraktikaSession(
  mode: PraktikaSessionMode = { scope: "practice" },
) {
  const filters = sessionOwnershipFilters(mode);

  let query = supabaseAdmin.from("praktika_sessions").select("*");

  if (filters.scope === "practice") {
    query = query.eq("scope", "practice").is("app_user_id", null);
  } else {
    query = query.eq("scope", "user").eq("app_user_id", filters.app_user_id);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Could not load Praktika session: ${error.message}`);
  }

  if (data) return data as PraktikaSessionRow;

  const insertPayload: {
    scope: PraktikaSessionScope;
    app_user_id: string | null;
    label: string;
    status: PraktikaSessionStatus;
    message: string;
  } =
    mode.scope === "practice"
      ? {
          scope: "practice",
          app_user_id: null,
          label: "Practice integration account",
          status: "not_started",
          message: "Practice Praktika session not started.",
        }
      : {
          scope: "user",
          app_user_id: mode.appUserId,
          label: "Individual Praktika session",
          status: "not_started",
          message: "Individual Praktika session not connected.",
        };

  const { data: created, error: createError } = await supabaseAdmin
    .from("praktika_sessions")
    .insert(insertPayload)
    .select("*")
    .single();

  if (createError || !created) {
    throw new Error(
      `Could not create Praktika session: ${
        createError?.message || "No row returned."
      }`,
    );
  }

  return created as PraktikaSessionRow;
}

export async function updatePraktikaSession(
  mode: PraktikaSessionMode,
  values: Partial<
    Omit<
      PraktikaSessionRow,
      "id" | "scope" | "app_user_id" | "created_at" | "updated_at"
    >
  >,
) {
  const current = await getPraktikaSession(mode);

  let query = supabaseAdmin
    .from("praktika_sessions")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", current.id)
    .eq("scope", current.scope);

  if (current.scope === "practice") {
    query = query.is("app_user_id", null);
  } else {
    query = query.eq("app_user_id", current.app_user_id);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Could not update Praktika session: ${error.message}`);
  }
}

export async function getPraktikaCookie(
  mode: PraktikaSessionMode = { scope: "practice" },
) {
  const session = await getPraktikaSession(mode);

  if (!session.cookie) {
    throw new Error("No Praktika cookie is saved for this session.");
  }

  await updatePraktikaSession(mode, {
    last_used_at: new Date().toISOString(),
  });

  return session.cookie;
}

export async function savePraktikaCookie({
  mode,
  cookie,
  username,
  currentUrl,
}: {
  mode: PraktikaSessionMode;
  cookie: string;
  username?: string | null;
  currentUrl?: string | null;
}) {
  await updatePraktikaSession(mode, {
    cookie,
    praktika_username: username || undefined,
    pending_praktika_username: null,
    pending_praktika_password: null,
    current_url: currentUrl || null,
    status: "connected",
    message: "Praktika connection is active.",
    mfa_code: null,
    mfa_code_updated_at: null,
    refreshed_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
  });
}

export async function markPraktikaRefreshRequested(
  mode: PraktikaSessionMode = { scope: "practice" },
) {
  const current = await getPraktikaSession(mode);

  if (
    current.status === "refresh_requested" ||
    current.status === "refreshing" ||
    current.status === "waiting_for_mfa"
  ) {
    return;
  }

  await updatePraktikaSession(mode, {
    status: "refresh_requested",
    message:
      mode.scope === "practice"
        ? "Practice Praktika refresh requested. Waiting for local helper machine."
        : "Your Praktika refresh was requested. Waiting for local helper machine.",
    refresh_requested_at: new Date().toISOString(),
  });
}

export async function savePraktikaMfaCode({
  mode,
  code,
}: {
  mode: PraktikaSessionMode;
  code: string;
}) {
  const now = new Date().toISOString();

  await updatePraktikaSession(mode, {
    mfa_code: code.replace(/\D/g, "").trim(),
    mfa_code_updated_at: now,
    status: "refresh_requested",
    message:
      "MFA code received. Waiting for the local Praktika helper to finish signing in.",
    refresh_requested_at: now,
  });
}

export async function clearTemporaryPraktikaCredentials(
  mode: PraktikaSessionMode,
  options: {
    clearUsername?: boolean;
    message?: string;
    status?: PraktikaSessionStatus;
  } = {},
) {
  await updatePraktikaSession(mode, {
    pending_praktika_password: null,
    ...(options.clearUsername ? { pending_praktika_username: null } : {}),
    ...(options.status ? { status: options.status } : {}),
    ...(options.message ? { message: options.message } : {}),
  });
}