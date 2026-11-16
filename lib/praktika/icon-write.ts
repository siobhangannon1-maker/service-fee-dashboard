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

// Copies only the diagnostic's fixed categories, status and timing onto the failed job.
// Omits requestInvoked/boundary: workflow evidence treats those keys as execution markers.
export type PraktikaIconFailure = {
  failureCategory: string;
  stage?: string;
  httpStatus?: number;
  responseCategory?: string;
  httpErrorCategory?: string;
  requestDurationMs?: number;
};

export function praktikaIconFailure(diagnostic: Record<string, unknown>): PraktikaIconFailure {
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const failure: PraktikaIconFailure = { failureCategory: text(diagnostic.failureCategory) ?? "unknown" };
  const stage = text(diagnostic.stage), httpStatus = num(diagnostic.httpStatus);
  const responseCategory = text(diagnostic.responseCategory), httpErrorCategory = text(diagnostic.httpErrorCategory);
  const requestDurationMs = num(diagnostic.requestDurationMs);
  if (stage) failure.stage = stage;
  if (httpStatus !== undefined) failure.httpStatus = httpStatus;
  if (responseCategory) failure.responseCategory = responseCategory;
  if (httpErrorCategory) failure.httpErrorCategory = httpErrorCategory;
  if (requestDurationMs !== undefined) failure.requestDurationMs = requestDurationMs;
  return failure;
}

export function praktikaIconFailureMessage(failure: PraktikaIconFailure): string {
  const detail = failure.httpStatus !== undefined
    ? [`HTTP ${failure.httpStatus}`, failure.httpErrorCategory, failure.responseCategory && `${failure.responseCategory} reply`].filter(Boolean).join(", ")
    : failure.failureCategory;
  return `Praktika icon update failed: ${detail}. Outcome unconfirmed; reconcile before retrying.`;
}
