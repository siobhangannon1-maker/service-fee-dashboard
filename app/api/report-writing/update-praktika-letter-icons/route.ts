import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getCurrentUserPraktikaSessionMode,
  type PraktikaSessionMode,
} from "@/lib/praktika/hybrid-session-store";
import { praktikaHelperPost } from "@/lib/praktika/helper-job-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
}: {
  mode: PraktikaSessionMode;
  practiceId: number;
  appointmentId: string;
  iconIds: number[];
}) {
  return await praktikaHelperPost<any>({
    mode,
    jobType: "update_praktika_letter_icons",
    path: "/php/forms/db_commitFormData.php",
    contentType: "json",
    referer: "https://praktika.praktika.net.au/v2/scheduler",
    priority: 80,
    timeoutMs: 15_000,
    body: [
      {
        request_id: buildRequestId(),
        practice_id: practiceId,
        appointment_id: Number(appointmentId),
        appointment_icon1id: iconIds[0],
        appointment_icon2id: iconIds[1],
        appointment_icon3id: iconIds[2],
        appointment_icon4id: iconIds[3],
      },
    ],
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

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json().catch(() => ({}));

    const queueId = clean(body.queueId);
    const draftId = clean(body.draftId);
    const bodyPraktikaPatientId = clean(
      body.praktikaPatientId || body.praktika_patient_id || body.patientId,
    );

    const practiceIdString = process.env.PRAKTIKA_PRACTICE_ID || "1181";
    const practiceId = Number(practiceIdString);

    if (!Number.isFinite(practiceId) || practiceId <= 0) {
      return NextResponse.json({
        success: true,
        iconUpdated: false,
        skipped: true,
        reason: "Invalid PRAKTIKA_PRACTICE_ID.",
      });
    }

    const queueItem = await findQueueItem({ queueId, draftId });

    if (queueItem) {
      const raw = asObject(queueItem.raw_json);
      const appointmentId =
        clean(queueItem.appointment_id) || getAppointmentIdFromRaw(raw);

      if (appointmentId) {
        const currentIconIds = getIconIdsFromRaw(raw);
        const { changed, oldIconIds, updatedIconIds, replacedIconIds } =
          replaceLetterWorkflowIcons(currentIconIds);

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

          return NextResponse.json({
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

        return NextResponse.json({
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

      return NextResponse.json({
        success: true,
        iconUpdated: false,
        skipped: true,
        reason: "No Praktika patient ID available for local icon index lookup.",
      });
    }

    const indexedAppointment = await findIndexedPendingIconAppointment({
      praktikaPatientId,
    });

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

      return NextResponse.json({
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

      return NextResponse.json({
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

    return NextResponse.json({
      success: true,
      iconUpdated: true,
      mode: "local_icon_index",
      appointmentId,
      praktikaPatientId,
      replacedIconIds,
      oldIconIds,
      newIconIds: updatedIconIds,
    });
  } catch (error) {
    console.error("Update Praktika letter icons failed:", error);

    return NextResponse.json({
      success: true,
      iconUpdated: false,
      skipped: true,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update Praktika letter icon.",
      reason:
        "Icon update failed, but the letter workflow should continue. The icon can be retried after the next Praktika queue sync.",
    });
  }
}