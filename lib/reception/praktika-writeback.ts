import { praktikaPost } from "@/lib/praktika/praktika-client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const PRAKTIKA_PRACTICE_ID = Number(process.env.PRAKTIKA_PRACTICE_ID || 1181);

function makeRequestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function getServerPraktikaCookie() {
  const phpsessid = process.env.PRAKTIKA_SERVER_PHPSESSID;
  const uat = process.env.PRAKTIKA_SERVER_UAT;

  if (!phpsessid || !uat) return null;

  return `PHPSESSID=${phpsessid}; UAT=${uat}`;
}

async function praktikaPostWithServerSession<T>({
  path,
  referer,
  body,
}: {
  path: string;
  referer: string;
  body: any;
}) {
  const cookie = getServerPraktikaCookie();

  if (!cookie) {
    throw new Error(
      "No server Praktika session configured. Add PRAKTIKA_SERVER_PHPSESSID and PRAKTIKA_SERVER_UAT to Vercel."
    );
  }

  const response = await fetch(`https://praktika.praktika.net.au${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://praktika.praktika.net.au",
      Referer: referer,
      Cookie: cookie,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Praktika server session response was not JSON. Status ${response.status}. ${text.slice(
        0,
        300
      )}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Praktika server session request failed with status ${response.status}`
    );
  }

  return data as T;
}

async function praktikaPostUserThenServer<T>({
  path,
  referer,
  body,
}: {
  path: string;
  referer: string;
  body: any;
}) {
  try {
    return await praktikaPost<T>({
      path,
      contentType: "json",
      referer,
      body,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Praktika user session failed.";

    const shouldTryServerSession =
      message.includes("logged in") ||
      message.includes("session") ||
      message.includes("username/password") ||
      message.includes("individual Praktika session");

    if (!shouldTryServerSession) {
      throw error;
    }

    return await praktikaPostWithServerSession<T>({
      path,
      referer,
      body,
    });
  }
}

export async function markPraktikaAppointmentConfirmed({
  appointmentId,
  appointmentDate,
}: {
  appointmentId: string;
  appointmentDate?: string | null;
}) {
  if (!appointmentId) throw new Error("Praktika appointment ID is required.");

  const refererDate = appointmentDate || new Date().toISOString().slice(0, 10);

  return await praktikaPostUserThenServer<any>({
    path: "/php/forms/db_commitFormData.php",
    referer: `https://praktika.praktika.net.au/v2/scheduler/${refererDate}`,
    body: [
      {
        request_id: makeRequestId("sms_confirm"),
        practice_id: PRAKTIKA_PRACTICE_ID,
        appointment_id: Number(appointmentId),
        appointment_arrivalstatusid: 0,
        appointment_responseid: 1,
      },
    ],
  });
}

export async function createPraktikaAppointmentNote({
  appointmentId,
  appointmentDate,
  note,
}: {
  appointmentId: string;
  appointmentDate?: string | null;
  note: string;
}) {
  if (!appointmentId) throw new Error("Praktika appointment ID is required.");

  const refererDate = appointmentDate || new Date().toISOString().slice(0, 10);

  return await praktikaPostUserThenServer<any>({
    path: "/php/forms/db_commitFormData.php",
    referer: `https://praktika.praktika.net.au/v2/scheduler/${refererDate}`,
    body: [
      {
        request_id: makeRequestId("appt_note"),
        practice_id: PRAKTIKA_PRACTICE_ID,
        appointment_id: Number(appointmentId),
        appointment_notes: [
          {
            id: -2,
            typeId: 4,
            statusId: 0,
            date: null,
            author: "",
            note,
            editable: true,
          },
        ],
      },
    ],
  });
}

export async function fetchPraktikaClinicalNotes({
  patientId,
}: {
  patientId: string;
}) {
  if (!patientId) throw new Error("Praktika patient ID is required.");

  return await praktikaPostUserThenServer<any>({
    path: "/php/forms/db_getFormData.php",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    body: [
      {
        parameters: [
          {
            practice_id: PRAKTIKA_PRACTICE_ID,
            patient_id: Number(patientId),
          },
        ],
        fields: ["patient_clinicalnotes"],
      },
    ],
  });
}

export async function createPraktikaGeneralClinicalNote({
  patientId,
  noteText,
}: {
  patientId: string;
  noteText: string;
}) {
  if (!patientId) throw new Error("Praktika patient ID is required.");

  await fetchPraktikaClinicalNotes({ patientId });

  return await praktikaPostUserThenServer<any>({
    path: "/php/forms/db_commitFormData.php",
    referer:
      "https://praktika.praktika.net.au/v2/patient-directory/patient-search",
    body: [
      {
        request_id: makeRequestId("general_note"),
        practice_id: PRAKTIKA_PRACTICE_ID,
        patient_id: Number(patientId),
        patient_clinicalnotes: [
          {
            id: -1,
            previd: null,
            rootid: null,
            type: 2,
            appointmentid: null,
            author: "",
            date: null,
            teeth: null,
            draft: false,
            text: noteText.endsWith("\n") ? noteText : `${noteText}\n`,
            editable: true,
            deleted: false,
            dateOverride: null,
            history: [],
          },
        ],
      },
    ],
  });
}

export async function writePraktikaConfirmationBack({
  conversationId,
  appointmentId,
  note = "Confirmed YES via text message",
}: {
  conversationId: string;
  appointmentId: string;
  note?: string;
}) {
  const { data: appointment } = await supabaseAdmin
    .from("praktika_appointments")
    .select("*")
    .eq("praktika_appointment_id", String(appointmentId))
    .maybeSingle();

  const appointmentDate = appointment?.appointment_date || null;

  const result: any = {
    appointmentMarkedConfirmed: false,
    appointmentNoteCreated: false,
    errors: [],
  };

  try {
    const response = await markPraktikaAppointmentConfirmed({
      appointmentId,
      appointmentDate,
    });

    result.appointmentMarkedConfirmed = true;
    result.markConfirmedResponse = response;

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_marked_confirmed",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        response,
        server_session_fallback_configured: Boolean(getServerPraktikaCookie()),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not mark appointment confirmed.";

    result.errors.push(message);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_confirm_writeback_failed",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        error: message,
        server_session_fallback_configured: Boolean(getServerPraktikaCookie()),
      },
    });
  }

  try {
    const response = await createPraktikaAppointmentNote({
      appointmentId,
      appointmentDate,
      note,
    });

    result.appointmentNoteCreated = true;
    result.appointmentNoteResponse = response;

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_note_created",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        note,
        response,
        server_session_fallback_configured: Boolean(getServerPraktikaCookie()),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create appointment note.";

    result.errors.push(message);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_note_writeback_failed",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        note,
        error: message,
        server_session_fallback_configured: Boolean(getServerPraktikaCookie()),
      },
    });
  }

  return result;
}

