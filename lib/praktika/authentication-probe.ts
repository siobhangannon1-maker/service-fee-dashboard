import { createHash } from "node:crypto";
import type { BrowserContext } from "playwright";
import { hasFreshPraktikaAuthentication } from "./authentication";
import { PraktikaOwnershipLost, hasLivePraktikaHelper, type HelperHealth } from "./helper-lease";

export const PRAKTIKA_AUTH_PROBE_TIMEOUT_MS = 10_000;
const MAX_PROBE_BYTES = 2 * 1024 * 1024;
const PATH = "/php/json/db_reportingDataWarehouse.php";
export type AuthenticationFailurePhase = "error" | "waiting_for_credentials" | "waiting_for_mfa";
export type RedirectCategory = "login_redirect" | "same_origin_other_redirect" | "external_redirect" | "redirect_destination_unavailable";
type RedirectDiagnostics = { phpTargetFamily?: PhpTargetFamily; phpTargetFingerprint?: string; phpTargetCategory?: PhpTargetCategory; destinationCategory: DestinationCategory; redirect_category: RedirectCategory; same_origin: boolean | null; responseReceived: true; elapsed_ms: number };

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

export type PageCategory = "login" | "mfa" | "scheduler" | "reports" | "patient_directory" | "other_application" | "unknown";
export type DestinationCategory = "location_missing" | "location_malformed" | "location_unsupported_scheme" | "same_origin_root" | "php_endpoint" | "other_same_origin" | "login" | "mfa" | "scheduler" | "reports" | "same_requested_path" | "other_application_path" | "external" | "unknown";

// Diagnostic labels only. No inferred MFA pathname: the helper detects MFA inputs.
export function classifyPraktikaPage(value: string, baseUrl: string): PageCategory {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(baseUrl).origin || !["https:", "http:"].includes(url.protocol)) return "unknown";
    const p = url.pathname;
    if (p === "/v2/login") return "login";
    if (p === "/v2/scheduler") return "scheduler";
    if (p === "/v2/reports" || p.startsWith("/v2/reports/")) return "reports";
    if (p === "/v2/patient-directory" || p.startsWith("/v2/patient-directory/")) return "patient_directory";
    return p === "/v2" || p.startsWith("/v2/") ? "other_application" : "unknown";
  } catch { return "unknown"; }
}
export function classifyPraktikaRedirectDestination(location: string | undefined, expectedUrl: string): DestinationCategory {
  if (!location?.trim()) return "location_missing";
  if (/[\u0000-\u001f\u007f]/.test(location)) return "location_malformed";
  try {
    const expected = new URL(expectedUrl);
    const destination = new URL(location, expected);
    if (!["https:", "http:"].includes(destination.protocol)) return "location_unsupported_scheme";
    if (destination.origin !== expected.origin) return "external";
    if (destination.pathname === expected.pathname) return "same_requested_path";
    if (destination.pathname === "/") return "same_origin_root";
    if (destination.pathname.startsWith("/php/")) return "php_endpoint";
    const category = classifyPraktikaPage(destination.href, expectedUrl);
    if (category === "patient_directory" || category === "other_application") return "other_application_path";
    return category === "unknown" ? "other_same_origin" : category;
  } catch { return "location_malformed"; }
}

const PHP_TARGETS = {
  "/php/json/db_reportingDataWarehouse.php": "reporting_data_warehouse",
  "/php/json/db_gridPatientList.php": "patient_list",
  "/php/json/db_getCustomerReferringParties.php": "referring_parties",
  "/php/forms/db_getFormData.php": "form_get",
  "/php/forms/db_commitFormData.php": "form_commit",
  "/php/forms/db_updateFormData.php": "form_update",
  "/php/onlineBookingV2/db_search.php": "online_booking_search",
  "/php/onlineBookingV2/db_register.php": "online_booking_register",
  "/php/onlineBookingV2/db_getCustomerDetails.php": "online_booking_customer_details",
} as const;
type PhpTargetCategory = typeof PHP_TARGETS[keyof typeof PHP_TARGETS] | "unrecognized_php_target";

// Only labels leave this function. Exact requested-path classification takes precedence.
export function classifyPraktikaPhpTarget(location: string | undefined, expectedUrl: string): PhpTargetCategory | undefined {
  if (classifyPraktikaRedirectDestination(location, expectedUrl) !== "php_endpoint") return undefined;
  const pathname = new URL(location!, expectedUrl).pathname;
  return Object.prototype.hasOwnProperty.call(PHP_TARGETS, pathname)
    ? PHP_TARGETS[pathname as keyof typeof PHP_TARGETS] : "unrecognized_php_target";
}

type PhpTargetFamily = "php_json" | "php_forms" | "php_online_booking" | "php_other";

// Directory labels only, never authentication evidence or a raw path.
export function classifyPraktikaPhpFamily(location: string | undefined, expectedUrl: string): PhpTargetFamily | undefined {
  if (classifyPraktikaPhpTarget(location, expectedUrl) !== "unrecognized_php_target") return undefined;
  const pathname = new URL(location!, expectedUrl).pathname;
  if (pathname.startsWith("/php/json/")) return "php_json";
  if (pathname.startsWith("/php/forms/")) return "php_forms";
  if (pathname.startsWith("/php/onlineBookingV2/")) return "php_online_booking";
  return "php_other";
}

