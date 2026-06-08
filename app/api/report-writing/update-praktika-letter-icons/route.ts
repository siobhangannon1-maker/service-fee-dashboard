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
const LETTER_SENT_ICON_ID = 6597;

type PraktikaAppointmentRow = {
  iPatientId?: string | number | null;
  iAppointmentId?: string | number | null;
  dtAppointment?: string | null;
  vchAppDate?: string | null;
  vchAppTime?: string | null;

  iIcon1Id?: string | number | null;
  iIcon2Id?: string | number | null;
  iIcon3Id?: string | number | null;
  iIcon4Id?: string | number | null;

  appointment_icon1id?: string | number | null;
  appointment_icon2id?: string | number | null;
  appointment_icon3id?: string | number | null;
  appointment_icon4id?: string | number | null;

  vchIconLabel1?: string | null;
  vchIconLabel2?: string | null;
  vchIconLabel3?: string | null;
  vchIconLabel4?: string | null;

  [key: string]: unknown;
};

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

function addOrReplaceLetterSentIcon(iconIds: number[]) {
  const padded = [...iconIds];

  while (padded.length < 4) {
    padded.push(0);
  }

  const updated = padded.slice(0, 4).map((id) =>
    id === TYPIST_LETTER_ICON_ID ? LETTER_SENT_ICON_ID : id,
  );

  if (!updated.includes(LETTER_SENT_ICON_ID)) {
    const emptyIndex = updated.findIndex((id) => id === 0);

    if (emptyIndex >= 0) {
      updated[emptyIndex] = LETTER_SENT_ICON_ID;
    } else {
      /*
        Praktika only has four appointment icon slots.
        If all four are occupied and Typist Letter is not present, we leave
        existing icons untouched rather than overwriting unrelated clinical icons.
      */
      return updated;
    }
  }

  return updated.slice(0, 4);
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

function getIconIdsFromAppointment(row: PraktikaAppointmentRow) {
  return [
    numberValue(row.iIcon1Id ?? row.appointment_icon1id),
    numberValue(row.iIcon2Id ?? row.appointment_icon2id),
    numberValue(row.iIcon3Id ?? row.appointment_icon3id),
    numberValue(row.iIcon4Id ?? row.appointment_icon4id),
  ];
}

function getAppointmentTimestamp(row: PraktikaAppointmentRow) {
  const directDate = clean(row.dtAppointment);

  if (directDate) {
    const direct = new Date(directDate).getTime();

    if (Number.isFinite(direct)) {
      return direct;
    }
  }

  const date = clean(row.vchAppDate);
  const time = clean(row.vchAppTime);

  if (date) {
    const combined = new Date(`${date} ${time || "00:00"}`).getTime();

    if (Number.isFinite(combined)) {
      return combined;
    }
  }

  return 0;
}

function getDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
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
    .select("id, praktika_patient_id, patient_name, patient_dob")
    .eq("id", draftId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load report draft: ${error.message}`);
  }

  return data;
}

async function fetchAppointmentRowsFromPraktika({
  mode,
  practiceId,
  fromDate,
  toDate,
}: {
  mode: PraktikaSessionMode;
  practiceId: string;
  fromDate: string;
  toDate: string;
}) {
  const rows = await praktikaHelperPost<PraktikaAppointmentRow[]>({
    mode,
    jobType: "find_recent_appointment_for_letter_icon",
    priority: 20,
    timeoutMs: 120_000,
    path: "/php/json/db_reportingDataWarehouse.php",
    contentType: "form",
    referer:
      "https://praktika.praktika.net.au/v2/reports/upcoming-appointments",
    body: {
      sReportName: "appointments",
      bByCreationTime: "false",
      "iPracticeIds[]": [practiceId],
      sFromDate: fromDate,
      sToDate: toDate,
    },
  });

  if (!Array.isArray(rows)) {
    throw new Error("Praktika did not return a valid appointment array.");
  }

  return rows;
}

async function findMostRecentAppointmentForPatient({
  mode,
  practiceId,
  praktikaPatientId,
  fromDate,
  toDate,
}: {
  mode: PraktikaSessionMode;
  practiceId: string;
  praktikaPatientId: string;
  fromDate?: string;
  toDate?: string;
}) {
  const today = new Date();

  /*
    Default search:
    - Look back 24 months for completed/recent clinical appointments.
    - Include 14 days ahead in case the appointment is just after today's date.
    The caller can override this by passing fromDate/toDate in the request body.
  */
  const finalFromDate = fromDate || getDateOnly(addMonths(today, -24));
  const finalToDate = toDate || getDateOnly(addDays(today, 14));

  const rows = await fetchAppointmentRowsFromPraktika({
    mode,
    practiceId,
    fromDate: finalFromDate,
    toDate: finalToDate,
  });

  const matchingRows = rows.filter(
    (row) => clean(row.iPatientId) === praktikaPatientId,
  );

  if (matchingRows.length === 0) {
    return {
      appointment: null,
      searchedFromDate: finalFromDate,
      searchedToDate: finalToDate,
      totalRowsReturned: rows.length,
      matchingRowsReturned: 0,
    };
  }

  const now = Date.now();
  const rowsWithTime = matchingRows.map((row) => ({
    row,
    timestamp: getAppointmentTimestamp(row),
  }));

  const pastOrNow = rowsWithTime
    .filter((item) => item.timestamp > 0 && item.timestamp <= now)
    .sort((a, b) => b.timestamp - a.timestamp);

  const futureOnly = rowsWithTime
    .filter((item) => item.timestamp > 0 && item.timestamp > now)
    .sort((a, b) => a.timestamp - b.timestamp);

  const unknownDate = rowsWithTime.filter((item) => item.timestamp === 0);

  const chosen =
    pastOrNow[0]?.row || futureOnly[0]?.row || unknownDate[0]?.row || null;

  return {
    appointment: chosen,
    searchedFromDate: finalFromDate,
    searchedToDate: finalToDate,
    totalRowsReturned: rows.length,
    matchingRowsReturned: matchingRows.length,
  };
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
    priority: 20,
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

export async function POST(req: Request) {
  try {
    const mode = await getCurrentUserPraktikaSessionMode();
    const body = await req.json().catch(() => ({}));

    const queueId = clean(body.queueId);
    const draftId = clean(body.draftId);
    const bodyPraktikaPatientId = clean(
      body.praktikaPatientId || body.praktika_patient_id || body.patientId,
    );

    const fromDate = clean(body.fromDate);
    const toDate = clean(body.toDate);

    if (!queueId && !draftId && !bodyPraktikaPatientId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing queueId, draftId, or praktikaPatientId. A patient is required to update the most recent appointment.",
        },
        { status: 400 },
      );
    }

    const practiceIdString = process.env.PRAKTIKA_PRACTICE_ID || "1181";
    const practiceId = Number(practiceIdString);

    const queueItem = await findQueueItem({ queueId, draftId });

    /*
      Primary path: original behaviour.
      If a queue item exists, update the appointment linked to that queue item.
    */
    if (queueItem) {
      const raw = queueItem.raw_json || {};
      const appointmentId =
        clean(queueItem.appointment_id) || clean(raw.iAppointmentId);

      if (!appointmentId) {
        return NextResponse.json(
          { success: false, error: "Missing appointment ID." },
          { status: 400 },
        );
      }

      const currentIconIds = getIconIdsFromRaw(raw);
      const updatedIconIds = addOrReplaceLetterSentIcon(currentIconIds);

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

      const { error: updateError } = await supabase
        .from("report_letter_queue")
        .update({
          status: "completed",
          report_draft_id: draftId || queueItem.report_draft_id || null,
          updated_at: now,
          raw_json: {
            ...raw,
            iIcon1Id: String(updatedIconIds[0]),
            iIcon2Id: String(updatedIconIds[1]),
            iIcon3Id: String(updatedIconIds[2]),
            iIcon4Id: String(updatedIconIds[3]),
            letterIconUpdatedAt: now,
            letterIconUpdateMode: "linked_queue_appointment",
            letterIconUpdateResponsePreview: responsePreview,
          },
        })
        .eq("id", queueItem.id);

      if (updateError) {
        return NextResponse.json(
          {
            success: false,
            error: `Praktika icons updated, but queue status failed: ${updateError.message}`,
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        mode: "linked_queue_appointment",
        queueId: queueItem.id,
        appointmentId,
        oldIconIds: currentIconIds,
        newIconIds: updatedIconIds,
      });
    }

    /*
      Fallback path: no queue item exists.
      Use the draft-linked Praktika patient, find the patient's most recent
      appointment in Praktika, and set the Letter Sent icon there.
    */
    const draft = draftId ? await findDraft(draftId) : null;
    const praktikaPatientId =
      bodyPraktikaPatientId || clean(draft?.praktika_patient_id);

    if (!praktikaPatientId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No linked queue item was found and no Praktika patient ID is linked to this draft.",
        },
        { status: 404 },
      );
    }

    const recentAppointmentResult = await findMostRecentAppointmentForPatient({
      mode,
      practiceId: practiceIdString,
      praktikaPatientId,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    });

    const recentAppointment = recentAppointmentResult.appointment;

    if (!recentAppointment) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No linked queue item was found, and no recent Praktika appointment was found for this patient.",
          debug: {
            praktikaPatientId,
            searchedFromDate: recentAppointmentResult.searchedFromDate,
            searchedToDate: recentAppointmentResult.searchedToDate,
            totalRowsReturned: recentAppointmentResult.totalRowsReturned,
            matchingRowsReturned: recentAppointmentResult.matchingRowsReturned,
          },
        },
        { status: 404 },
      );
    }

    const appointmentId = clean(recentAppointment.iAppointmentId);

    if (!appointmentId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A recent appointment was found, but it did not include an appointment ID.",
          debug: {
            praktikaPatientId,
            recentAppointment,
          },
        },
        { status: 500 },
      );
    }

    const currentIconIds = getIconIdsFromAppointment(recentAppointment);
    const updatedIconIds = addOrReplaceLetterSentIcon(currentIconIds);

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

    if (draftId) {
      /*
        Keep an audit trail on the draft without requiring a queue row.
        These fields may not exist in older schemas, so failures are logged but
        do not block the successful Praktika icon update.
      */
      const { error: draftUpdateError } = await supabase
        .from("report_drafts")
        .update({
          updated_at: now,
          praktika_letter_icon_updated_at: now,
          praktika_letter_icon_appointment_id: appointmentId,
          praktika_letter_icon_update_mode: "most_recent_patient_appointment",
          praktika_letter_icon_update_response_preview: responsePreview,
        })
        .eq("id", draftId);

      if (draftUpdateError) {
        console.warn(
          "Praktika letter icon was updated, but draft audit fields were not saved:",
          draftUpdateError.message,
        );
      }
    }

    return NextResponse.json({
      success: true,
      mode: "most_recent_patient_appointment",
      queueId: null,
      draftId: draftId || null,
      praktikaPatientId,
      appointmentId,
      oldIconIds: currentIconIds,
      newIconIds: updatedIconIds,
      debug: {
        searchedFromDate: recentAppointmentResult.searchedFromDate,
        searchedToDate: recentAppointmentResult.searchedToDate,
        totalRowsReturned: recentAppointmentResult.totalRowsReturned,
        matchingRowsReturned: recentAppointmentResult.matchingRowsReturned,
      },
    });
  } catch (error) {
    console.error("Update Praktika letter icons failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update Praktika letter icons.",
      },
      { status: 500 },
    );
  }
}
