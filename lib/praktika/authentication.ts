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
export function hasPraktikaChallenge(row: ExperimentalEvidence) {
  if (["waiting_for_credentials", "waiting_for_mfa"].includes(row.status || "")) return true;
  try { const url = new URL(row.current_url || ""); return url.origin === "https://praktika.praktika.net.au" && url.pathname === "/v2/login"; } catch { return false; }
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

// Connected requires both current ownership and fresh positive GST proof.
export function derivePraktikaConnection(row: PraktikaConnectionRow, now = Date.now()) {
  const helperAlive = hasLivePraktikaHelper(row, now);
  const authenticationVerified = hasFreshPraktikaAuthentication(row, now);
  let status: EffectivePraktikaStatus;
  let message: string;
  let loginPage = false;
  try {
    const url = new URL(row.current_url || "");
    loginPage = url.origin === "https://praktika.praktika.net.au" && url.pathname === "/v2/login";
  } catch { /* Missing URL is not positive or negative authentication evidence. */ }
  if (loginPage && row.status !== "waiting_for_mfa") {
    status = "waiting_for_credentials";
    message = "Please connect to Praktika.";
  } else if (row.status === "waiting_for_credentials" || row.status === "waiting_for_mfa" || row.status === "error" || row.status === "expired") {
    status = row.status;
    message = row.message || "Praktika needs attention before work can continue.";
  } else if (praktikaExperimentEnabled(row) && row.experimental_auth_status === "challenge" && row.experimental_helper_instance_id === row.helper_instance_id) {
    status = "waiting_for_credentials";
    message = "Please connect to Praktika.";
  } else if (row.status === "refresh_requested") {
    status = "refresh_requested";
    message = "Praktika connection verification has been requested.";
  } else if (!helperAlive) {
    status = row.cookie || row.current_url ? "idle" : "not_started";
    message = status === "idle" ? "Praktika helper is idle. Reconnect or queue work to verify the saved session." : "No live Praktika helper is available.";
  } else if (praktikaExperimentEnabled(row) && authenticationVerified) {
    status = "connected";
    message = "Praktika is connected.";
  } else if (hasExperimentalPraktikaEligibility(row, now)) {
    status = "connected";
    message = "Praktika is available under the temporary authentication experiment.";
  } else if (row.status === "refreshing") {
    status = "refreshing";
    message = "Praktika authentication is unverified. Reconnect or queue work to check it.";
  } else if (!authenticationVerified || row.status !== "connected") {
    status = "checking_connection";
    message = "Checking Praktika connection.";
  } else {
    status = "connected";
    message = "Praktika is connected.";
  }
  return { experimentalEligible: status === "connected" && !authenticationVerified && hasExperimentalPraktikaEligibility(row, now), status, message, connected: status === "connected", helperAlive, authenticationVerified };
}
