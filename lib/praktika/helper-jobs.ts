import { sameIconHelperTarget } from "./icon-helper-target";
import "server-only";
import { currentWorkflowExecution } from "../report-writing/workflow-execution-context";
import { continuationChildId } from "../report-writing/workflow-continuation-token";

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
  const workflow = currentWorkflowExecution();
  const durableWrite = workflow && ["upload_report_to_praktika", "update_praktika_letter_icons"].includes(jobType);
  const id = durableWrite ? continuationChildId(workflow.intentId, jobType) : undefined;
  const { data, error } = await supabaseAdmin
    .from("praktika_helper_jobs")
    .insert({
      ...(id ? { id } : {}),
      app_user_id: appUserId || null,
      job_type: jobType,
      request: durableWrite ? { ...request, continuationId: workflow.intentId } : request,
      priority,
      status: "pending",
      available_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error?.code === "23505" && id && workflow) {
    const existing = await supabaseAdmin.from("praktika_helper_jobs").select("*").eq("id", id)
      .eq("app_user_id", appUserId).eq("job_type", jobType).eq("request->>continuationId", workflow.intentId).single();
    if (!existing.error && existing.data) {
      if (jobType === "update_praktika_letter_icons" && !sameIconHelperTarget(existing.data.request, request)) {
        throw new Error("Existing icon target could not be reconciled. No new icon action was created.");
      }
      return existing.data;
    }
  }
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
