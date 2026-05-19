import {
  getPraktikaSession,
  markPraktikaRefreshRequested,
} from "@/lib/praktika/session-store";

type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

export class PraktikaNeedsMfaError extends Error {
  constructor(
    message = "Praktika is waiting for MFA. Enter the code in the Praktika Session panel, then try again.",
  ) {
    super(message);
    this.name = "PraktikaNeedsMfaError";
  }
}

export class PraktikaRefreshTimeoutError extends Error {
  constructor(
    message = "Timed out waiting for Praktika refresh. Check that the local helper machine is running.",
  ) {
    super(message);
    this.name = "PraktikaRefreshTimeoutError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPraktikaSessionProblem(error: unknown) {
  const message = String(
    error instanceof Error ? error.message : error || "",
  ).toLowerCase();

  return (
    message.includes("no praktika cookie") ||
    message.includes("missing praktika_cookie") ||
    message.includes("praktika cookie") ||
    message.includes("session expired") ||
    message.includes("refresh has been requested") ||
    message.includes("logged out") ||
    message.includes("logged-out") ||
    message.includes("not logged in") ||
    message.includes("login") ||
    message.includes("html instead of json") ||
    message.includes("non-json") ||
    message.includes("did not return json") ||
    message.includes("user session")
  );
}

export async function waitForPraktikaConnected({
  timeoutMs = 90000,
  intervalMs = 3000,
}: WaitOptions = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const session = await getPraktikaSession();

    if (session.status === "connected" && session.cookie) {
      return session.cookie;
    }

    if (session.status === "waiting_for_mfa") {
      throw new PraktikaNeedsMfaError();
    }

    if (session.status === "error") {
      throw new Error(session.message || "Praktika refresh failed.");
    }

    await sleep(intervalMs);
  }

  throw new PraktikaRefreshTimeoutError();
}

export async function withPraktikaAutoRefresh<T>(
  action: () => Promise<T>,
  options: WaitOptions = {},
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isPraktikaSessionProblem(error)) {
      throw error;
    }

    await markPraktikaRefreshRequested();
    await waitForPraktikaConnected(options);

    return await action();
  }
}
