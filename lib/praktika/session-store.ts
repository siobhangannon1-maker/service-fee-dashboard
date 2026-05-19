import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

const SESSION_ID = "main";

export type PraktikaSessionStatus =
  | "not_started"
  | "connected"
  | "refreshing"
  | "waiting_for_mfa"
  | "refresh_requested"
  | "expired"
  | "error";

export type PraktikaSessionState = {
  id: string;
  cookie: string | null;
  status: PraktikaSessionStatus;
  message: string | null;
  current_url: string | null;
  mfa_code: string | null;
  mfa_code_updated_at: string | null;
  refresh_requested_at: string | null;
  updated_at: string;
};

export async function getPraktikaSession() {
  const { data, error } = await supabaseAdmin
    .from("praktika_session")
    .select("*")
    .eq("id", SESSION_ID)
    .single();

  if (error) {
    throw new Error(`Could not load Praktika session: ${error.message}`);
  }

  return data as PraktikaSessionState;
}

export async function getPraktikaCookie() {
  const session = await getPraktikaSession();

  if (!session.cookie) {
    throw new Error("No Praktika cookie has been saved yet.");
  }

  return session.cookie;
}

export async function updatePraktikaSession(
  values: Partial<Omit<PraktikaSessionState, "id" | "updated_at">>,
) {
  const { error } = await supabaseAdmin
    .from("praktika_session")
    .upsert({
      id: SESSION_ID,
      ...values,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Could not update Praktika session: ${error.message}`);
  }
}

export async function savePraktikaCookie(cookie: string) {
  await updatePraktikaSession({
    cookie,
    status: "connected",
    message: "Praktika connection is active.",
    mfa_code: null,
    mfa_code_updated_at: null,
  });
}

export async function savePraktikaMfaCode(code: string) {
  await updatePraktikaSession({
    mfa_code: code,
    mfa_code_updated_at: new Date().toISOString(),
    status: "waiting_for_mfa",
    message: "MFA code received. Waiting for local Praktika helper to use it.",
  });
}

export async function markPraktikaRefreshRequested() {
  await updatePraktikaSession({
    status: "refresh_requested",
    message: "Praktika refresh requested. Waiting for local helper machine.",
    refresh_requested_at: new Date().toISOString(),
  });
}