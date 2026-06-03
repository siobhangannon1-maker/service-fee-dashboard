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
    lower.includes("expired session") ||
    lower.includes("/v2/login") ||
    lower.includes('type="password"')
  );
}

function looksLikeHtml(text: string) {
  const lower = text.trim().toLowerCase();
  return lower.startsWith("<!doctype") || lower.startsWith("<html");
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

  if (appUserId) {
    query = query.eq("app_user_id", appUserId);
  } else {
    query = query.is("app_user_id", null);
  }

  const { data: jobs, error } = await query;

  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) return null;

  const job = jobs[0];

  const { data: claimed, error: claimError } = await supabase
    .from("praktika_helper_jobs")
    .update({
      status: "processing",
      locked_at: nowIso(),
      locked_by: WORKER_ID,
      attempts: Number(job.attempts || 0) + 1,
      updated_at: nowIso(),
    })
    .eq("id", job.id)
    .eq("status", "pending")
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

function parsePraktikaResponse(text: string, status: number) {
  if (looksLoggedOut(text) || looksLikeHtml(text)) {
    throw new Error(`Praktika helper session is logged out: ${text.slice(0, 500)}`);
  }

  if (!text.trim()) {
    if (status >= 200 && status < 300) return { ok: true, empty: true };
    throw new Error(`Praktika returned an empty response with status ${status}.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Praktika helper returned non-JSON: ${text.slice(0, 500)}`);
  }
}

async function runJsonOrFormRequest(context: BrowserContext, request: any) {
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
  };

  let data: any;

  if (contentType === "form") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(request.body || {})) {
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, String(item)));
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

  return parsePraktikaResponse(text, response.status());
}

async function runMultipartStorageRequest(context: BrowserContext, request: any) {
  const referer =
    request.referer || `${PRAKTIKA_BASE_URL}/v2/patient-directory/patient-search`;

  const fields = request.body?.fields || {};
  const fileSpec = request.body?.file;

  if (!fileSpec?.bucket || !fileSpec?.path || !fileSpec?.fieldName || !fileSpec?.fileName) {
    throw new Error("Multipart helper job is missing storage file details.");
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(fileSpec.bucket)
    .download(fileSpec.path);

  if (downloadError || !fileData) {
    throw new Error(
      `Could not download helper upload file: ${downloadError?.message || "No file returned."}`,
    );
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const fileBuffer = Buffer.from(arrayBuffer);

  const multipart: Record<string, string | number | boolean | { name: string; mimeType: string; buffer: Buffer }> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      multipart[key] = String(value);
    }
  }

  multipart[fileSpec.fieldName] = {
    name: fileSpec.fileName,
    mimeType: fileSpec.contentType || "application/octet-stream",
    buffer: fileBuffer,
  };

  const response = await context.request.post(
    `${PRAKTIKA_BASE_URL}${request.path}`,
    {
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: PRAKTIKA_BASE_URL,
        Referer: referer,
        "X-Requested-With": "XMLHttpRequest",
      },
      multipart,
      timeout: 120_000,
    },
  );

  const text = await response.text();

  if (!response.ok()) {
    throw new Error(`Praktika helper upload failed ${response.status()}: ${text.slice(0, 1000)}`);
  }

  const parsed = parsePraktikaResponse(text, response.status());

  await supabase.storage.from(fileSpec.bucket).remove([fileSpec.path]).catch(() => null);

  return parsed;
}

async function markSessionConnectedForJob(job: any) {
  if (!job.app_user_id) return;

  await supabase
    .from("praktika_sessions")
    .update({
      status: "connected",
      message: "Praktika helper browser is connected. Helper jobs can run for this user.",
      refreshed_at: nowIso(),
      last_used_at: nowIso(),
      updated_at: nowIso(),
      refresh_requested_at: null,
    })
    .eq("scope", "user")
    .eq("app_user_id", job.app_user_id);
}

async function runPraktikaRequest(context: BrowserContext, request: any) {
  if (request.contentType === "multipart_storage") {
    return await runMultipartStorageRequest(context, request);
  }

  return await runJsonOrFormRequest(context, request);
}

export async function processOnePraktikaHelperJob(
  context: BrowserContext,
  appUserId?: string | null,
) {
  const job = await claimNextJob(appUserId || null);

  if (!job) return false;

  console.log(
    `Processing Praktika helper job ${job.id}: ${job.job_type}${
      job.app_user_id ? ` for app user ${job.app_user_id}` : ""
    }`,
  );

  try {
    const response = await runPraktikaRequest(context, job.request);
    await completeJob(job.id, response);
await markSessionConnectedForJob(job);
console.log(`Completed Praktika helper job ${job.id}`);
  } catch (error: any) {
    const message = error?.message || "Praktika helper job failed.";
    console.error(`Failed Praktika helper job ${job.id}:`, message);
    await failJob(job, message);
  }

  return true;
}
