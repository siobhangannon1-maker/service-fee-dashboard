import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";

export const PRAKTIKA_APP_BASE_URL =
  process.env.PRAKTIKA_APP_BASE_URL || "https://praktika.praktika.net.au";

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
  const lower = text.toLowerCase();

  return (
    text.trim().startsWith("<!DOCTYPE") ||
    lower.includes("<html") ||
    lower.includes("/v2/login") ||
    lower.includes("login")
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
}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json, text/plain, */*",
      Cookie: cookie,
      Origin: PRAKTIKA_APP_BASE_URL,
      ...headers,
    },
    body,
    cache: "no-store",
  });

  const text = await response.text();

  if (looksLikeLoginResponse(text)) {
    return null;
  }

  try {
    const json = JSON.parse(text);

    if (!response.ok) {
      throw new Error(json?.error || `Praktika request failed with status ${response.status}`);
    }

    return json;
  } catch {
    console.log("Praktika non-JSON response preview:", text.slice(0, 500));
    return null;
  }
}

export async function requestPraktikaJson({
  path,
  method = "POST",
  headers,
  body,
}: {
  path: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: BodyInit | null;
}) {
  const url = `${PRAKTIKA_APP_BASE_URL}${path}`;
  const initialCookie = process.env.PRAKTIKA_COOKIE || loadPraktikaCookieFromEnvFile();

  const firstAttempt = await makeRequest({
    url,
    method,
    headers,
    body,
    cookie: initialCookie,
  });

  if (firstAttempt) return firstAttempt;

  const refreshedCookie = refreshPraktikaCookieLocally();

  const secondAttempt = await makeRequest({
    url,
    method,
    headers,
    body,
    cookie: refreshedCookie,
  });

  if (secondAttempt) return secondAttempt;

  throw new Error(
    "Praktika still did not return valid JSON after refreshing the cookie. MFA may be required."
  );
}