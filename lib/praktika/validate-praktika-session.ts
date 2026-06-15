import "server-only";

import {
  getPraktikaSession,
  updatePraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

type ValidateResult =
  | {
      connected: true;
      status: "connected";
      message: string;
    }
  | {
      connected: false;
      status:
        | "not_started"
        | "expired"
        | "error"
        | "refresh_requested"
        | "refreshing"
        | "waiting_for_mfa"
        | "waiting_for_credentials";
      reason: string;
      message: string;
    };

/**
 * IMPORTANT:
 * Do not validate Praktika by replaying copied cookies from Vercel/Next.js.
 * Praktika often rejects copied-cookie requests as "hijacked or expired session"
 * even while the local helper browser can still perform actions correctly.
 *
 * This status helper therefore reports the saved helper/session state only.
 * For routes converted to helper jobs, the real source of truth is whether the
 * local helper can process the job successfully.
 */
export async function validatePraktikaSession(
  mode: PraktikaSessionMode = { scope: "practice" },
): Promise<ValidateResult> {
  const session = await getPraktikaSession(mode);

  if (!session.cookie && session.status === "connected") {
    await updatePraktikaSession(mode, {
      status: "not_started",
      message:
        mode.scope === "practice"
          ? "Practice Praktika session has no saved browser session."
          : "Your Praktika session has no saved browser session.",
    });

    return {
      connected: false,
      status: "not_started",
      reason: "missing_cookie",
      message: "No Praktika browser session is saved for this user.",
    };
  }

  if (session.status === "connected" && session.cookie) {
    await updatePraktikaSession(mode, {
      last_used_at: new Date().toISOString(),
    });

    return {
      connected: true,
      status: "connected",
      message:
        session.message ||
        "Praktika helper session is marked connected. Helper jobs can be attempted.",
    };
  }

  if (session.status === "waiting_for_mfa") {
    return {
      connected: false,
      status: "waiting_for_mfa",
      reason: "waiting_for_mfa",
      message: session.message || "Praktika is waiting for MFA.",
    };
  }

  if (session.status === "waiting_for_credentials") {
    return {
      connected: false,
      status: "waiting_for_credentials",
      reason: "waiting_for_credentials",
      message: session.message || "Praktika login details are needed.",
    };
  }

  if (session.status === "refresh_requested") {
    return {
      connected: false,
      status: "refresh_requested",
      reason: "refresh_requested",
      message: session.message || "Praktika reconnect has been requested.",
    };
  }

  if (session.status === "refreshing") {
  if (session.cookie) {
    await updatePraktikaSession(mode, {
      status: "connected",
      message:
        session.message ||
        "Praktika cloud helper is connected. Helper jobs can be attempted.",
      last_used_at: new Date().toISOString(),
    });

    return {
      connected: true,
      status: "connected",
      message:
        session.message ||
        "Praktika cloud helper is connected. Helper jobs can be attempted.",
    };
  }

  return {
    connected: false,
    status: "refreshing",
    reason: "refreshing",
    message: session.message || "Praktika helper is reconnecting.",
  };
}

  if (session.status === "expired") {
    return {
      connected: false,
      status: "expired",
      reason: "expired",
      message: session.message || "Praktika session has expired.",
    };
  }

  if (session.status === "error") {
    return {
      connected: false,
      status: "error",
      reason: "error",
      message: session.message || "Praktika connection has an error.",
    };
  }

  return {
    connected: false,
    status: "not_started",
    reason: "not_started",
    message: session.message || "Praktika session has not been started.",
  };
}
