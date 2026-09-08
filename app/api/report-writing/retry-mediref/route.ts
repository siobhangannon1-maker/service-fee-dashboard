import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuditActor } from "@/lib/report-writing/audit";
import { getUserStatus } from "@/lib/getUserStatus";
import { createSendMedirefLetterJob } from "@/lib/mediref/helper-job-client";
import { prepareRetry, queueRetry, RetryError, retryWarning, type RetryStore } from "@/lib/mediref/retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const bucket = process.env.MEDIREF_HELPER_UPLOAD_BUCKET || "report-assets";
const store: RetryStore = {
  async draft(id) {
    const { data, error } = await db.from("report_drafts").select("id,status,deleted_at,updated_at,patient_name,patient_dob,workflow_status,workflow_mediref_status,emailed_to_referrer_at").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async active(id) {
    const { data, error } = await db.from("mediref_helper_jobs").select("id").eq("job_type", "send_mediref_letter").eq("payload->>draftId", id).in("status", ["pending", "processing"]).limit(1);
    if (error) throw error;
    return Boolean(data?.length);
  },
  async latest(id) {
    const { data, error } = await db.from("mediref_helper_jobs").select("status,payload").eq("job_type", "send_mediref_letter").eq("payload->>draftId", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  },
  async attachmentExists(attachment) {
    const { data, error } = await db.storage.from(attachment.bucket).info(attachment.storagePath);
    return !error && Boolean(data);
  },
  async claim(draft, update) {
    const { data, error } = await db.from("report_drafts").update(update)
      .eq("id", draft.id).eq("updated_at", draft.updated_at).eq("status", draft.status)
      .eq("workflow_mediref_status", "failed").is("deleted_at", null)
      // An uncertain Complete Workflow insert must not be retried using an older failed job.
      .or("emailed_to_referrer_resend_id.is.null,emailed_to_referrer_resend_id.not.like.mediref:preparing:%")
      .is("emailed_to_referrer_at", null).select("id");
    if (error) throw error;
    return data?.length === 1;
  },
  enqueue: (request) => createSendMedirefLetterJob({ request, priority: 20 }),
};
async function handle(req: Request, enqueue: boolean) {
  try {
    const actor = await getAuditActor();
    if (!actor.actorUserId) throw new RetryError("Authentication required.", 401);
    if (!await getUserStatus(actor.actorUserId)) throw new RetryError("Account is inactive.", 403);
    if (enqueue && req.headers.get("origin") && req.headers.get("origin") !== new URL(req.url).origin) {
      throw new RetryError("Request origin is not allowed.", 403);
    }
    const body = enqueue ? await req.json().catch(() => ({})) : null;
    const id = enqueue ? body?.draftId : new URL(req.url).searchParams.get("draftId");
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new RetryError("A valid draftId is required.", 400);
    }
    if (enqueue) return NextResponse.json(await queueRetry(store, id, bucket));
    await prepareRetry(store, id, bucket);
    return NextResponse.json({ ok: true, eligible: true, warning: retryWarning });
  } catch (error) {
    return NextResponse.json({ ok: false, eligible: false, error: error instanceof RetryError ? error.message : "Unable to check or queue MediRef retry. No further retry should be attempted until the queue is checked." },
      { status: error instanceof RetryError ? error.status : 500 });
  }
}
export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
