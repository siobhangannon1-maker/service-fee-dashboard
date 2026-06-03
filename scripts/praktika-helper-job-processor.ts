import { type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";

const PRAKTIKA_BASE_URL = "https://praktika.praktika.net.au";
const WORKER_ID = `praktika-helper-${process.pid}`;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

function nowIso() {
  return new Date().toISOString();
}

function looksLoggedOut(text: string) {
  const lower = text.toLowerCase();

  return (
    lower.includes("login failed") ||
    lower.includes("logged-out") ||
    lower.includes("logged out") ||
    lower.includes("not logged in") ||
    lower.includes("dbunauthorisedexception") ||
    lower.includes("hijacked or expired session") ||
    lower.includes("expired session")
  );
}

async function claimNextJob(appUserId?: string | null) {
  let query = supabase
    .from("praktika_helper_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  // Medicolegal safety: a user helper should only process that user's jobs.
  // Practice/null jobs are intentionally not processed by a user-scoped helper.
  if (appUserId) {
    query = query.eq("app_user_id", appUserId);
  } else {
    query = query.is("app_user_id", null);
  }

  const { data: jobs, error } = await query;

  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) return null;

  const job = jobs[0];

  let claimQuery = supabase
    .from("praktika_helper_jobs")
    .update({
      status: "processing",
      locked_at: nowIso(),
      locked_by: WORKER_ID,
      attempts: Number(job.attempts || 0) + 1,
      updated_at: nowIso(),
    })
    .eq("id", job.id)
    .eq("status", "pending");

  if (appUserId) {
    claimQuery = claimQuery.eq("app_user_id", appUserId);
  } else {
    claimQuery = claimQuery.is("app_user_id", null);
  }

  const { data: claimed, error: claimError } = await claimQuery
    .select("*")
    .maybeSingle();

  if (claimError) throw new Error(claimError.message);

  return claimed;
}

async function completeJob(jobId: string, response: unknown) {
  const { error } = await supabase
    .from("praktika_helper_jobs")
    .update({
      status: "completed",
      response,
      completed_at: nowIso(),
      updated_at: nowIso(),
      locked_at: null,
      locked_by: null,
    })
    .eq("id", jobId);

  if (error) throw new Error(error.message);
}

async function failJob(job: any, message: string) {
  const attempts = Number(job.attempts || 0);
  const permanent = attempts >= 3;

  const { error } = await supabase
    .from("praktika_helper_jobs")
    .update({
      status: permanent ? "failed" : "pending",
      error_message: message,
      failed_at: permanent ? nowIso() : null,
      available_at: permanent
        ? nowIso()
        : new Date(Date.now() + 60_000).toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
    })
    .eq("id", job.id);

  if (error) throw new Error(error.message);
}

async function runPraktikaRequest(context: BrowserContext, request: any) {
  const method = request.method || "POST";
  const contentType = request.contentType || "json";
  const referer =
    request.referer || `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`;

  if (method !== "POST") {
    throw new Error(`Unsupported Praktika helper method: ${method}`);
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    Origin: PRAKTIKA_BASE_URL,
    Referer: referer,
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
  };

  let data: any;

  if (contentType === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(request.body || {})) {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          params.append(key, String(item));
        });
      } else if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }

    data = params.toString();
  } else {
    headers["Content-Type"] = "application/json";
    data = request.body;
  }

  const response = await context.request.post(
    `${PRAKTIKA_BASE_URL}${request.path}`,
    {
      headers,
      data,
      timeout: 90_000,
    },
  );

  const text = await response.text();

  if (!response.ok()) {
    throw new Error(`Praktika helper request failed ${response.status()}: ${text}`);
  }

  if (looksLoggedOut(text)) {
    throw new Error(`Praktika helper session is logged out: ${text.slice(0, 500)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Praktika helper returned non-JSON: ${text.slice(0, 500)}`);
  }
}

export async function processOnePraktikaHelperJob(
  context: BrowserContext,
  appUserId?: string | null,
) {
  const job = await claimNextJob(appUserId);

  if (!job) return false;

  console.log(
    `Processing Praktika helper job ${job.id}: ${job.job_type} for app user ${
      job.app_user_id || "practice/null"
    }`,
  );

  try {
    const response = await runPraktikaRequest(context, job.request);
    await completeJob(job.id, response);
    console.log(`Completed Praktika helper job ${job.id}`);
  } catch (error: any) {
    const message = error?.message || "Praktika helper job failed.";
    console.error(`Failed Praktika helper job ${job.id}:`, message);
    await failJob(job, message);
  }

  return true;
}
