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
].join(" ");

export async function getXeroAccessToken(): Promise<string> {
  const basicAuth = Buffer.from(
    `${xeroClientId}:${xeroClientSecret}`
  ).toString("base64");

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
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get Xero access token: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as XeroTokenResponse;

  if (!data.access_token) {
    throw new Error("Xero token response did not include access_token");
  }

  return data.access_token;
}

export async function fetchXeroOrganisation(accessToken: string) {
  const response = await fetch("https://api.xero.com/api.xro/2.0/Organisation", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Xero organisation: ${response.status} ${errorText}`
    );
  }

  return response.json();
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch Xero Profit and Loss report: ${response.status} ${errorText}`
    );
  }

  return response.json();
}