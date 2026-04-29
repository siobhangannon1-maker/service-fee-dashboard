import "server-only";

type XeroTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

const xeroClientId = process.env.XERO_CLIENT_ID;
const xeroClientSecret = process.env.XERO_CLIENT_SECRET;

if (!xeroClientId) {
  throw new Error("Missing XERO_CLIENT_ID");
}

if (!xeroClientSecret) {
  throw new Error("Missing XERO_CLIENT_SECRET");
}

const XERO_SCOPES = [
  "accounting.settings.read",
  "accounting.reports.read",
  "accounting.transactions.read",
  "accounting.transactions",
  "payroll.employees.read",
  "payroll.payruns.read",
  "payroll.payslip.read",
  "payroll.settings.read",
].join(" ");

let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(ms: number) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, ms);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

export async function getXeroAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedAccessToken && cachedAccessTokenExpiresAt > now + 60_000) {
    return cachedAccessToken;
  }

  const basicAuth = Buffer.from(
    `${xeroClientId}:${xeroClientSecret}`
  ).toString("base64");

  const timeout = withTimeout(20_000);

  try {
    const response = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: XERO_SCOPES,
      }),
      cache: "no-store",
      signal: timeout.signal,
    });

    const text = await response.text();

    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to get Xero access token: ${response.status} ${JSON.stringify(
          data
        )}`
      );
    }

    const tokenData = data as XeroTokenResponse;

    console.log("Xero token scopes:", tokenData.scope);
console.log("Xero token type:", tokenData.token_type);
console.log("Xero token expires in:", tokenData.expires_in);

    if (!tokenData.access_token) {
      throw new Error("Xero token response did not include access_token");
    }

    cachedAccessToken = tokenData.access_token;
    cachedAccessTokenExpiresAt =
      Date.now() + Number(tokenData.expires_in || 1800) * 1000;

    return cachedAccessToken;
  } finally {
    timeout.clear();
  }
}

export async function xeroFetch(path: string, attempt = 1): Promise<any> {
  const accessToken = await getXeroAccessToken();

  const timeout = withTimeout(30_000);

  try {
    const response = await fetch(`https://api.xero.com/api.xro/2.0${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: timeout.signal,
    });

    const text = await response.text();

    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (response.status === 429) {
      if (attempt >= 3) {
        throw new Error(
          `Xero rate limit hit after ${attempt} attempts. Wait 1-2 minutes and try again.`
        );
      }

      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader
        ? Number(retryAfterHeader)
        : attempt * 10;

      const delayMs = Math.max(retryAfterSeconds, 5) * 1000;

      await sleep(delayMs);

      return xeroFetch(path, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(
        `Xero request failed: ${response.status} ${JSON.stringify(data)}`
      );
    }

    return data;
  } finally {
    timeout.clear();
  }
}

export async function fetchXeroOrganisation(accessToken: string) {
  const timeout = withTimeout(30_000);

  try {
    const response = await fetch(
      "https://api.xero.com/api.xro/2.0/Organisation",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: timeout.signal,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch Xero organisation: ${response.status} ${errorText}`
      );
    }

    return response.json();
  } finally {
    timeout.clear();
  }
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

export function getMonthDateRange(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Year must be a valid 4-digit year");
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Month must be between 1 and 12");
  }

  const fromDate = toIsoDate(year, month, 1);
  const toDate = toIsoDate(year, month, getLastDayOfMonth(year, month));

  return {
    fromDate,
    toDate,
    reportDate: toDate,
  };
}

export async function fetchXeroProfitAndLossReport(
  accessToken: string,
  year: number,
  month: number
) {
  const { fromDate, toDate } = getMonthDateRange(year, month);

  const url = new URL("https://api.xero.com/api.xro/2.0/Reports/ProfitAndLoss");
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set("timeframe", "MONTH");

  const timeout = withTimeout(30_000);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: timeout.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch Xero Profit and Loss report: ${response.status} ${errorText}`
      );
    }

    return response.json();
  } finally {
    timeout.clear();
  }
}