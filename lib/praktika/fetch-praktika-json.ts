import {
  getPraktikaCookie,
  updatePraktikaSession,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

const PRAKTIKA_APP_BASE_URL =
  process.env.PRAKTIKA_APP_BASE_URL || "https://praktika.praktika.net.au";

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

function exceptionLooksLikeExpiredSession(data: any): boolean {
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

async function markExpired(mode: PraktikaSessionMode, message: string) {
  await updatePraktikaSession(mode, {
    status: "expired",
    message,
  });
}

export async function fetchPraktikaJson(
  params: URLSearchParams,
  referer: string,
  mode: PraktikaSessionMode = { scope: "practice" },
) {
  const cookie = await getPraktikaCookie(mode);

  const response = await fetch(
    `${PRAKTIKA_APP_BASE_URL}/php/json/db_reportingDataWarehouse.php`,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Origin: PRAKTIKA_APP_BASE_URL,
        Referer: referer,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      },
      body: params.toString(),
      cache: "no-store",
    },
  );

  const text = await response.text();

  if (looksLikeLoginResponse(text)) {
    await markExpired(
      mode,
      "Praktika returned the login page. Session has expired.",
    );

    throw new Error("Praktika session expired or returned login page.");
  }

  let data: any;

  try {
    data = JSON.parse(text);
  } catch {
    console.log("Praktika non-JSON response preview:", text.slice(0, 500));

    await markExpired(
      mode,
      "Praktika returned non-JSON. Session may have expired.",
    );

    throw new Error("Praktika did not return JSON.");
  }

  if (data?.exception) {
    const message =
      data.exception.message ||
      data.exception.error ||
      "Praktika returned an exception.";

    if (exceptionLooksLikeExpiredSession(data)) {
      await markExpired(mode, String(message));
    }

    throw new Error(String(message));
  }

  if (!response.ok) {
    const message =
      data?.error ||
      data?.message ||
      `Praktika request failed with status ${response.status}`;

    if (response.status === 401 || exceptionLooksLikeExpiredSession(data)) {
      await markExpired(mode, String(message));
    }

    throw new Error(String(message));
  }

  if (!Array.isArray(data)) {
    console.log("Praktika non-array report response:", data);
    throw new Error("Praktika did not return a report array.");
  }

  return data as any[];
}