// URL parsing supplies normalization; preserve pathname case and exclude all other URL components.
export function praktikaPhpTargetFingerprint(location: string | undefined, expectedUrl: string): string | undefined {
  if (classifyPraktikaPhpTarget(location, expectedUrl) !== "unrecognized_php_target") return undefined;
  return createHash("sha256").update("praktika-renewal-redirect-path:v1\0")
    .update(new URL(location!, expectedUrl).pathname).digest("hex").slice(0, 16);
}

export function praktikaHelperToken(generation: string): string {
  return createHash("sha256").update("praktika-auth-renewal-generation:v1\0").update(generation).digest("hex").slice(0, 16);
}

export type ProbeResult = { redirectDiagnostics?: RedirectDiagnostics; verified: boolean; phase: AuthenticationFailurePhase; httpStatus: number | null; parsedArray: boolean };
export class PraktikaAuthenticationUnverified extends Error {
  constructor(readonly phase: AuthenticationFailurePhase = "error", readonly transient = false) { super(transient ? "Praktika verification is temporarily unavailable. Retry remains bounded." : "Praktika authentication could not be verified. Reconnect before retrying this job."); }
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
            // Redirects never prove authentication; only the confirmed login path is a challenge.
            let location: string | undefined;
            try { location = response.headers()["location"]; } catch { /* Metadata unavailable. */ }
            const redirect = classifyPraktikaRedirect(location, url);
            return { ...failed, phase: redirect.redirect_category === "login_redirect" ? "waiting_for_credentials" as const : "error" as const, httpStatus: response.status(), redirectDiagnostics: {
              ...redirect, phpTargetFamily: classifyPraktikaPhpFamily(location, url), phpTargetFingerprint: praktikaPhpTargetFingerprint(location, url), phpTargetCategory: classifyPraktikaPhpTarget(location, url), destinationCategory: classifyPraktikaRedirectDestination(location, url), responseReceived: true as const,
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
  helperToken?: string;
  readOwnedSession(): Promise<HelperHealth>;
  currentPageCategory?(): PageCategory;
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
      console.log(renew ? "[Praktika auth] renewal_started" : "[Praktika auth] probe_started", { helperToken: deps.helperToken });
      const result = await deps.probe();
      await assertCurrent();
      if (!result.verified) {
        // Ambiguity never creates or destroys proof, regardless of the initiating
        // caller. Only explicit authentication negatives clear it.
        if (result.phase !== "error") await deps.recordFailure(result.phase);
        if (renew && result.phase === "error" && result.redirectDiagnostics) {
          let currentPageCategory: PageCategory = "unknown";
          try { currentPageCategory = deps.currentPageCategory?.() ?? "unknown"; } catch { /* Diagnostics must not affect verification. */ }
          const age = Date.now() - Date.parse(session.authenticated_at || "");
          console.log("[Praktika auth] renewal_redirect", {
            helperToken: deps.helperToken,
            httpStatus: result.httpStatus,
            destinationCategory: result.redirectDiagnostics.destinationCategory,
            ...(result.redirectDiagnostics.phpTargetCategory ? { phpTargetCategory: result.redirectDiagnostics.phpTargetCategory } : {}),
            ...(result.redirectDiagnostics.destinationCategory === "php_endpoint" && result.redirectDiagnostics.phpTargetCategory === "unrecognized_php_target" && result.redirectDiagnostics.phpTargetFingerprint
              ? { phpTargetFingerprint: result.redirectDiagnostics.phpTargetFingerprint } : {}),
            ...(result.redirectDiagnostics.destinationCategory === "php_endpoint" && result.redirectDiagnostics.phpTargetCategory === "unrecognized_php_target" && result.redirectDiagnostics.phpTargetFamily
              ? { phpTargetFamily: result.redirectDiagnostics.phpTargetFamily } : {}),
            currentPageCategory,
            helperAlive: hasLivePraktikaHelper(session),
            proofStillFresh: hasFreshPraktikaAuthentication(session),
            proofAgeBucket: !Number.isFinite(age) || age < 0 ? "unknown" : age < 60_000 ? "<1m" : age < 180_000 ? "1-3m" : age <= 300_000 ? "3-5m" : ">5m",
          });
        }
        console.log(renew && result.phase === "error" ? "[Praktika auth] renewal_transient_failure" : "[Praktika auth] probe_failed", {
          helperToken: deps.helperToken,
          httpStatus: result.httpStatus, parsedArray: result.parsedArray, phase: result.phase,
          ...(result.redirectDiagnostics ? {
            redirect_category: result.redirectDiagnostics.redirect_category,
            same_origin: result.redirectDiagnostics.same_origin,
            responseReceived: result.redirectDiagnostics.responseReceived,
            elapsed_ms: result.redirectDiagnostics.elapsed_ms,
          } : {}),
        });
        throw new PraktikaAuthenticationUnverified(result.phase, result.phase === "error");
      }
      await deps.recordSuccess();
      await assertCurrent();
      if (!hasFreshPraktikaAuthentication(await deps.readOwnedSession())) throw new PraktikaOwnershipLost();
      console.log(renew ? "[Praktika auth] renewal_succeeded" : "[Praktika auth] probe_succeeded", {
        helperToken: deps.helperToken,
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
  helperToken?: string;
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
        if (!retried) console.log("[Praktika auth] renewal_retry_scheduled", { helperToken: deps.helperToken });
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
