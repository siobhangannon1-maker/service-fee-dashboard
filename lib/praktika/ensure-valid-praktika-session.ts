import "server-only";

import {
  markPraktikaRefreshRequested,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { validatePraktikaSession } from "@/lib/praktika/validate-praktika-session";
import {
  waitForPraktikaConnected,
  PraktikaNeedsMfaError,
  PraktikaNeedsCredentialsError,
  PraktikaRefreshTimeoutError,
} from "@/lib/praktika/hybrid-seamless-request";

type EnsureOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  requestRefresh?: boolean;
};

export async function ensureValidPraktikaSession(
  mode: PraktikaSessionMode = { scope: "practice" },
  options: EnsureOptions = {},
) {
  const {
    timeoutMs = 300_000,
    intervalMs = 3_000,
    requestRefresh = true,
  } = options;

  const validation = await validatePraktikaSession(mode);

  if (validation.connected) {
    return {
      connected: true as const,
      refreshed: false,
      message: validation.message,
    };
  }

  if (!requestRefresh) {
    throw new Error(validation.message || "Praktika session is not connected.");
  }

  await markPraktikaRefreshRequested(mode);

  try {
    await waitForPraktikaConnected(mode, {
      timeoutMs,
      intervalMs,
    });

    return {
      connected: true as const,
      refreshed: true,
      message: "Praktika session refreshed successfully.",
    };
  } catch (error: any) {
    if (
      error instanceof PraktikaNeedsMfaError ||
      error instanceof PraktikaNeedsCredentialsError ||
      error instanceof PraktikaRefreshTimeoutError
    ) {
      throw error;
    }

    throw new Error(
      error?.message ||
        "Praktika session could not be refreshed automatically.",
    );
  }
}