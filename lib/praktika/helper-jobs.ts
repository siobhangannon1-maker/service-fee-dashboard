import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type PraktikaHelperJsonRequest = {
  reportDraftId?: string;
  method: "POST";
  path: string;
  contentType?: "json" | "form";
  referer?: string;
  body: Record<string, unknown> | unknown[];
};

export type PraktikaHelperMultipartStorageRequest = {
  reportDraftId?: string;
  method: "POST";
  path: string;
  contentType: "multipart_storage";
  referer?: string;
  body: {
    fields: Record<string, string | number | boolean | null | undefined>;
    file: {
      bucket: string;
      path: string;
      fieldName: string;
      fileName: string;
      contentType?: string;
    };
  };
};

export type PraktikaHelperRequest =
  | PraktikaHelperJsonRequest
  | PraktikaHelperMultipartStorageRequest;

type CreatePraktikaHelperJobInput = {
  appUserId?: string | null;
  jobType: string;
  request: PraktikaHelperRequest;
  priority?: number;
};

export async function createPraktikaHelperJob({
  appUserId,
  jobType,
  request,
  priority = 100,
}: CreatePraktikaHelperJobInput) {
  const { data, error } = await supabaseAdmin
    .from("praktika_helper_jobs")
    .insert({
      app_user_id: appUserId || null,
      job_type: jobType,
      request,
      priority,
      status: "pending",
      available_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Could not create Praktika helper job: ${error?.message || "No job returned."}`,
    );
  }

  return data;
}

export async function waitForPraktikaHelperJob(
  jobId: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { data, error } = await supabaseAdmin
      .from("praktika_helper_jobs")
      .select("*")
      .eq("id", jobId)
      .abortSignal(AbortSignal.timeout(Math.max(1, timeoutMs - (Date.now() - startedAt))))
      .single();

    if (error) {
      throw new Error(`Could not check Praktika helper job: ${error.message}`);
    }

    if (data.status === "completed") {
      return data;
    }

    if (data.status === "failed") {
      throw new Error(data.error_message || "Praktika helper job failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - startedAt)))));
  }

  throw new Error(
    "Praktika helper job did not finish in time. Check the helper result before retrying.",
  );
}
