import type { BrowserContext } from "playwright";
import { hasFreshPraktikaAuthentication } from "./authentication";
import { PraktikaOwnershipLost, type HelperHealth } from "./helper-lease";

export const PRAKTIKA_AUTH_PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBE_BYTES = 2 * 1024 * 1024;
const PATH = "/php/json/db_reportingDataWarehouse.php";
export type AuthenticationFailurePhase = "error" | "waiting_for_credentials" | "waiting_for_mfa";
export type RedirectCategory = "login_redirect" | "same_origin_other_redirect" | "external_redirect" | "redirect_destination_unavailable";
type RedirectDiagnostics = { redirect_category: RedirectCategory; same_origin: boolean | null; responseReceived: true; elapsed_ms: number };

// Classify only; never return URL components or change authentication decisions.
export function classifyPraktikaRedirect(location: string | undefined, expectedUrl: string): Pick<RedirectDiagnostics, "redirect_category" | "same_origin"> {
  const unavailable = { redirect_category: "redirect_destination_unavailable" as const, same_origin: null };
  if (!location?.trim() || /[\u0000-\u001f\u007f]/.test(location)) return unavailable;
  try {
    const expected = new URL(expectedUrl);
    const destination = new URL(location, expected);
    if (!["https:", "http:"].includes(destination.protocol)) return unavailable;
    const same_origin = destination.origin === expected.origin;
    // Only the confirmed login path is allowlisted. Query, fragment and userinfo
    // are never used or emitted; arbitrary paths are never emitted either.
    return { same_origin, redirect_category: !same_origin ? "external_redirect"
      : destination.pathname === "/v2/login" ? "login_redirect" : "same_origin_other_redirect" };
  } catch { return unavailable; }
}

export type ProbeResult = { redirectDiagnostics?: RedirectDiagnostics; verified: boolean; phase: AuthenticationFailurePhase; httpStatus: number | null; parsedArray: boolean };
export class PraktikaAuthenticationUnverified extends Error {
  constructor(readonly phase: AuthenticationFailurePhase = "error") { super("Praktika authentication could not be verified. Reconnect before retrying this job."); }
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
  const startedAt = performance.now();
  const failed: ProbeResult = { verified: false, phase: "error", httpStatus: null, parsedArray: false };
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
          if (response.status() >= 300 && response.status() < 400) {
            // Diagnostics must not turn a redirect into success or a challenge.
            let location: string | undefined;
            try { location = response.headers()["location"]; } catch { /* Metadata unavailable. */ }
            return { ...failed, httpStatus: response.status(), redirectDiagnostics: {
              ...classifyPraktikaRedirect(location, url), responseReceived: true as const,
              elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)),
            } };
          }
        }
        const body = await response.body();
        if (body.length > MAX_PROBE_BYTES) return { ...failed, httpStatus: response.status() };
        return validateGstResponse(response.status(), response.url() === url, body.toString("utf8"));
      } finally { await response.dispose().catch(() => {}); }
    })();
    // Keep the gate occupied until Playwright transport/body disposal settles.
    // Its native request timeout bounds the request; never race it with a detached timer.
    return await request;
  } catch { return failed; }

}

