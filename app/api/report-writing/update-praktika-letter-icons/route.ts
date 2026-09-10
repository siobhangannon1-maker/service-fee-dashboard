import { isUserPraktikaReady, praktikaConnectionRequired } from "@/lib/report-writing/praktika-readiness";
import { isConfirmedPraktikaUpload } from "@/lib/report-writing/praktika-upload-result";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { createPraktikaHelperJob, waitForPraktikaHelperJob } from "@/lib/praktika/helper-jobs";
import { performQueuedIconAction } from "@/lib/report-writing/complete-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TYPIST_LETTER_ICON_ID = 7360;
const CLINICIAN_LETTER_ICON_ID = 7341;
const LETTER_SENT_ICON_ID = 6597;

const PENDING_LETTER_ICON_IDS = [
  TYPIST_LETTER_ICON_ID,
  CLINICIAN_LETTER_ICON_ID,
];

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildRequestId() {
  return `letter_icon_${Date.now()}_${crypto.randomUUID()}`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getAppointmentIdFromRaw(raw: Record<string, unknown> | null | undefined) {
  const safeRaw = raw || {};

  return (
    clean(safeRaw.iAppointmentId) ||
    clean(safeRaw.iAppointmentID) ||
    clean(safeRaw.appointment_id) ||
    clean(safeRaw.appointmentId) ||
    clean(safeRaw.id)
  );
}

function getIconIdsFromRaw(raw: Record<string, unknown> | null | undefined) {
  const safeRaw = raw || {};

  return [
    numberValue(safeRaw.iIcon1Id ?? safeRaw.appointment_icon1id),
    numberValue(safeRaw.iIcon2Id ?? safeRaw.appointment_icon2id),
    numberValue(safeRaw.iIcon3Id ?? safeRaw.appointment_icon3id),
    numberValue(safeRaw.iIcon4Id ?? safeRaw.appointment_icon4id),
  ];
}

function replaceLetterWorkflowIcons(iconIds: number[]) {
  const updated = [...iconIds];

  while (updated.length < 4) updated.push(0);

  const oldIconIds = updated.slice(0, 4);
  const updatedIconIds = updated.slice(0, 4);

  const replacedIconIds: number[] = [];

  for (let index = 0; index < updatedIconIds.length; index += 1) {
    const iconId = updatedIconIds[index];

    if (PENDING_LETTER_ICON_IDS.includes(iconId)) {
      updatedIconIds[index] = LETTER_SENT_ICON_ID;
      replacedIconIds.push(iconId);
    }
  }

  return {
    changed: replacedIconIds.length > 0,
    oldIconIds,
    updatedIconIds,
    replacedIconIds,
  };
}

async function findQueueItem(params: { queueId?: string; draftId?: string }) {
  if (params.queueId) {
    const { data, error } = await supabase
      .from("report_letter_queue")
      .select("*")
      .eq("id", params.queueId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) return data;
  }

  if (params.draftId) {
    const { data, error } = await supabase
      .from("report_letter_queue")
      .select("*")
      .eq("report_draft_id", params.draftId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (data) return data;
  }

  return null;
}

async function findDraft(draftId: string) {
  if (!draftId) return null;

  const { data, error } = await supabase
    .from("report_drafts")
    .select("id, praktika_patient_id")
    .eq("id", draftId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load report draft: ${error.message}`);
  }

  return data;
}

async function findIndexedPendingIconAppointment(params: {
  praktikaPatientId: string;
}) {
  const { data, error } = await supabase
    .from("praktika_letter_icon_index")
    .select("*")
    .eq("praktika_patient_id", params.praktikaPatientId)
    .in("pending_icon_id", PENDING_LETTER_ICON_IDS)
    .order("appointment_time", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not search local letter icon index: ${error.message}`);
  }

  return data;
}

async function updatePraktikaAppointmentIcons({
  mode,
  practiceId,
  appointmentId,
  iconIds,
  draftId,
}: {
  draftId: string;
  mode: PraktikaSessionMode;
  practiceId: number;
  appointmentId: string;
  iconIds: number[];
}) {
  return await performQueuedIconAction({
    deadlineMs: 105000,
    enqueue: async () => {
      console.log("[Praktika icon] helper_enqueue_started", { draftId, appointmentPresent: Boolean(appointmentId), letterSentConfigured: LETTER_SENT_ICON_ID === 6597 });
      const job = await createPraktikaHelperJob({
      appUserId: mode.scope === "user" ? mode.appUserId : null,
      jobType: "update_praktika_letter_icons",
      priority: 80,
      request: {
        reportDraftId: draftId,
        method: "POST",
        path: "/php/forms/db_commitFormData.php",
        contentType: "json",
        referer: "https://praktika.praktika.net.au/v2/scheduler",
        body: [{
          request_id: buildRequestId(), practice_id: practiceId, appointment_id: Number(appointmentId),
          appointment_icon1id: iconIds[0], appointment_icon2id: iconIds[1],
          appointment_icon3id: iconIds[2], appointment_icon4id: iconIds[3],
        }],
      },
      });
      console.log("[Praktika icon] helper_job_created", { draftId, helperJobCreated: true });
      return job;
    },
    markRunning: () => saveIconStatus(draftId, "running"),
    wait: async (jobId) => {
      try {
        const job = await waitForPraktikaHelperJob(jobId, { timeoutMs: 90000, intervalMs: 2000 });
        if (job.status !== "completed" || !job.response || typeof job.response !== "object" ||
            job.response.error || job.response.success === false || job.response.empty === true) {
          throw new Error("Appointment icon helper result could not be confirmed.");
        }
        console.log("[Praktika icon] helper_completed", { draftId, helperJobStatus: "completed" });
        return job.response;
      } catch (error) {
        console.log("[Praktika icon] helper_wait_failed", { draftId,
          timeout: error instanceof Error && /did not finish in time/.test(error.message) });
        throw error;
      }
    },
  });
}

async function markDraftIconUpdated(params: {
  draftId?: string;
  appointmentId: string;
  responsePreview: string;
  mode: string;
  oldIconIds: number[];
  newIconIds: number[];
  replacedIconIds: number[];
}) {
  if (!params.draftId) return;

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("report_drafts")
    .update({
      updated_at: now,
      praktika_letter_icon_updated_at: now,
      praktika_letter_icon_appointment_id: params.appointmentId,
      praktika_letter_icon_update_mode: params.mode,
      praktika_letter_icon_update_response_preview: params.responsePreview,
    })
    .eq("id", params.draftId);

  if (error) {
    console.warn(
      "Praktika letter icon was updated, but draft audit fields were not saved:",
      error.message,
    );
  }
}

async function deleteIndexedAppointment(appointmentId: string) {
  const { error } = await supabase
    .from("praktika_letter_icon_index")
    .delete()
    .eq("appointment_id", appointmentId);

  if (error) {
    console.warn(
      "Could not delete appointment from praktika_letter_icon_index:",
      error.message,
    );
  }
}

async function logIconAttempt(params: {
  draftId?: string;
  queueId?: string;
  appointmentId?: string;
  praktikaPatientId?: string;
  mode: string;
  success: boolean;
  skipped?: boolean;
  reason?: string;
  oldIconIds?: number[];
  newIconIds?: number[];
  replacedIconIds?: number[];
  responsePreview?: string;
  error?: string;
}) {
  await supabase.from("audit_log").insert({
    action: "praktika_letter_icon_update_attempt",
    entityType: "report_draft",
    entityId: params.draftId || null,
    metadata: {
      queueId: params.queueId || null,
      appointmentId: params.appointmentId || null,
      praktikaPatientId: params.praktikaPatientId || null,
      mode: params.mode,
      success: params.success,
      skipped: Boolean(params.skipped),
      reason: params.reason || null,
      oldIconIds: params.oldIconIds || null,
      newIconIds: params.newIconIds || null,
      replacedIconIds: params.replacedIconIds || null,
      typistLetterIconId: TYPIST_LETTER_ICON_ID,
      clinicianLetterIconId: CLINICIAN_LETTER_ICON_ID,
      letterSentIconId: LETTER_SENT_ICON_ID,
      responsePreview: params.responsePreview || null,
      error: params.error || null,
    },
  });
}

async function saveIconStatus(draftId: string, status: "running" | "completed" | "skipped" | "failed") {
  if (!draftId) return;
  const values: Record<string, unknown> = {
    workflow_icon_update_status: status, updated_at: new Date().toISOString(),
    workflow_last_message: status === "running" ? "Appointment icon job queued. Waiting for the helper." :
      status === "skipped" ? "No eligible appointment icon found. Continuing workflow." :
      status === "completed" ? "Praktika icon updated. Continuing workflow." : "Appointment icon step failed.",
  };
  if (status === "failed") {
    values.workflow_status = "failed";
    values.workflow_error = "Appointment icon update could not be completed. Check the helper queue before retrying.";
  }
  let query = supabase.from("report_drafts").update(values).eq("id", draftId).eq("workflow_status", "running");
  // A late icon request must not overwrite a timeout/failure recorded by the client.
  if (status !== "failed") query = query.in("workflow_icon_update_status", ["pending", "running"]);
  const { error } = await query;
  if (error) throw new Error("Could not save appointment icon status.");
}

export async function POST(req: Request) {
  let draftId = "";
  async function respond(payload: { success: boolean; iconUpdated: boolean; skipped?: boolean; [key: string]: unknown }) {
    await saveIconStatus(draftId, !payload.success ? "failed" : payload.skipped || !payload.iconUpdated ? "skipped" : "completed");
    return NextResponse.json(payload, { status: payload.success ? 200 : 502 });
  }
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json().catch(() => ({}));
    const queueId = clean(body.queueId);
    draftId = clean(body.draftId);
    const bodyPraktikaPatientId = clean(
      body.praktikaPatientId || body.praktika_patient_id || body.patientId,
    );

    if (!draftId || mode.scope !== "user" || !await isUserPraktikaReady(supabase, mode.appUserId)) {
      return NextResponse.json({ success: false, error: praktikaConnectionRequired }, { status: 409 });
    }
    const { data: uploads, error: uploadError } = await supabase.from("praktika_helper_jobs")
      .select("response").eq("job_type", "upload_report_to_praktika")
      .eq("app_user_id", mode.appUserId).eq("request->>reportDraftId", draftId).eq("status", "completed").limit(1);
    if (uploadError || !uploads?.length || !isConfirmedPraktikaUpload(uploads[0].response)) {
      return NextResponse.json({ success: false, error: "A confirmed report upload is required before updating the appointment icon." }, { status: 409 });
    }
    const { data: claimed, error: claimError } = await supabase.from("report_drafts")
      .update({ workflow_icon_update_status: "running", updated_at: new Date().toISOString() })
      .eq("id", draftId).eq("uploaded_to_praktika", true).eq("workflow_praktika_upload_status", "completed")
      .is("deleted_at", null)
      .or("workflow_icon_update_status.is.null,workflow_icon_update_status.in.(pending,not_requested)")
      .select("id").maybeSingle();
    if (claimError || !claimed) return NextResponse.json({ success: false,
      error: "The icon step is already running or needs reconciliation." }, { status: 409 });

    const practiceIdString = process.env.PRAKTIKA_PRACTICE_ID || "1181";
    const practiceId = Number(practiceIdString);

    if (!Number.isFinite(practiceId) || practiceId <= 0) {
      return await respond({
        success: true,
        iconUpdated: false,
        skipped: true,
        reason: "Invalid PRAKTIKA_PRACTICE_ID.",
      });
    }

    const queueItem = await findQueueItem({ queueId, draftId });
    console.log("[Praktika icon] queue_lookup_completed", { draftId, queueItemFound: Boolean(queueItem) });

    if (queueItem) {
      const raw = asObject(queueItem.raw_json);
      const appointmentId =
        clean(queueItem.appointment_id) || getAppointmentIdFromRaw(raw);

      if (appointmentId) {
        const currentIconIds = getIconIdsFromRaw(raw);
        const { changed, oldIconIds, updatedIconIds, replacedIconIds } =
          replaceLetterWorkflowIcons(currentIconIds);

        console.log("[Praktika icon] target_resolved", { draftId, appointmentSource: "queue", appointmentPresent: true, typistLetterIconFound: currentIconIds.includes(TYPIST_LETTER_ICON_ID), pendingLetterIconFound: changed });
        if (!changed) {
          await logIconAttempt({
            draftId,
            queueId: clean(queueItem.id),
            appointmentId,
            mode: "linked_queue_appointment",
            success: false,
            skipped: true,
            reason: `Linked queue appointment did not contain icon ${PENDING_LETTER_ICON_IDS.join(
              " or ",
            )}.`,
            oldIconIds,
            newIconIds: oldIconIds,
          });

          return await respond({
            success: true,
            iconUpdated: false,
            skipped: true,
            mode: "linked_queue_appointment",
            appointmentId,
            reason: `Linked queue appointment did not contain icon ${PENDING_LETTER_ICON_IDS.join(
              " or ",
            )}.`,
            oldIconIds,
            newIconIds: oldIconIds,
          });
        }

        const response = await updatePraktikaAppointmentIcons({
          draftId,
          mode,
          practiceId,
          appointmentId,
          iconIds: updatedIconIds,
        });

        const responsePreview =
          typeof response === "string"
            ? response.slice(0, 500)
            : JSON.stringify(response).slice(0, 500);

        const now = new Date().toISOString();

        await supabase
          .from("report_letter_queue")
          .update({
            status: "completed",
            updated_at: now,
            raw_json: {
              ...raw,
              iIcon1Id: String(updatedIconIds[0]),
              iIcon2Id: String(updatedIconIds[1]),
              iIcon3Id: String(updatedIconIds[2]),
              iIcon4Id: String(updatedIconIds[3]),
              letterIconUpdatedAt: now,
              letterIconUpdateMode: "linked_queue_appointment",
              letterIconReplacedIconIds: replacedIconIds,
              letterIconPendingIconIds: PENDING_LETTER_ICON_IDS,
              letterIconSentIconId: LETTER_SENT_ICON_ID,
              letterIconUpdateResponsePreview: responsePreview,
            },
          })
          .eq("id", queueItem.id);

        await deleteIndexedAppointment(appointmentId);

        await markDraftIconUpdated({
          draftId,
          appointmentId,
          responsePreview,
          mode: "linked_queue_appointment",
          oldIconIds,
          newIconIds: updatedIconIds,
          replacedIconIds,
        });

        await logIconAttempt({
          draftId,
          queueId: clean(queueItem.id),
          appointmentId,
          mode: "linked_queue_appointment",
          success: true,
          oldIconIds,
          newIconIds: updatedIconIds,
          replacedIconIds,
          responsePreview,
        });

        return await respond({
          success: true,
          iconUpdated: true,
          mode: "linked_queue_appointment",
          appointmentId,
          replacedIconIds,
          oldIconIds,
          newIconIds: updatedIconIds,
        });
      }
    }

    const draft = draftId ? await findDraft(draftId) : null;

    const praktikaPatientId =
      bodyPraktikaPatientId ||
      clean(queueItem?.praktika_patient_id) ||
      clean(draft?.praktika_patient_id);

    if (!praktikaPatientId) {
      await logIconAttempt({
        draftId,
        queueId,
        mode: "no_patient_id",
        success: false,
        skipped: true,
        reason: "No Praktika patient ID available for local icon index lookup.",
      });

      return await respond({
        success: true,
        iconUpdated: false,
        skipped: true,
        reason: "No Praktika patient ID available for local icon index lookup.",
      });
    }

    const indexedAppointment = await findIndexedPendingIconAppointment({
      praktikaPatientId,
    });

    console.log("[Praktika icon] fallback_lookup_completed", { draftId, patientIdPresent: Boolean(praktikaPatientId), appointmentSource: indexedAppointment ? "fallback" : "none", appointmentPresent: Boolean(indexedAppointment?.appointment_id) });
    if (!indexedAppointment) {
      await logIconAttempt({
        draftId,
        queueId,
        praktikaPatientId,
        mode: "local_icon_index",
        success: false,
        skipped: true,
        reason:
          "No typist or clinician letter icon found for this patient. Nothing needed to be updated.",
      });

      return await respond({
        success: true,
        iconUpdated: false,
        skipped: true,
        mode: "local_icon_index",
        praktikaPatientId,
        reason:
          "No typist or clinician letter icon found for this patient. Nothing needed to be updated.",
      });
    }

    const appointmentId = clean(indexedAppointment.appointment_id);
    const raw = asObject(indexedAppointment.raw_json);
    const currentIconIds = getIconIdsFromRaw(raw);
    const { changed, oldIconIds, updatedIconIds, replacedIconIds } =
      replaceLetterWorkflowIcons(currentIconIds);

    if (!appointmentId || !changed) {
      await logIconAttempt({
        draftId,
        queueId,
        appointmentId,
        praktikaPatientId,
        mode: "local_icon_index",
        success: false,
        skipped: true,
        reason: `Indexed appointment did not contain icon ${PENDING_LETTER_ICON_IDS.join(
          " or ",
        )} in raw_json.`,
        oldIconIds,
        newIconIds: oldIconIds,
      });

      return await respond({
        success: true,
        iconUpdated: false,
        skipped: true,
        mode: "local_icon_index",
        appointmentId,
        praktikaPatientId,
        reason: `Indexed appointment did not contain icon ${PENDING_LETTER_ICON_IDS.join(
          " or ",
        )} in raw_json.`,
        oldIconIds,
        newIconIds: oldIconIds,
      });
    }

    const response = await updatePraktikaAppointmentIcons({
      draftId,
      mode,
      practiceId,
      appointmentId,
      iconIds: updatedIconIds,
    });

    const responsePreview =
      typeof response === "string"
        ? response.slice(0, 500)
        : JSON.stringify(response).slice(0, 500);

    await deleteIndexedAppointment(appointmentId);

    await markDraftIconUpdated({
      draftId,
      appointmentId,
      responsePreview,
      mode: "local_icon_index",
      oldIconIds,
      newIconIds: updatedIconIds,
      replacedIconIds,
    });

    await logIconAttempt({
      draftId,
      queueId,
      appointmentId,
      praktikaPatientId,
      mode: "local_icon_index",
      success: true,
      oldIconIds,
      newIconIds: updatedIconIds,
      replacedIconIds,
      responsePreview,
    });

    return await respond({
      success: true,
      iconUpdated: true,
      mode: "local_icon_index",
      appointmentId,
      praktikaPatientId,
      replacedIconIds,
      oldIconIds,
      newIconIds: updatedIconIds,
    });
  } catch {
    return await respond({
      success: false,
      iconUpdated: false,
      error: "Appointment icon update failed. Check the helper queue before retrying.",
    }).catch(() => NextResponse.json({ success: false, iconUpdated: false,
      error: "Appointment icon update failed and workflow status could not be saved." }, { status: 500 }));
  }
}
