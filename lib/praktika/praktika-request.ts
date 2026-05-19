import {
  getPraktikaCookie,
  markPraktikaRefreshRequested,
  updatePraktikaSession,
} from "@/lib/praktika/session-store";

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
    lower.includes("user session is logged out")
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
      message: "Praktika returned a login/session response.",
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
}: {
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
}) {
  const url = `${PRAKTIKA_APP_BASE_URL}${requestPath}`;

  let initialCookie: string;

try {
  initialCookie = await getPraktikaCookie();
} catch {
  await markPraktikaRefreshRequested();

  throw new Error(
    "No Praktika cookie is saved yet. Refresh has been requested. Open the Praktika Session panel and complete MFA if needed.",
  );
}

  const firstAttempt = await makeRequest({
    url,
    method,
    headers,
    body,
    cookie: initialCookie,
  });

  if (firstAttempt.ok) {
  await updatePraktikaSession({
    status: "connected",
    message: "Praktika connection is active.",
  });

  return firstAttempt.data;
}

  if (firstAttempt.reason !== "auth") {
    throw new Error(firstAttempt.message);
  }

  await updatePraktikaSession({
    status: "expired",
    message:
      "Praktika cookie appears expired. Refresh requested from local helper machine.",
  });

  await markPraktikaRefreshRequested();

  throw new Error(
    "Praktika session expired. Refresh has been requested. Open the Praktika Session panel and complete MFA if needed.",
  );
}

export async function fetchPraktikaJson({
  path: requestPath,
  method = "POST",
  headers,
  body,
}: {
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
}) {
  const json = await requestPraktikaJson({
    path: requestPath,
    method,
    headers,
    body,
  });

  if (!Array.isArray(json)) {
    throw new Error(
      "Praktika report endpoint did not return an array. Check endpoint, payload, session, or response format.",
    );
  }

  return json;
}