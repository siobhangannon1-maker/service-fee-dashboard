import "server-only";

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export type MedirefHelperRequest = {
  action: "send_letter";
  draftId: string;
  patient: { firstName: string; lastName: string; dob: string | null };
  recipient: {
    name: string;
    providerNumber?: string | null;
    email?: string | null;
    practiceName?: string | null;
  };
  cc?: Array<{ name?: string | null; email?: string | null; providerNumber?: string | null }>;
  attachments: Array<{
    bucket: string;
    storagePath: string;
    fileName: string;
    contentType: "application/pdf";
  }>;
  message?: string | null;
  medirefAutoMatchRecipient?: boolean;
};

export async function createMedirefHelperJob({
  sessionId = null,
  jobType,
  request,
  priority = 50,
}: {
  sessionId?: string | null;
  jobType: string;
  request: MedirefHelperRequest;
  priority?: number;
}) {
  const { data, error } = await supabaseAdmin
    .from("mediref_helper_jobs")
    .insert({
      app_user_id: null,
      session_id: sessionId,
      job_type: jobType,
      payload: request,
      result: null,
      error: null,
      status: "pending",
      priority,
      available_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      attempts: 0,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Could not create MediRef helper job: ${error?.message || "No job returned."}`,
    );
  }

  return data;
}