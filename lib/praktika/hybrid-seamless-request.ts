import "server-only";

import {
  getPraktikaSession,
  markPraktikaRefreshRequested,
  updatePraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

export class PraktikaNeedsMfaError extends Error {
  constructor(message = "Praktika is waiting for MFA.") {
    super(message);
    this.name = "PraktikaNeedsMfaError";
  }
}

export class PraktikaNeedsCredentialsError extends Error {
  constructor(message = "Praktika is waiting for credentials.") {
    super(message);
    this.name = "PraktikaNeedsCredentialsError";
  }
}

export class PraktikaRefreshTimeoutError extends Error {
  constructor(message = "Timed out waiting for Praktika refresh.") {
    super(message);
    this.name = "PraktikaRefreshTimeoutError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelySessionProblem(error: any) {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("no praktika cookie") ||
    message.includes("missing praktika_cookie") ||
    message.includes("missing praktika session cookie") ||
    message.includes("session expired") ||
    message.includes("praktika session expired") ||
    message.includes("returned login page") ||
    message.includes("hijacked or expired session") ||
    message.includes("expired session") ||
    message.includes("hijacked") ||
    message.includes("logged out") ||
    message.includes("logged-out") ||
    message.includes("not logged in") ||
    message.includes("html instead of json") ||
    message.includes("non-json") ||
    message.includes("praktika did not return json") ||
    message.includes("login failed") ||
    message.includes("user session is logged-out") ||
    message.includes("user session is logged out") ||
    message.includes("dbunauthorisedexception") ||
    message.includes("fisisloggedin") ||
    message.includes("fisloggedin")
  );
}

async function markSessionExpired(mode: PraktikaSessionMode, message: string) {
  await updatePraktikaSession(mode, {
    status: "expired",
    message,
  });
}

export async function waitForPraktikaConnected(
  mode: PraktikaSessionMode = { scope: "practice" },
  { timeoutMs = 300_000, intervalMs = 3_000 }: WaitOptions = {},
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const session = await getPraktikaSession(mode);

    if (session.status === "connected" && session.cookie) {
      return session.cookie;
    }

    if (session.status === "waiting_for_mfa") {
      throw new PraktikaNeedsMfaError(
        "Praktika needs an MFA code. Enter the code in the Praktika Session panel, then try again.",
      );
    }

    if (session.status === "waiting_for_credentials") {
      throw new PraktikaNeedsCredentialsError(
        "Praktika needs username/password entry in the Praktika Session panel.",
      );
    }

    if (session.status === "error") {
      throw new Error(session.message || "Praktika refresh failed.");
    }

    await sleep(intervalMs);
  }

  throw new PraktikaRefreshTimeoutError(
    "Praktika refresh was requested but did not complete in time. Check that the local helper machine is running.",
  );
}

export async function withPraktikaAutoRefresh<T>(
  action: () => Promise<T>,
  options: WaitOptions & { mode?: PraktikaSessionMode } = {},
): Promise<T> {
  const mode = options.mode || { scope: "practice" as const };

  try {
    return await action();
  } catch (error: any) {
    console.log("Hybrid Praktika wrapper caught error:", error?.message);

    if (!isLikelySessionProblem(error)) {
      console.log("Hybrid Praktika wrapper decided this is NOT a session problem.");
      throw error;
    }

    await markSessionExpired(
      mode,
      error?.message ||
        "Praktika session expired. A refresh has been requested.",
    );

    console.log("Hybrid Praktika wrapper requesting refresh.");

    await markPraktikaRefreshRequested(mode);
    await waitForPraktikaConnected(mode, options);

    console.log("Hybrid Praktika wrapper retrying original request.");

    return await action();
  }
}