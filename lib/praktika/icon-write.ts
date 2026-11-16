// Appointment icon writes (db_commitFormData.php) for update_praktika_letter_icons jobs.
//
// Since 22 Oct 2026 Praktika answers most icon writes with HTTP 500 unless request_id
// matches what its own scheduler page sends: "<PHPSESSID cookie value>_<counter>".
// The session ID is a login secret, so the request_id is built only in the worker at
// send time and must never be stored in the database or written to logs.

// The page numbers its saves 1, 2, 3... per session; do the same per worker process.
let counterSessionId: string | null = null;
let counter = 0;

export function nextPraktikaRequestId(sessionId: string): string {
  if (sessionId !== counterSessionId) {
    counterSessionId = sessionId;
    counter = 0;
  }
  counter += 1;
  return `${sessionId}_${counter}`;
}

export function praktikaSessionId(cookies: ReadonlyArray<{ name: string; value: string }>): string | null {
  const value = cookies.find((cookie) => cookie.name === "PHPSESSID")?.value?.trim();
  return value || null;
}

// Returns a copy; the stored job request keeps its original placeholder request_id.
export function withPraktikaRequestId(body: unknown, requestId: string): unknown {
  if (!Array.isArray(body)) return body;
  return body.map((row) =>
    row && typeof row === "object" && !Array.isArray(row) ? { ...row, request_id: requestId } : row,
  );
}

// Prevents the session ID reaching praktika_helper_jobs.response if Praktika echoes request_id.
export function redactPraktikaSessionId<T>(value: T, sessionId: string | null): T {
  if (!sessionId || value === undefined) return value;
  const text = JSON.stringify(value);
  if (text === undefined || !text.includes(sessionId)) return value;
  return JSON.parse(text.split(sessionId).join("[redacted]"));
}

export type PraktikaErrorBodySummary = {
  bodyType: "empty" | "html" | "json" | "text";
  errorCategory: "none" | "authentication" | "validation" | "internal_exception" | "other";
  exceptionName?: string;
};

// Only fixed categories and an exception class name leave this function: never the
// body text itself, which can contain the request (session ID) or patient details.
export function summarizePraktikaErrorBody(text: string): PraktikaErrorBodySummary {
  const body = String(text ?? "").trim();
  let bodyType: PraktikaErrorBodySummary["bodyType"] = "text";
  if (!body) bodyType = "empty";
  else if (body.startsWith("<")) bodyType = "html";
  else {
    try {
      JSON.parse(body);
      bodyType = "json";
    } catch {
      bodyType = "text";
    }
  }

  const errorCategory: PraktikaErrorBodySummary["errorCategory"] = !body ? "none"
    : /DBUnauthorised|session (has )?expired|not logged in|unauthori[sz]ed/i.test(body) ? "authentication"
    : /ValidationException|invalid (appointment|practice|icon|request)/i.test(body) ? "validation"
    : /Exception|Fatal error|Stack trace|Internal Server Error/i.test(body) ? "internal_exception"
    : "other";

  const exceptionName = body.match(/\b([A-Z][A-Za-z0-9_]{1,60}(?:Exception|Error))\b/)?.[1];
  return { bodyType, errorCategory, ...(exceptionName ? { exceptionName } : {}) };
}

export type PraktikaIconFailure = {
  failureCategory: "http_error" | "request_timeout" | "transport_failure" | "response_validation_failure" | "unknown_failure";
  httpStatus?: number;
} & Partial<PraktikaErrorBodySummary>;

export function praktikaIconFailure(error: any): PraktikaIconFailure {
  if (typeof error?.praktikaHttpStatus === "number") {
    return { failureCategory: "http_error", httpStatus: error.praktikaHttpStatus, ...(error.praktikaBodySummary || {}) };
  }
  const message = String(error?.message || "");
  if (error?.name === "TimeoutError" || /Timeout \d+ms exceeded|timed out/i.test(message)) return { failureCategory: "request_timeout" };
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN"].includes(error?.code)) {
    return { failureCategory: "transport_failure" };
  }
  if (/logged out|non-JSON|empty response/i.test(message)) return { failureCategory: "response_validation_failure" };
  return { failureCategory: "unknown_failure" };
}

export function praktikaIconFailureMessage(failure: PraktikaIconFailure): string {
  const detail = failure.httpStatus !== undefined
    ? `HTTP ${failure.httpStatus}${failure.errorCategory ? `, ${failure.errorCategory}` : ""}${failure.exceptionName ? ` (${failure.exceptionName})` : ""}`
    : failure.failureCategory;
  return `Praktika icon update failed: ${detail}. Outcome unconfirmed; reconcile before retrying.`;
}
