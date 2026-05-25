import "server-only";

import {
  getPraktikaSession,
  updatePraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

const PRAKTIKA_APP_BASE_URL =
  process.env.PRAKTIKA_APP_BASE_URL || "https://praktika.praktika.net.au";

const PRAKTIKA_PRACTICE_ID = process.env.PRAKTIKA_PRACTICE_ID || "1181";

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
        | "waiting_for_mfa";
      reason: string;
      message: string;
    };

function looksLikeLoginResponse(text: string) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  return (
    trimmed.startsWith("<!DOCTYPE") ||
    lower.startsWith("<html") ||
    lower.includes("<title>login") ||
    lower.includes("/v2/login") ||
    lower.includes('name="password"') ||
    lower.includes('type="password"') ||
    lower.includes("login failed") ||
    lower.includes("user session is logged-out") ||
    lower.includes("user session is logged out")
  );
}

function looksLikeExpiredJson(data: any) {
  const message = String(
    data?.exception?.message ||
      data?.exception?.error ||
      data?.message ||
      data?.error ||
      "",
  ).toLowerCase();

  return (
    message.includes("hijacked or expired session") ||
    message.includes("expired session") ||
    message.includes("session expired") ||
    message.includes("hijacked") ||
    message.includes("logged out") ||
    message.includes("logged-out") ||
    message.includes("not logged in") ||
    message.includes("dbunauthorisedexception")
  );
}

export async function validatePraktikaSession(
  mode: PraktikaSessionMode = { scope: "practice" },
): Promise<ValidateResult> {
  const session = await getPraktikaSession(mode);

  if (
    session.status === "waiting_for_mfa" ||
    session.status === "refresh_requested" ||
    session.status === "refreshing"
  ) {
    return {
      connected: false,
      status: session.status,
      reason: session.status,
      message: session.message || "Praktika reconnect is in progress.",
    };
  }

  if (!session.cookie) {
    await updatePraktikaSession(mode, {
      status: "not_started",
      message:
        mode.scope === "practice"
          ? "Practice Praktika session has no saved cookie."
          : "Your Praktika session is not connected yet.",
    });

    return {
      connected: false,
      status: "not_started",
      reason: "missing_cookie",
      message: "No Praktika cookie is saved for this session.",
    };
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    const body = new URLSearchParams();
    body.append("sReportName", "appointments");
    body.append("bByCreationTime", "false");
    body.append("iPracticeIds[]", PRAKTIKA_PRACTICE_ID);
    body.append("sFromDate", today);
    body.append("sToDate", today);

    const response = await fetch(
      `${PRAKTIKA_APP_BASE_URL}/php/json/db_reportingDataWarehouse.php`,
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: session.cookie,
          Origin: PRAKTIKA_APP_BASE_URL,
          Referer: `${PRAKTIKA_APP_BASE_URL}/v2/reports/appointments`,
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
        },
        body: body.toString(),
        cache: "no-store",
      },
    );

    const text = await response.text();

    if (response.status === 401 || looksLikeLoginResponse(text)) {
      await updatePraktikaSession(mode, {
        status: "expired",
        message: "Praktika session has expired. Please reconnect.",
      });

      return {
        connected: false,
        status: "expired",
        reason: "expired",
        message: "Praktika session has expired.",
      };
    }

    let data: any = null;

    try {
      data = JSON.parse(text);
    } catch {
      await updatePraktikaSession(mode, {
        status: "expired",
        message:
          "Praktika validation returned non-JSON. The saved cookie may be stale.",
      });

      return {
        connected: false,
        status: "expired",
        reason: "non_json",
        message:
          "Praktika validation returned non-JSON. The saved cookie may be stale.",
      };
    }

    if (looksLikeExpiredJson(data)) {
      const message =
        data?.exception?.message ||
        data?.message ||
        "Praktika session has expired.";

      await updatePraktikaSession(mode, {
        status: "expired",
        message,
      });

      return {
        connected: false,
        status: "expired",
        reason: "expired",
        message,
      };
    }

    if (!Array.isArray(data)) {
      await updatePraktikaSession(mode, {
        status: "error",
        message: "Praktika validation returned unexpected data.",
      });

      return {
        connected: false,
        status: "error",
        reason: "unexpected_response",
        message: "Praktika validation returned unexpected data.",
      };
    }

    await updatePraktikaSession(mode, {
      status: "connected",
      message: "Praktika session validated successfully.",
      last_used_at: new Date().toISOString(),
    });

    return {
      connected: true,
      status: "connected",
      message: "Praktika session validated successfully.",
    };
  } catch (error: any) {
    await updatePraktikaSession(mode, {
      status: "error",
      message:
        error?.message || "Could not validate Praktika session connection.",
    });

    return {
      connected: false,
      status: "error",
      reason: "validation_error",
      message:
        error?.message || "Could not validate Praktika session connection.",
    };
  }
}