export async function pushGeneralNoteExportToPraktika(exportId: string) {
  const { data: exportRow, error } = await supabaseAdmin
    .from("reception_praktika_general_note_exports")
    .select("*")
    .eq("id", exportId)
    .single();

  if (error || !exportRow) {
    throw new Error(error?.message || "General note export not found.");
  }

  if (!exportRow.praktika_patient_id) {
    await supabaseAdmin
      .from("reception_praktika_general_note_exports")
      .update({
        status: "no_praktika_patient",
        error_message: "No Praktika patient ID linked to this conversation.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", exportId);

    return {
      ok: false,
      error: "No Praktika patient ID linked to this conversation.",
    };
  }

  try {
    const response = await createPraktikaGeneralClinicalNote({
      patientId: String(exportRow.praktika_patient_id),
      noteText: clean(exportRow.note_body),
    });

    await supabaseAdmin
      .from("reception_praktika_general_note_exports")
      .update({
        status: "pushed",
        pushed_at: new Date().toISOString(),
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", exportId);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: exportRow.conversation_id,
      action: "praktika_general_clinical_note_created",
      details: {
        export_id: exportId,
        praktika_patient_id: exportRow.praktika_patient_id,
        response,
        server_session_fallback_configured: Boolean(getServerPraktikaCookie()),
      },
    });

    return { ok: true, response };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not create Praktika general note.";

    await supabaseAdmin
      .from("reception_praktika_general_note_exports")
      .update({
        status: "failed",
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", exportId);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: exportRow.conversation_id,
      action: "praktika_general_clinical_note_writeback_failed",
      details: {
        export_id: exportId,
        praktika_patient_id: exportRow.praktika_patient_id,
        error: message,
        server_session_fallback_configured: Boolean(getServerPraktikaCookie()),
      },
    });

    return { ok: false, error: message };
  }
}
