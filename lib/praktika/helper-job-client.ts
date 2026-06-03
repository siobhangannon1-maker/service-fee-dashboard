import "server-only";

import {
  createPraktikaHelperJob,
  waitForPraktikaHelperJob,
  type PraktikaHelperRequest,
} from "@/lib/praktika/helper-jobs";
import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";

type PraktikaHelperPostOptions = {
  mode: PraktikaSessionMode;
  jobType: string;
  path: string;
  body: Record<string, unknown> | unknown[];
  contentType?: "json" | "form";
  referer?: string;
  priority?: number;
  timeoutMs?: number;
  intervalMs?: number;
};

function appUserIdFromMode(mode: PraktikaSessionMode) {
  return mode.scope === "user" ? mode.appUserId : null;
}

export async function praktikaHelperPost<T>({
  mode,
  jobType,
  path,
  body,
  contentType = "json",
  referer,
  priority = 100,
  timeoutMs = 90_000,
  intervalMs = 2_000,
}: PraktikaHelperPostOptions): Promise<T> {
  const request: PraktikaHelperRequest = {
    method: "POST",
    path,
    contentType,
    referer,
    body,
  };

  const job = await createPraktikaHelperJob({
    appUserId: appUserIdFromMode(mode),
    jobType,
    request,
    priority,
  });

  const completedJob = await waitForPraktikaHelperJob(job.id, {
    timeoutMs,
    intervalMs,
  });

  return completedJob.response as T;
}

export async function praktikaHelperPostForCurrentUser<T>(
  options: Omit<PraktikaHelperPostOptions, "mode">,
): Promise<T> {
  const mode = await getCurrentUserPraktikaSessionMode();
  return await praktikaHelperPost<T>({
    ...options,
    mode,
  });
}
