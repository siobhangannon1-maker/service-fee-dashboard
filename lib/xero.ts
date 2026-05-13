import "server-only";

type XeroTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
};

type XeroFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: any;
  headers?: Record<string, string>;
  rawBody?: boolean;
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
  "accounting.contacts",
  "accounting.attachments",
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

function parseMaybeJson(text: string, context: string) {
  if (!text || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringifyForError(value: any) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    const data = parseMaybeJson(text, "Xero token response") as
      | XeroTokenResponse
      | string
      | null;

    if (!response.ok) {
      throw new Error(
        `Failed to get Xero access token: ${response.status} ${stringifyForError(
          data
        )}`
      );
    }

    if (!data || typeof data === "string") {
      throw new Error(
        `Xero token response was not valid JSON. Status: ${response.status}. Body: ${text.slice(
          0,
          500
        )}`
      );
    }

    if (!data.access_token) {
      throw new Error(
        `Xero token response did not include access_token. Body: ${stringifyForError(
          data
        )}`
      );
    }

    cachedAccessToken = data.access_token;
    cachedAccessTokenExpiresAt =
      Date.now() + Number(data.expires_in || 1800) * 1000;

    return cachedAccessToken;
  } finally {
    timeout.clear();
  }
}

export async function xeroFetch(
  path: string,
  options: XeroFetchOptions = {},
  attempt = 1
): Promise<any> {
  const accessToken = await getXeroAccessToken();
  const timeout = withTimeout(30_000);

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.headers || {}),
    };

    if (process.env.XERO_TENANT_ID) {
      headers["xero-tenant-id"] = process.env.XERO_TENANT_ID;
    }

    let requestBody: BodyInit | undefined;

    if (options.body !== undefined) {
      if (options.rawBody) {
        requestBody = options.body as BodyInit;
      } else {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
        requestBody = JSON.stringify(options.body);
      }
    }

    const response = await fetch(`https://api.xero.com/api.xro/2.0${path}`, {
      method: options.method || "GET",
      headers,
      body: requestBody,
      cache: "no-store",
      signal: timeout.signal,
    });

    const text = await response.text();
    const data = parseMaybeJson(text, `Xero ${options.method || "GET"} ${path}`);

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

      return xeroFetch(path, options, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(
        `Xero request failed: ${response.status} ${stringifyForError(data)}`
      );
    }

    return data;
  } finally {
    timeout.clear();
  }
}

export async function xeroUploadInvoiceAttachment(
  invoiceId: string,
  fileName: string,
  fileBuffer: Buffer,
  mimeType = "application/pdf"
): Promise<any> {
  if (!invoiceId) {
    throw new Error("Cannot upload Xero attachment because invoiceId is missing.");
  }

  if (!fileName) {
    throw new Error("Cannot upload Xero attachment because fileName is missing.");
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error(
      `Cannot upload Xero attachment "${fileName}" because the file buffer is empty.`
    );
  }

  const accessToken = await getXeroAccessToken();

  const safeFileName = encodeURIComponent(fileName);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": mimeType,
  };

  if (process.env.XERO_TENANT_ID) {
    headers["xero-tenant-id"] = process.env.XERO_TENANT_ID;
  }

  const response = await fetch(
    `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}/Attachments/${safeFileName}?IncludeOnline=false`,
    {
      method: "PUT",
      headers,
      body: new Uint8Array(fileBuffer),
      cache: "no-store",
    }
  );

  const text = await response.text();
  const data = parseMaybeJson(text, "Xero attachment upload response");

  if (!response.ok) {
    throw new Error(
      `Xero attachment upload failed: ${response.status} ${stringifyForError(
        data
      )}`
    );
  }

  return data;
}

export async function fetchXeroOrganisation() {
  return xeroFetch("/Organisation");
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
        Authorization: `Bearer ${await getXeroAccessToken()}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: timeout.signal,
    });

    const text = await response.text();
    const data = parseMaybeJson(text, "Xero Profit and Loss report response");

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Xero Profit and Loss report: ${response.status} ${stringifyForError(
          data
        )}`
      );
    }

    return data;
  } finally {
    timeout.clear();
  }
}
