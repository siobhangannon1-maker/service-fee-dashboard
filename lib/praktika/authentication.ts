import { hasLivePraktikaHelper, type HelperHealth } from "./helper-lease";

const configuredFreshness = Number(process.env.PRAKTIKA_AUTH_FRESHNESS_MS || 120_000);
export const PRAKTIKA_AUTH_FRESHNESS_MS = Number.isFinite(configuredFreshness) && configuredFreshness > 0
  ? configuredFreshness : 120_000;

export function hasFreshPraktikaAuthentication(row: HelperHealth, now = Date.now()) {
  const authenticated = Date.parse(row.authenticated_at || "");
  return hasLivePraktikaHelper(row, now) && Number.isFinite(authenticated) && authenticated <= now &&
    now - authenticated < PRAKTIKA_AUTH_FRESHNESS_MS;
}

export type PraktikaConnectionRow = HelperHealth & {
  status: string;
  cookie?: string | null;
  current_url?: string | null;
  message?: string | null;
};
export type EffectivePraktikaStatus = "connected" | "refreshing" | "refresh_requested" | "idle" |
  "not_started" | "waiting_for_credentials" | "waiting_for_mfa" | "expired" | "error";

// Stored status is the login/workflow phase. Live connection additionally needs
// the current owner's lease AND recent GST proof. Cookies/URLs cannot grant proof.
export function derivePraktikaConnection(row: PraktikaConnectionRow, now = Date.now()) {
  const helperAlive = hasLivePraktikaHelper(row, now);
  const authenticationVerified = hasFreshPraktikaAuthentication(row, now);
  let status: EffectivePraktikaStatus;
  let message: string;
  if (row.status === "waiting_for_credentials" || row.status === "waiting_for_mfa" || row.status === "error" || row.status === "expired") {
    status = row.status;
    message = row.message || "Praktika needs attention before work can continue.";
  } else if (row.status === "refresh_requested") {
    status = "refresh_requested";
    message = "Praktika connection verification has been requested.";
  } else if (!helperAlive) {
    status = row.cookie || row.current_url ? "idle" : "not_started";
    message = status === "idle" ? "Praktika helper is idle. Reconnect or queue work to verify the saved session." : "No live Praktika helper is available.";
  } else if (!authenticationVerified || row.status === "refreshing") {
    status = "refreshing";
    message = "Praktika authentication is unverified. Reconnect or queue work to check it.";
  } else {
    status = "connected";
    message = "Praktika helper is live and authentication was recently verified.";
  }
  return { status, message, connected: status === "connected", helperAlive, authenticationVerified };
}
