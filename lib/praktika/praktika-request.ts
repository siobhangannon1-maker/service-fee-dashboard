import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";

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

function loadPraktikaCookieFromEnvFile(): string {
  const envPath = path.join(process.cwd(), ".env.local");

  if (!fs.existsSync(envPath)) {
    throw new Error("Missing .env.local file.");
  }

  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const cookie = parsed.PRAKTIKA_COOKIE;

  if (!cookie) {
    throw new Error("PRAKTIKA_COOKIE was not found in .env.local.");
  }

  process.env.PRAKTIKA_COOKIE = cookie;

  return cookie;
}

function refreshPraktikaCookieLocally(): string {
  console.log("Refreshing Praktika cookie...");

  execFileSync("npm", ["run", "refresh:praktika-cookie"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  return loadPraktikaCookieFromEnvFile();
}

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

      /*
        These browser-like headers help some Praktika endpoints behave the same
        as the logged-in browser request.
      */
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

  /*
    Important:
    Patient search is a NON-report endpoint. It correctly returns an object:
      { rows: [...] }

    So do not require a top-level array here.

    But Praktika can also return:
      { exception: { message: "Login failed. User session is logged-out." } }

    That must trigger cookie refresh.
  */
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

/*
  Use this for NON-report Praktika endpoints, including:
  - /php/json/db_gridPatientList.php
  - endpoints that return { rows: [...] }
  - endpoints that return plain objects
*/
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

  const initialCookie =
    process.env.PRAKTIKA_COOKIE || loadPraktikaCookieFromEnvFile();

  const firstAttempt = await makeRequest({
    url,
    method,
    headers,
    body,
    cookie: initialCookie,
  });

  if (firstAttempt.ok) {
    return firstAttempt.data;
  }

  if (firstAttempt.reason !== "auth") {
    throw new Error(firstAttempt.message);
  }

  const refreshedCookie = refreshPraktikaCookieLocally();

  const secondAttempt = await makeRequest({
    url,
    method,
    headers,
    body,
    cookie: refreshedCookie,
  });

  if (secondAttempt.ok) {
    return secondAttempt.data;
  }

  if (secondAttempt.reason === "auth") {
    throw new Error(
      `Praktika still appears logged out after refreshing the cookie. ${secondAttempt.message} MFA/manual login may be required.`,
    );
  }

  throw new Error(secondAttempt.message);
}

/*
  Use this ONLY for reporting endpoints that should return a top-level array,
  especially:
  - /php/json/db_reportingDataWarehouse.php
*/
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
