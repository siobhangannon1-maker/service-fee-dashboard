import "server-only";

export class TrainingGenerationError extends Error {
  constructor(public status: number) {
    super(status === 401 ? "Authentication required." : status === 403 ? "Access denied."
      : status === 400 || status === 422 ? "Letter generation input could not be accepted."
      : "Letter generation is temporarily unavailable. Please try again.");
  }
}

// The target is fixed; neither a payload URL nor forwarded host headers can select it.
export async function generateTrainingLetter(request: Request, payload: Record<string, unknown>): Promise<string> {
  const origin = new URL(request.url).origin;
  const target = new URL("/api/report-writing/generate", origin);
  const headers = new Headers({ "Content-Type": "application/json" });
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  try {
    const response = await fetch(target, { method: "POST", headers, body: JSON.stringify(payload),
      redirect: "error", cache: "no-store" });
    if (!response.ok) throw new TrainingGenerationError([400, 401, 403, 422, 429].includes(response.status) ? response.status : 502);
    const data = await response.json();
    if (!data?.success || typeof data.report !== "string") throw new TrainingGenerationError(502);
    return data.report.trim();
  } catch (error) {
    if (error instanceof TrainingGenerationError) throw error;
    throw new TrainingGenerationError(502);
  }
}

export function trainingGenerationErrorResponse(error: unknown): Response | null {
  return error instanceof TrainingGenerationError
    ? Response.json({ success: false, error: error.message }, { status: error.status }) : null;
}
