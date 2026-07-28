import "server-only";

import {
  getPraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

type DisconnectedStatus =
  | "not_started"
  | "expired"
  | "error"
  | "refresh_requested"
  | "refreshing"
  | "waiting_for_mfa"
  | "waiting_for_credentials";

type ValidateResult =
  | {
      connected: true;
      status: "connected";
      message: string;
    }
  | {
      connected: false;
      status: DisconnectedStatus;
      reason: string;
      message: string;
    };

/**
 * This function reports the saved helper/browser state.
 *
 * It deliberately does not:
 * - promote "refreshing" to "connected";
 * - treat a stored cookie as proof of an active browser session;
 * - update last_used_at merely because a status check was performed.
 *
 * Only the Playwright Praktika helper should change a session to "connected"
 * after it has confirmed that the browser UI is logged in.
 */
export async function validatePraktikaSession(
  mode: PraktikaSessionMode = { scope: "practice" },
): Promise<ValidateResult> {
  const session = await getPraktikaSession(mode);

  const hasCookie = Boolean(session.cookie);
  const currentUrl = String(session.current_url || "").toLowerCase();

  const isLoginOrLogoutUrl =
    currentUrl.includes("/login") ||
    currentUrl.includes("/v2/login") ||
    currentUrl.includes("/logout");

  if (session.status === "connected") {
    if (!hasCookie) {
      return {
        connected: false,
        status: "not_started",
        reason: "missing_cookie",
        message:
          mode.scope === "practice"
            ? "The practice Praktika session has no saved browser cookies."
            : "Your Praktika session has no saved browser cookies.",
      };
    }

    if (isLoginOrLogoutUrl) {
      return {
        connected: false,
        status: "expired",
        reason: "login_or_logout_url",
        message:
          "The Praktika helper is currently on a login or logout page.",
      };
    }

    return {
      connected: true,
      status: "connected",
      message:
        session.message ||
        "The Praktika helper browser is marked as connected.",
    };
  }

  if (session.status === "waiting_for_mfa") {
    return {
      connected: false,
      status: "waiting_for_mfa",
      reason: "waiting_for_mfa",
      message: session.message || "Praktika is waiting for an MFA code.",
    };
  }

  if (session.status === "waiting_for_credentials") {
    return {
      connected: false,
      status: "waiting_for_credentials",
      reason: "waiting_for_credentials",
      message:
        session.message || "Praktika login details are required.",
    };
  }

  if (session.status === "refresh_requested") {
    return {
      connected: false,
      status: "refresh_requested",
      reason: "refresh_requested",
      message:
        session.message ||
        "A Praktika reconnection has been requested.",
    };
  }

  if (session.status === "refreshing") {
    return {
      connected: false,
      status: "refreshing",
      reason: "refreshing",
      message:
        session.message ||
        "The Praktika helper is checking or reconnecting the browser session.",
    };
  }

  if (session.status === "expired") {
    return {
      connected: false,
      status: "expired",
      reason: "expired",
      message: session.message || "The Praktika session has expired.",
    };
  }

  if (session.status === "error") {
    return {
      connected: false,
      status: "error",
      reason: "error",
      message:
        session.message || "The Praktika connection has encountered an error.",
    };
  }

  return {
    connected: false,
    status: "not_started",
    reason: "not_started",
    message:
      session.message || "The Praktika session has not been started.",
  };
}