import "server-only";

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export type MedirefHelperRequest = {
  action: "send_letter";
  draftId: string;
  patient: {
    firstName: string;
    lastName: string;
    dob: string | null;
  };
  recipient: {
    name: string;
    providerNumber?: string | null;
    email?: string | null;
  };
  cc?: Array<{
    name?: string | null;
    email?: string | null;
    providerNumber?: string | null;
  }>;
  attachments: Array<{
  bucket: string;
  storagePath: string;
  fileName: string;
  contentType: "application/pdf";
}>;
  message?: string | null;
};

export type MedirefHelperJob = {
  id: string;
  app_user_id: string | null;
  job_type: string;
  status: "pending" | "processing" | "completed" | "failed";
  priority: number;
  request: MedirefHelperRequest;
  response: Record<string, unknown> | null;
  error_message: string | null;
  attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  available_at: string;
  completed_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function makeWorkerId() {
  return `mediref-worker-${process.pid}-${Date.now()}`;
}

export async function createMedirefHelperJob({
  jobType,
  request,
  priority = 50,
  availableAt,
}: {
  jobType: string;
  request: MedirefHelperRequest;
  priority?: number;
  availableAt?: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("mediref_helper_jobs")
    .insert({
      app_user_id: null,
      job_type: jobType,
      status: "pending",
      priority,
      request,
      response: null,
      error_message: null,
      attempts: 0,
      locked_at: null,
      locked_by: null,
      available_at: availableAt || nowIso(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Could not create MediRef helper job: ${
        error?.message || "No job returned."
      }`,
    );
  }

  return data as MedirefHelperJob;
}

export async function claimNextPracticeMedirefHelperJob() {
  const workerId = makeWorkerId();

  const { data: candidates, error: selectError } = await supabaseAdmin
    .from("mediref_helper_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", nowIso())
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectError) {
    throw new Error(
      `Could not check pending MediRef helper jobs: ${selectError.message}`,
    );
  }

  const candidate = candidates?.[0] as MedirefHelperJob | undefined;

  if (!candidate) return null;

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("mediref_helper_jobs")
    .update({
      status: "processing",
      attempts: Number(candidate.attempts || 0) + 1,
      locked_at: nowIso(),
      locked_by: workerId,
      updated_at: nowIso(),
    })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("*")
    .single();

  if (claimError || !claimed) {
    return null;
  }

  return claimed as MedirefHelperJob;
}

export async function completeMedirefHelperJob({
  jobId,
  response,
}: {
  jobId: string;
  response: Record<string, unknown>;
}) {
  const { error } = await supabaseAdmin
    .from("mediref_helper_jobs")
    .update({
      status: "completed",
      response,
      error_message: null,
      completed_at: nowIso(),
      locked_at: null,
      locked_by: null,
      updated_at: nowIso(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Could not complete MediRef helper job: ${error.message}`);
  }
}

export async function failMedirefHelperJob({
  jobId,
  errorMessage,
  retry = false,
}: {
  jobId: string;
  errorMessage: string;
  retry?: boolean;
}) {
  const status = retry ? "pending" : "failed";

  const { error } = await supabaseAdmin
    .from("mediref_helper_jobs")
    .update({
      status,
      error_message: errorMessage,
      failed_at: retry ? null : nowIso(),
      locked_at: null,
      locked_by: null,
      available_at: retry
        ? new Date(Date.now() + 30_000).toISOString()
        : nowIso(),
      updated_at: nowIso(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Could not fail MediRef helper job: ${error.message}`);
  }
}