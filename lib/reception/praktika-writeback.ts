import { createPraktikaHelperJob } from "@/lib/praktika/helper-jobs";
import { supabaseAdmin } from "@/lib/supabase/admin";

const PRAKTIKA_PRACTICE_ID = Number(process.env.PRAKTIKA_PRACTICE_ID || 1181);

type UserMode = {
  scope: "user";
  appUserId: string;
};

type WritebackResult = {
  appointmentMarkedConfirmed: boolean;
  appointmentNoteCreated: boolean;
  errors: string[];
  queuedJobs: Array<{
    jobId: string;
    jobType: string;
    appUserId: string;
  }>;
  markConfirmedJobId?: string;
  appointmentNoteJobId?: string;
  generalClinicalNoteJobId?: string;
};

function makeRequestId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function userMode(appUserId: string): UserMode {
  return {
    scope: "user",
    appUserId,
  };
}

function appUserIdFromMode(mode: UserMode) {
  return mode.appUserId;
}

async function createUserScopedPraktikaJob({
  mode,
  jobType,
  path,
  referer,
  body,
  priority = 40,
}: {
  mode: UserMode;
  jobType: string;
  path: string;
  referer: string;
  body: Record<string, unknown> | unknown[];
  priority?: number;
}) {
  const appUserId = appUserIdFromMode(mode);

  if (!appUserId) {
    throw new Error(
      "A DocuDental user is required before creating a Praktika helper job.",
    );
  }

  return await createPraktikaHelperJob({
    appUserId,
    jobType,
    priority,
    request: {
      method: "POST",
      path,
      contentType: "json",
      referer,
      body,
    },
  });
}

export async function markPraktikaAppointmentConfirmed({
  appointmentId,
  appointmentDate,
  appUserId,
}: {
  appointmentId: string;
  appointmentDate?: string | null;
  appUserId: string;
}) {
  if (!appointmentId) throw new Error("Praktika appointment ID is required.");
  if (!appUserId) {
    throw new Error(
      "Cannot mark Praktika appointment confirmed without an assigned DocuDental user.",
    );
  }

  const refererDate = appointmentDate || new Date().toISOString().slice(0, 10);

  return await createUserScopedPraktikaJob({
    mode: userMode(appUserId),
    jobType: "reception_mark_appointment_confirmed",
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
  appUserId,
}: {
  appointmentId: string;
  appointmentDate?: string | null;
  note: string;
  appUserId: string;
}) {
  if (!appointmentId) throw new Error("Praktika appointment ID is required.");
  if (!appUserId) {
    throw new Error(
      "Cannot create Praktika appointment note without an assigned DocuDental user.",
    );
  }

  const refererDate = appointmentDate || new Date().toISOString().slice(0, 10);

  return await createUserScopedPraktikaJob({
    mode: userMode(appUserId),
    jobType: "reception_create_appointment_note",
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
  appUserId,
}: {
  patientId: string;
  appUserId: string;
}) {
  if (!patientId) throw new Error("Praktika patient ID is required.");
  if (!appUserId) {
    throw new Error(
      "Cannot fetch Praktika clinical notes without an assigned DocuDental user.",
    );
  }

  return await createUserScopedPraktikaJob({
    mode: userMode(appUserId),
    jobType: "reception_fetch_clinical_notes",
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
  appUserId,
}: {
  patientId: string;
  noteText: string;
  appUserId: string;
}) {
  if (!patientId) throw new Error("Praktika patient ID is required.");
  if (!appUserId) {
    throw new Error(
      "Cannot create Praktika general note without an assigned DocuDental user.",
    );
  }

  return await createUserScopedPraktikaJob({
    mode: userMode(appUserId),
    jobType: "reception_create_general_clinical_note",
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
  appUserId,
  note = "Confirmed YES via text message",
}: {
  conversationId: string;
  appointmentId: string;
  appUserId?: string | null;
  note?: string;
}): Promise<WritebackResult> {
  const { data: appointment } = await supabaseAdmin
    .from("praktika_appointments")
    .select("*")
    .eq("praktika_appointment_id", String(appointmentId))
    .maybeSingle();

  const appointmentDate = appointment?.appointment_date || null;

  const result: WritebackResult = {
    appointmentMarkedConfirmed: false,
    appointmentNoteCreated: false,
    errors: [],
    queuedJobs: [],
  };

  if (!appUserId) {
    const message =
      "No assigned DocuDental user was available for user-specific Praktika writeback. Manual queue processing is required.";

    result.errors.push(message);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_writeback_missing_assigned_user",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        error: message,
      },
    });

    return result;
  }

  try {
    const job = await markPraktikaAppointmentConfirmed({
      appointmentId,
      appointmentDate,
      appUserId,
    });

    result.appointmentMarkedConfirmed = true;
    result.markConfirmedJobId = job.id;
    result.queuedJobs.push({
      jobId: job.id,
      jobType: "reception_mark_appointment_confirmed",
      appUserId,
    });

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_confirm_helper_job_created",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        app_user_id: appUserId,
        helper_job_id: job.id,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not create appointment confirmation helper job.";

    result.errors.push(message);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_confirm_writeback_failed",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        app_user_id: appUserId,
        error: message,
      },
    });
  }

  try {
    const job = await createPraktikaAppointmentNote({
      appointmentId,
      appointmentDate,
      note,
      appUserId,
    });

    result.appointmentNoteCreated = true;
    result.appointmentNoteJobId = job.id;
    result.queuedJobs.push({
      jobId: job.id,
      jobType: "reception_create_appointment_note",
      appUserId,
    });

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_note_helper_job_created",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        app_user_id: appUserId,
        note,
        helper_job_id: job.id,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not create appointment note helper job.";

    result.errors.push(message);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: conversationId,
      action: "praktika_appointment_note_writeback_failed",
      details: {
        praktika_appointment_id: appointmentId,
        appointment_date: appointmentDate,
        app_user_id: appUserId,
        note,
        error: message,
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

  const appUserId =
    clean(exportRow.app_user_id) ||
    clean(exportRow.user_id) ||
    clean(exportRow.created_by) ||
    clean(exportRow.assigned_user_id);

  if (!appUserId) {
    const message =
      "No DocuDental user was linked to this general note export. Manual processing is required.";

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
      action: "praktika_general_note_missing_assigned_user",
      details: {
        export_id: exportId,
        praktika_patient_id: exportRow.praktika_patient_id,
        error: message,
      },
    });

    return { ok: false, error: message };
  }

  try {
    const job = await createPraktikaGeneralClinicalNote({
      patientId: String(exportRow.praktika_patient_id),
      noteText: clean(exportRow.note_body),
      appUserId,
    });

    await supabaseAdmin
      .from("reception_praktika_general_note_exports")
      .update({
        status: "queued",
        pushed_at: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", exportId);

    await supabaseAdmin.from("reception_audit_logs").insert({
      conversation_id: exportRow.conversation_id,
      action: "praktika_general_clinical_note_helper_job_created",
      details: {
        export_id: exportId,
        praktika_patient_id: exportRow.praktika_patient_id,
        app_user_id: appUserId,
        helper_job_id: job.id,
      },
    });

    return { ok: true, queued: true, helperJobId: job.id };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not create Praktika general note helper job.";

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
        app_user_id: appUserId,
        error: message,
      },
    });

    return { ok: false, error: message };
  }
}
