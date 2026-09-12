import { hasLivePraktikaHelper, type HelperHealth } from "./helper-lease";

const configuredFreshness = Number(process.env.PRAKTIKA_AUTH_FRESHNESS_MS || 120_000);
export const PRAKTIKA_AUTH_FRESHNESS_MS = Number.isFinite(configuredFreshness) && configuredFreshness > 0
  ? configuredFreshness : 120_000;

export function hasFreshPraktikaAuthentication(row: HelperHealth, now = Date.now()) {
  const authenticated = Date.parse(row.authenticated_at || "");
  return hasLivePraktikaHelper(row, now) && Number.isFinite(authenticated) && authenticated <= now &&
    now - authenticated < PRAKTIKA_AUTH_FRESHNESS_MS;
}

export type ExperimentalEvidence = {
  app_user_id?: string | null;
  status?: string;
  current_url?: string | null;
  experimental_auth_status?: string | null;
  experimental_auth_at?: string | null;
  experimental_helper_instance_id?: string | null;
};
export function praktikaExperimentEnabled(row: ExperimentalEvidence) {
  const scope = process.env.PRAKTIKA_EXPERIMENT_USER_ID?.trim();
  return process.env.PRAKTIKA_EXPERIMENT_ACCEPT_200_OR_307 === "true" &&
    (!scope || (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scope) && row.app_user_id === scope));
}
// No global fallback: this temporary mode requires an explicit matching user.
export function praktikaNoAuthGateEnabled(row: ExperimentalEvidence) {
  const user = process.env.PRAKTIKA_EXPERIMENT_USER_ID?.trim();
  return process.env.PRAKTIKA_EXPERIMENT_NO_AUTH_GATE === "true" && !!user &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user) && row.app_user_id === user;
}

export function hasPraktikaChallenge(row: ExperimentalEvidence) {
  if (["waiting_for_credentials", "waiting_for_mfa"].includes(row.status || "")) return true;
  try { const url = new URL(row.current_url || ""); return url.origin === "https://praktika.praktika.net.au" && ["/v2/login", "/v2/logout", "/logout"].includes(url.pathname.replace(/\/$/, "")); } catch { return false; }
}
export function hasExperimentalPraktikaEligibility(row: HelperHealth & ExperimentalEvidence, now = Date.now()) {
  const at = Date.parse(row.experimental_auth_at || "");
  return ["connected", "refreshing"].includes(row.status || "") && !hasPraktikaChallenge(row) &&
    praktikaExperimentEnabled(row) && hasLivePraktikaHelper(row, now) &&
    row.experimental_auth_status === "eligible_307" &&
    row.experimental_helper_instance_id === row.helper_instance_id &&
    Number.isFinite(at) && at <= now && now - at < PRAKTIKA_AUTH_FRESHNESS_MS;
}

export type PraktikaConnectionRow = HelperHealth & ExperimentalEvidence & {
  status: string;
  cookie?: string | null;
  current_url?: string | null;
  message?: string | null;
};
export type EffectivePraktikaStatus = "connected" | "checking_connection" | "refreshing" | "refresh_requested" | "idle" |
  "not_started" | "waiting_for_credentials" | "waiting_for_mfa" | "expired" | "error";

// Connected is written only by the owning helper after browser readiness checks.
// Historical proof and experiment fields are deliberately not consulted here.
export function derivePraktikaConnection(row: PraktikaConnectionRow, now = Date.now()) {
  const helperAlive = hasLivePraktikaHelper(row, now);
  let status: EffectivePraktikaStatus;
  if (hasPraktikaChallenge(row)) {
    status = row.status === "waiting_for_mfa" ? "waiting_for_mfa" : "waiting_for_credentials";
  } else if (!helperAlive) status = "not_started";
  else if (row.status === "connected") status = "connected";
  else if (["refreshing", "refresh_requested"].includes(row.status)) status = "refreshing";
  else status = "not_started";
  const message = status === "connected" ? "Praktika is connected."
    : status === "refreshing" ? "Praktika helper is connecting."
    : status === "waiting_for_mfa" ? "Praktika requires an MFA code."
    : status === "waiting_for_credentials" ? "Please log in to Praktika."
    : "Praktika is not connected.";
  return { status, message, connected: status === "connected", helperAlive };
}