export function createPraktikaAuthenticationGate(deps: {
  readOwnedSession(): Promise<HelperHealth>;
  assertOwned(): Promise<void>;
  probe(): Promise<ProbeResult>;
  recordSuccess(): Promise<void>;
  recordFailure(phase: AuthenticationFailurePhase): Promise<void>;
}) {
  // One gate and one transport per owning child generation.
  let inFlight: Promise<void> | undefined;
  let epoch = 0;
  let suspended = false;
  let stopped = false;
  const verify = (renew = false): Promise<void> => {
    if (stopped) return Promise.reject(new PraktikaOwnershipLost());
    if (suspended) return Promise.reject(new PraktikaAuthenticationUnverified());
    if (inFlight) return inFlight;
    const startedEpoch = epoch;
    const assertCurrent = async () => {
      await deps.assertOwned();
      if (stopped) throw new PraktikaOwnershipLost();
      if (epoch !== startedEpoch) throw new PraktikaAuthenticationUnverified();
    };
    inFlight = (async () => {
      await assertCurrent();
      const session = await deps.readOwnedSession();
      await assertCurrent();
      if (!renew && hasFreshPraktikaAuthentication(session)) return;
      console.log(renew ? "[Praktika auth] renewal_started" : "[Praktika auth] probe_started");
      const result = await deps.probe();
      await assertCurrent();
      if (!result.verified) {
        // Background ambiguity never creates or destroys proof. Its original
        // deadline remains authoritative, even if a job joins this request.
        if (!renew || result.phase !== "error") await deps.recordFailure(result.phase);
        console.log(renew && result.phase === "error" ? "[Praktika auth] renewal_transient_failure" : "[Praktika auth] probe_failed", {
          httpStatus: result.httpStatus, parsedArray: result.parsedArray, phase: result.phase,
          ...(result.redirectDiagnostics ? {
            redirect_category: result.redirectDiagnostics.redirect_category,
            same_origin: result.redirectDiagnostics.same_origin,
            responseReceived: result.redirectDiagnostics.responseReceived,
            elapsed_ms: result.redirectDiagnostics.elapsed_ms,
            proof_age_ms: Number.isFinite(Date.parse(session.authenticated_at || ""))
              ? Math.max(0, Date.now() - Date.parse(session.authenticated_at!)) : null,
          } : {}),
        });
        throw new PraktikaAuthenticationUnverified(result.phase);
      }
      await deps.recordSuccess();
      await assertCurrent();
      if (!hasFreshPraktikaAuthentication(await deps.readOwnedSession())) throw new PraktikaOwnershipLost();
      console.log(renew ? "[Praktika auth] renewal_succeeded" : "[Praktika auth] probe_succeeded", {
        httpStatus: result.httpStatus, parsedArray: result.parsedArray,
      });
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return Object.assign(() => verify(), {
    renew: () => verify(true),
    // Call before changing browser login state; drain any old transport before
    // starting a new login/probe, and suppress its late result.
    invalidate: async () => { suspended = true; epoch++; await inFlight?.catch(() => {}); },
    resume: () => { suspended = false; },
    stop: () => { stopped = true; epoch++; },
  });
}

export const PRAKTIKA_AUTH_RENEWAL_MS = 60_000;
export const PRAKTIKA_AUTH_RETRY_MS = 15_000;

export function startPraktikaAuthenticationRenewal(deps: {
  readSession(): Promise<HelperHealth>;
  eligible(): Promise<boolean>;
  renew(): Promise<void>;
  stopGate(): void;
  now?: () => number;
}) {
  let stopped = false;
  let pending = false;
  let nextAttempt = 0;
  let retried = false;
  let lastProof: string | null | undefined;
  const now = deps.now || Date.now;
  const tick = async () => {
    if (stopped || pending) return;
    pending = true;
    try {
      if (!await deps.eligible() || stopped) return;
      const row = await deps.readSession();
      if (row.authenticated_at !== lastProof) {
        lastProof = row.authenticated_at;
        nextAttempt = 0;
        retried = false;
      }
      const proof = Date.parse(row.authenticated_at || "");
      if (stopped || now() < nextAttempt || (Number.isFinite(proof) && now() - proof < PRAKTIKA_AUTH_RENEWAL_MS)) return;
      try {
        await deps.renew();
        retried = false;
        nextAttempt = now() + PRAKTIKA_AUTH_RENEWAL_MS;
      } catch (error) {
        if (error instanceof PraktikaOwnershipLost) { stop(); return; }
        if (error instanceof PraktikaAuthenticationUnverified && error.phase !== "error") {
          nextAttempt = now() + PRAKTIKA_AUTH_RENEWAL_MS;
          retried = false;
          return;
        }
        nextAttempt = now() + (retried ? PRAKTIKA_AUTH_RENEWAL_MS : PRAKTIKA_AUTH_RETRY_MS);
        if (!retried) console.log("[Praktika auth] renewal_retry_scheduled");
        retried = !retried;
      }
    } catch { stop(); }
    finally { pending = false; }
  };
  const timer = setInterval(() => { void tick(); }, 2_000);
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    deps.stopGate();
    console.log("[Praktika auth] renewal_stopped");
  }
  return { stop, tick };
}
