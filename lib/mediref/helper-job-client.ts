import "server-only";

import {
  createMedirefHelperJob,
  type MedirefHelperRequest,
} from "@/lib/mediref/helper-jobs";

export async function createSendMedirefLetterJob({
  request,
  priority = 20,
}: {
  request: MedirefHelperRequest;
  priority?: number;
}) {
  return await createMedirefHelperJob({
    jobType: "send_mediref_letter",
    request,
    priority,
  });
}