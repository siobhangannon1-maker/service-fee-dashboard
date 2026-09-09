import type { BrowserContext } from "playwright";
import { hasFreshPraktikaAuthentication } from "./authentication";
import { PraktikaOwnershipLost, type HelperHealth } from "./helper-lease";

export const PRAKTIKA_AUTH_PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBE_BYTES = 2 * 1024 * 1024;
const PATH = "/php/json/db_reportingDataWarehouse.php";
export type AuthenticationFailurePhase = "error" | "waiting_for_credentials" | "waiting_for_mfa";
export type ProbeResult = { verified: boolean; phase: AuthenticationFailurePhase; httpStatus: number | null; parsedArray: boolean };
export class PraktikaAuthenticationUnverified extends Error {
  constructor() { super("Praktika authentication could not be verified. Reconnect before retrying this job."); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateGstResponse(status: number, expectedUrl: boolean, text: string): ProbeResult {
  const failure: ProbeResult = { verified: false, phase: "error", httpStatus: status, parsedArray: false };
  if (!expectedUrl || (status >= 300 && status < 400)) return failure;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    // Fixed structural input markers only. Never return markup or error text.
    if (/<input\b[^>]*(?:autocomplete\s*=\s*["']one-time-code["']|(?:name|id)\s*=\s*["'][^"']*(?:mfa|otp)[^"']*["'])/i.test(text)) failure.phase = "waiting_for_mfa";
    else if (/<input\b[^>]*type\s*=\s*["']password["']/i.test(text)) failure.phase = "waiting_for_credentials";
    return failure;
  }
  let genericError = false;
  let authError = false;
  const inspect = (entry: unknown) => {
    if (typeof entry === "string") {
      authError ||= /logged[- ]out|not logged in|dbunauthorisedexception|expired session|login failed/i.test(entry);
      return;
    }
    if (!object(entry)) return;
    genericError ||= entry.success === false || entry.ok === false ||
      ["error", "exception"].some((key) => entry[key] !== undefined && entry[key] !== null && entry[key] !== false && entry[key] !== "");
    const exception = object(entry.exception) ? entry.exception : {};
    authError ||= [entry.error, entry.message, entry.exception, exception.message, exception.error].some((value) =>
      typeof value === "string" && /logged[- ]out|not logged in|dbunauthorisedexception|hijacked or expired session|expired session|login failed/i.test(value));
  };
  inspect(parsed);
  // Read only error-envelope fields; never inspect financial field values.
  if (Array.isArray(parsed)) parsed.forEach(inspect);
  if (typeof parsed === "string") authError = /logged[- ]out|not logged in|dbunauthorisedexception|expired session|login failed/i.test(parsed);
  failure.parsedArray = Array.isArray(parsed);
  if (authError) return { ...failure, phase: "waiting_for_credentials" };
  return { ...failure, verified: status >= 200 && status < 300 && Array.isArray(parsed) && !genericError };
}

export function praktikaPracticeDate(now = new Date(), timeZone = process.env.PRAKTIKA_PRACTICE_TIMEZONE || "Australia/Brisbane") {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function probePraktikaAuthentication(context: BrowserContext, practiceId: string, baseUrl: string): Promise<ProbeResult> {
  const failed: ProbeResult = { verified: false, phase: "error", httpStatus: null, parsedArray: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!/^\d+$/.test(practiceId)) return failed;
    const origin = new URL(baseUrl).origin;
    const url = `${origin}${PATH}`;
    const date = praktikaPracticeDate();
    const request = (async () => {
      const response = await context.request.post(url, {
        headers: { Accept: "application/json, text/plain, */*", Origin: origin,
          Referer: `${origin}/v2/reports/upcoming-appointments`, "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded" },
        data: new URLSearchParams({ sReportName: "GST", iPracticeId: practiceId, iProviderId: "0", sFromDate: date, sToDate: date }).toString(),
        maxRedirects: 0, timeout: PRAKTIKA_AUTH_PROBE_TIMEOUT_MS,
      });
      try {
        if (response.url() !== url || !response.ok()) {
          if (response.status() >= 300 && response.status() < 400) return { ...failed, httpStatus: response.status() };
        }
        const body = await response.body();
        if (body.length > MAX_PROBE_BYTES) return { ...failed, httpStatus: response.status() };
        return validateGstResponse(response.status(), response.url() === url, body.toString("utf8"));
      } finally { await response.dispose().catch(() => {}); }
    })();
    return await Promise.race([request, new Promise<ProbeResult>((resolve) => {
      timer = setTimeout(() => resolve(failed), PRAKTIKA_AUTH_PROBE_TIMEOUT_MS);
    })]);
  } catch { return failed; }
  finally { if (timer) clearTimeout(timer); }
}

export function createPraktikaAuthenticationGate(deps: {
  readOwnedSession(): Promise<HelperHealth>;
  assertOwned(): Promise<void>;
  probe(): Promise<ProbeResult>;
  recordSuccess(): Promise<void>;
  recordFailure(phase: AuthenticationFailurePhase): Promise<void>;
}) {
  // One gate instance per owning child generation; never shared across owners.
  let inFlight: Promise<void> | undefined;
  return function ensureAuthenticated(): Promise<void> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      await deps.assertOwned();
      if (hasFreshPraktikaAuthentication(await deps.readOwnedSession())) return;
      console.log("[Praktika auth] probe_started");
      const result = await deps.probe();
      await deps.assertOwned();
      console.log(result.verified ? "[Praktika auth] probe_succeeded" : "[Praktika auth] probe_failed", {
        httpStatus: result.httpStatus, parsedArray: result.parsedArray,
      });
      if (!result.verified) {
        await deps.recordFailure(result.phase);
        throw new PraktikaAuthenticationUnverified();
      }
      await deps.recordSuccess();
      if (!hasFreshPraktikaAuthentication(await deps.readOwnedSession())) throw new PraktikaOwnershipLost();
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
