import {
  getPraktikaCookie,
  updatePraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

export const PRAKTIKA_APP_BASE_URL =
  process.env.PRAKTIKA_APP_BASE_URL || "https://praktika.praktika.net.au";

type PraktikaFailureReason =
  | "auth"
  | "non_json"
  | "praktika_exception"
  | "http_error";

type PraktikaRequestResult =
  | {
      ok: true;
      reason: null;
      data: any;
      message?: string;
    }
  | {
      ok: false;
      reason: PraktikaFailureReason;
      data: any;
      message: string;
    };

function looksLikeLoginResponse(text: string): boolean {
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
    lower.includes("user session is logged out") ||
    lower.includes("logged-out") ||
    lower.includes("logged out")
  );
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getPraktikaExceptionMessage(json: any) {
  const exception = json?.exception;

  if (!exception) return null;

  const message = String(exception.message || exception.error || "").trim();

  if (message) return message;

  if (exception.code) {
    return `Praktika returned exception code ${exception.code}.`;
  }

  return "Praktika returned an exception.";
}

function isAuthException(json: any) {
  const message = String(getPraktikaExceptionMessage(json) || "").toLowerCase();

  return (
    Boolean(json?.exception) &&
    (message.includes("login failed") ||
      message.includes("logged-out") ||
      message.includes("logged out") ||
      message.includes("not logged in") ||
      message.includes("unauthorised") ||
      message.includes("unauthorized") ||
      message.includes("session is logged"))
  );
}

async function makeRequest({
  url,
  method,
  headers,
  body,
  cookie,
}: {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
  cookie: string;
}): Promise<PraktikaRequestResult> {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: cookie,
      Origin: PRAKTIKA_APP_BASE_URL,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      ...headers,
    },
    body,
    cache: "no-store",
  });

  const text = await response.text();

  if (looksLikeLoginResponse(text)) {
    return {
      ok: false,
      reason: "auth",
      data: null,
      message: "Praktika session expired or returned a login page.",
    };
  }

  if (!looksLikeJson(text)) {
    console.log("Praktika non-JSON response preview:", text.slice(0, 500));

    return {
      ok: false,
      reason: "non_json",
      data: null,
      message: "Praktika did not return JSON.",
    };
  }

  let json: any;

  try {
    json = JSON.parse(text);
  } catch {
    console.log("Praktika JSON parse failed preview:", text.slice(0, 500));

    return {
      ok: false,
      reason: "non_json",
      data: null,
      message: "Praktika returned invalid JSON.",
    };
  }

  if (json?.exception) {
    const message =
      getPraktikaExceptionMessage(json) || "Praktika returned an exception.";

    if (isAuthException(json)) {
      return {
        ok: false,
        reason: "auth",
        data: json,
        message,
      };
    }

    return {
      ok: false,
      reason: "praktika_exception",
      data: json,
      message,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "http_error",
      data: json,
      message:
        json?.error ||
        json?.message ||
        `Praktika request failed with status ${response.status}`,
    };
  }

  return {
    ok: true,
    reason: null,
    data: json,
  };
}

export async function requestPraktikaJson({
  path: requestPath,
  method = "POST",
  headers,
  body,
  mode = { scope: "practice" },
}: {
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
  mode?: PraktikaSessionMode;
}) {
  const url = `${PRAKTIKA_APP_BASE_URL}${requestPath}`;
  const cookie = await getPraktikaCookie(mode);

  const result = await makeRequest({
    url,
    method,
    headers,
    body,
    cookie,
  });

  if (result.ok) {
    await updatePraktikaSession(mode, {
      status: "connected",
      message: "Praktika connection is active.",
      last_used_at: new Date().toISOString(),
    });

    return result.data;
  }

  if (result.reason === "auth") {
    await updatePraktikaSession(mode, {
      status: "expired",
      message:
        "Praktika cookie appears expired. Refresh requested from local helper machine.",
    });

    throw new Error("Praktika session expired or returned login page.");
  }

  throw new Error(result.message);
}

export async function praktikaRequest({
  path: requestPath,
  method = "POST",
  headers,
  body,
  mode = { scope: "practice" },
}: {
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
  mode?: PraktikaSessionMode;
}) {
  const json = await requestPraktikaJson({
    path: requestPath,
    method,
    headers,
    body,
    mode,
  });

  if (!Array.isArray(json)) {
    throw new Error(
      "Praktika report endpoint did not return an array. Check endpoint, payload, session, or response format.",
    );
  }

  return json;
}
